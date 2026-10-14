import {spawn} from 'node:child_process';
import {accessSync, constants, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {isAbsolute} from 'node:path';
import type {ActivationIntent, WorkspaceResource} from './resources.js';
import {resourceText} from './resources.js';

/**
 * tmux sessions, windows and panes for the Workspace Sidebar (#331, #333).
 *
 * tmux owns its server, sessions, windows, panes, their PTYs and layout. NMSh
 * asks the server NMSh is running inside (the socket named by $TMUX) for one
 * `list-panes -a` listing, and navigates only with tmux's own commands
 * (`switch-client`, `select-window`, `select-pane`) on validated ids, as
 * typed argv without a shell. It never creates panes or PTYs, never changes
 * layout or options, and never talks to another tmux server. One session with
 * two windows and five panes is one session in the tree, not five.
 *
 * Discovery runs only when the sidebar asks (opening it, an explicit refresh),
 * never while rendering, and is bounded in time and bytes.
 */

export interface TmuxPane {
  sessionId: string; sessionName: string; sessionAttached: boolean;
  windowId: string; windowIndex: number; windowName: string; windowActive: boolean;
  paneId: string; paneIndex: number; paneActive: boolean; paneDead: boolean;
  command: string;
}

/** The server NMSh runs inside, from $TMUX (`socket,pid,session`) and $TMUX_PANE. */
export interface TmuxServer {socket: string; pane?: string}

const FIELDS = ['session_id', 'session_name', 'session_attached', 'window_id', 'window_index', 'window_name', 'window_active',
  'pane_id', 'pane_index', 'pane_active', 'pane_dead', 'pane_current_command'] as const;
const NAMES: ReadonlySet<string> = new Set(['session_name', 'window_name', 'pane_current_command']);
/**
 * Fields separated by `|`. Names may contain `|`, so they are requested with tmux's `q:` modifier, which escapes shell
 * specials (`|` becomes `\|`); ids and numbers never contain it. tmux also escapes its output itself on some builds
 * (`\\` for a backslash, `\ooo` for a control character), so a control-character separator is not reliable.
 */
export const LIST_FORMAT = FIELDS.map(field => (NAMES.has(field) ? `#{q:${field}}` : `#{${field}}`)).join('|');

/** One listing row into fields: split on unescaped `|`, undo `q:` escaping, then tmux's own `\\` and `\ooo` escapes. */
export function splitTmuxRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === '\\' && index + 1 < line.length) { current += line[++index]!; continue; }
    if (char === '|') { fields.push(current); current = ''; continue; }
    current += char;
  }
  fields.push(current);
  return fields.map(field => field.replace(/\\(\\|[0-7]{3})/gu, (_, code: string) => code === '\\' ? '\\' : String.fromCharCode(parseInt(code, 8))));
}
export const MAX_PANES = 256;

const SESSION_ID = /^\$\d{1,9}$/u, WINDOW_ID = /^@\d{1,9}$/u, PANE_ID = /^%\d{1,9}$/u;
export const validTmuxId = (id: string): boolean => SESSION_ID.test(id) || WINDOW_ID.test(id) || PANE_ID.test(id);

export function tmuxServer(env: NodeJS.ProcessEnv): TmuxServer | undefined {
  const socket = env.TMUX?.split(',')[0];
  if (!socket || !isAbsolute(socket) || socket.length > 1024 || /[\u0000-\u001f]/u.test(socket)) return undefined;
  const pane = env.TMUX_PANE && PANE_ID.test(env.TMUX_PANE) ? env.TMUX_PANE : undefined;
  return {socket, ...(pane ? {pane} : {})};
}

/** `list-panes -a -F LIST_FORMAT` output to panes; a row with the wrong shape or an invalid id is dropped, never guessed. */
export function parseTmuxPanes(output: string): TmuxPane[] {
  const panes: TmuxPane[] = [];
  for (const line of output.split('\n')) {
    if (!line || panes.length >= MAX_PANES) continue;
    const parts = splitTmuxRow(line);
    if (parts.length !== FIELDS.length) continue;
    const [sessionId, sessionName, attached, windowId, windowIndex, windowName, windowActive, paneId, paneIndex, paneActive, paneDead, command = ''] = parts;
    if (!SESSION_ID.test(sessionId!) || !WINDOW_ID.test(windowId!) || !PANE_ID.test(paneId!)) continue;
    if (!/^\d{1,6}$/u.test(windowIndex!) || !/^\d{1,6}$/u.test(paneIndex!)) continue;
    panes.push({sessionId: sessionId!, sessionName: resourceText(sessionName!), sessionAttached: Number(attached) > 0,
      windowId: windowId!, windowIndex: Number(windowIndex), windowName: resourceText(windowName!), windowActive: windowActive === '1',
      paneId: paneId!, paneIndex: Number(paneIndex), paneActive: paneActive === '1', paneDead: paneDead === '1', command: resourceText(command, 40)});
  }
  return panes;
}

/**
 * The tmux section of the sidebar: session → window → pane. `active` marks the pane NMSh itself runs in and the
 * window/session holding it; tmux's own active window and pane in other sessions are marked as such in the detail.
 */
export function tmuxResources(panes: readonly TmuxPane[], server: TmuxServer | undefined, observedAt: number): WorkspaceResource {
  if (!server) return {id: 'tmux', kind: 'section', label: 'tmux', support: 'informational', reason: 'not running inside tmux', observedAt};
  const sessions = new Map<string, {name: string; attached: boolean; windows: Map<string, {index: number; name: string; active: boolean; panes: TmuxPane[]}>}>();
  for (const pane of panes) {
    const session = sessions.get(pane.sessionId) ?? {name: pane.sessionName, attached: pane.sessionAttached, windows: new Map()};
    sessions.set(pane.sessionId, session);
    const window = session.windows.get(pane.windowId) ?? {index: pane.windowIndex, name: pane.windowName, active: pane.windowActive, panes: []};
    session.windows.set(pane.windowId, window);
    window.panes.push(pane);
  }
  const intent = (scope: 'session' | 'window' | 'pane', target: string): ActivationIntent => ({kind: 'tmux', scope, target, socket: server.socket});
  const children: WorkspaceResource[] = [...sessions].map(([sessionId, session]) => {
    const windows = [...session.windows].sort(([, a], [, b]) => a.index - b.index).map(([windowId, window]): WorkspaceResource => {
      const paneResources = window.panes.sort((a, b) => a.paneIndex - b.paneIndex).map((pane): WorkspaceResource => ({
        id: `tmux:${sessionId}:${windowId}:${pane.paneId}`, kind: 'tmuxPane', label: pane.command || `pane ${pane.paneIndex}`,
        detail: [pane.paneId === server.pane ? 'this NMSh' : undefined, pane.paneActive ? 'active pane' : undefined, pane.paneDead ? 'exited' : undefined].filter(Boolean).join(' · ') || undefined,
        support: 'activatable', activation: intent('pane', pane.paneId), active: pane.paneId === server.pane, observedAt,
        ...(pane.paneDead ? {attention: 'finished' as const} : {}),
      }));
      return {id: `tmux:${sessionId}:${windowId}`, kind: 'tmuxWindow', label: `${window.index} ${window.name}`,
        ...(window.active ? {detail: 'active window'} : {}), support: 'activatable', activation: intent('window', windowId),
        active: window.panes.some(pane => pane.paneId === server.pane), observedAt, children: paneResources};
    });
    return {id: `tmux:${sessionId}`, kind: 'tmuxSession', label: session.name, detail: session.attached ? 'attached' : 'detached',
      support: 'activatable', activation: intent('session', sessionId), active: windows.some(window => window.active), observedAt, children: windows};
  });
  return {id: 'tmux', kind: 'section', label: 'tmux', support: 'informational', observedAt, children};
}

/**
 * tmux's own commands for an activation, as one argv (commands separated by `;` arguments, no shell). A window or pane
 * is selected first, then the client switches to its session, so the client lands on what was chosen; a session
 * activation only switches. Ids must be tmux ids (`$1`, `@2`, `%3`), never names.
 */
export function tmuxNavigationArgs(intent: Extract<ActivationIntent, {kind: 'tmux'}>, panes: readonly TmuxPane[]): string[] | {error: string} {
  if (!validTmuxId(intent.target)) return {error: 'not a tmux id'};
  if (intent.scope === 'session') return SESSION_ID.test(intent.target) ? ['switch-client', '-t', intent.target] : {error: 'not a session id'};
  const pane = panes.find(item => (intent.scope === 'pane' ? item.paneId : item.windowId) === intent.target);
  if (!pane) return {error: 'that tmux object is gone; refresh the list'};
  const select = intent.scope === 'pane'
    ? ['select-pane', '-t', pane.paneId, ';', 'select-window', '-t', pane.windowId]
    : ['select-window', '-t', pane.windowId];
  return [...select, ';', 'switch-client', '-t', pane.sessionId];
}

export interface TmuxRunResult {stdout: string; code: number | null; timedOut: boolean; truncated: boolean}
export type TmuxRunner = (args: readonly string[]) => Promise<TmuxRunResult>;

/**
 * A bounded runner for the trusted tmux executable (resolved by the caller outside the workspace), always addressed to
 * the given socket. The environment is minimal: tmux needs no configuration or credentials to list or select.
 */
export function createTmuxRunner(executable: string, server: TmuxServer, {timeoutMs = 1500, maxBytes = 256 * 1024} = {}): TmuxRunner {
  return args => new Promise(resolve => {
    let child;
    try {
      child = spawn(executable, ['-S', server.socket, ...args], {
        stdio: ['ignore', 'pipe', 'ignore'], shell: false,
        env: {PATH: '/usr/bin:/bin', HOME: homedir(), LANG: 'C.UTF-8', ...(process.env.TMUX ? {TMUX: process.env.TMUX} : {}), ...(server.pane ? {TMUX_PANE: server.pane} : {})},
      });
    } catch { resolve({stdout: '', code: null, timedOut: false, truncated: false}); return; }
    const chunks: Buffer[] = [];
    let bytes = 0, truncated = false, timedOut = false, settled = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      if (truncated) return;
      if (bytes + chunk.length > maxBytes) { truncated = true; child.kill('SIGKILL'); return; }
      chunks.push(chunk); bytes += chunk.length;
    });
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      resolve({stdout: Buffer.concat(chunks).toString('utf8'), code, timedOut, truncated});
    };
    child.once('error', () => finish(null));
    child.once('close', code => finish(code));
  });
}

/**
 * The tmux executable from fixed system locations only (Homebrew, /usr/local, the OS), resolved through symlinks:
 * never a PATH entry or anything inside the workspace, so a repository cannot plant the binary the sidebar runs.
 */
export function trustedTmux(candidates: readonly string[] = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux', '/bin/tmux']): string | undefined {
  for (const candidate of candidates) {
    try {
      const path = realpathSync(candidate);
      accessSync(path, constants.X_OK);
      if (isAbsolute(path)) return path;
    } catch { /* not installed here */ }
  }
  return undefined;
}

export interface TmuxListing {panes: TmuxPane[]; observedAt: number; error?: string}

/** One listing from the server; failures are reported (and the previous listing can stay visible, marked stale), never retried in a loop. */
export async function listTmuxPanes(run: TmuxRunner, now = Date.now()): Promise<TmuxListing> {
  const result = await run(['list-panes', '-a', '-F', LIST_FORMAT]);
  if (result.timedOut) return {panes: [], observedAt: now, error: 'tmux did not answer in time'};
  if (result.truncated) return {panes: [], observedAt: now, error: 'the tmux listing was too large'};
  if (result.code !== 0) return {panes: [], observedAt: now, error: 'tmux could not list panes'};
  return {panes: parseTmuxPanes(result.stdout), observedAt: now};
}
