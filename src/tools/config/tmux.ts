import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../../configuration/paths.js';
import {shellQuote} from '../../host/terminalHost.js';

/**
 * tmux Tool Configuration: a typed model (option overrides, NMSh-owned key
 * bindings, a Status Studio layout, the pane frontend) stored as NMSh data
 * and rendered into ONE NMSh-managed tmux file. The user's tmux.conf only
 * ever gains one reviewed include of that file; everything NMSh configures
 * lives there, so updates are atomic rewrites of NMSh's own file and removal
 * is exact. No arbitrary strings become tmux commands: every option, value,
 * key, action and status module comes from the catalogs below, and status
 * modules never use #(...) shell execution.
 */

export type TmuxScope = 'server' | 'session' | 'window';
export interface TmuxOptionDef {
  id: string;
  label: string;
  scope: TmuxScope;
  description: string;
  /** Allowed values (enum) or an integer range. */
  values?: readonly string[];
  range?: [number, number];
  /** tmux's documented default, used for Effective when nothing else sets it. */
  defaultValue: string;
  group: 'General' | 'Status' | 'Keys';
  guidance?: string;
}

export const TMUX_OPTIONS: readonly TmuxOptionDef[] = [
  {id: 'mouse', label: 'Mouse', scope: 'session', values: ['on', 'off'], defaultValue: 'off', group: 'General', description: 'Mouse selects panes and windows, resizes panes and scrolls'},
  {id: 'base-index', label: 'First window number', scope: 'session', range: [0, 9], defaultValue: '0', group: 'General', description: 'Number of the first window'},
  {id: 'pane-base-index', label: 'First pane number', scope: 'window', range: [0, 9], defaultValue: '0', group: 'General', description: 'Number of the first pane'},
  {id: 'renumber-windows', label: 'Renumber windows', scope: 'session', values: ['on', 'off'], defaultValue: 'off', group: 'General', description: 'Close gaps in window numbers when a window closes'},
  {id: 'history-limit', label: 'Scrollback lines', scope: 'session', range: [1000, 1_000_000], defaultValue: '2000', group: 'General', description: 'Lines kept per pane'},
  {id: 'escape-time', label: 'Escape delay (ms)', scope: 'server', range: [0, 2000], defaultValue: '500', group: 'General', description: 'How long tmux waits after Esc for a key sequence'},
  {id: 'focus-events', label: 'Focus events', scope: 'server', values: ['on', 'off'], defaultValue: 'off', group: 'General', description: 'Pass terminal focus in/out to programs'},
  {id: 'extended-keys', label: 'Extended keys', scope: 'server', values: ['on', 'off', 'always'], defaultValue: 'off', group: 'General', description: 'Extended key reporting for programs that ask for it'},
  {id: 'set-clipboard', label: 'Clipboard', scope: 'server', values: ['on', 'off', 'external'], defaultValue: 'external', group: 'General', description: 'Whether tmux and programs may set the terminal clipboard (OSC 52)'},
  {id: 'default-terminal', label: 'Terminal type', scope: 'server', values: ['tmux-256color', 'screen-256color'], defaultValue: 'screen', group: 'General',
    description: 'TERM inside tmux', guidance: 'tmux-256color needs its terminfo entry on this system and on hosts you SSH to; screen-256color works almost everywhere'},
  {id: 'status', label: 'Status line', scope: 'session', values: ['on', 'off', '2'], defaultValue: 'on', group: 'Status', description: 'Show the status line (2 = two lines)'},
  {id: 'status-position', label: 'Status position', scope: 'session', values: ['bottom', 'top'], defaultValue: 'bottom', group: 'Status', description: 'Top or bottom of the window'},
  {id: 'status-interval', label: 'Status refresh (s)', scope: 'session', range: [1, 3600], defaultValue: '15', group: 'Status', description: 'Seconds between status refreshes'},
  {id: 'status-justify', label: 'Window list', scope: 'session', values: ['left', 'centre', 'right', 'absolute-centre'], defaultValue: 'left', group: 'Status', description: 'Where the window list sits'},
  {id: 'status-keys', label: 'Command prompt keys', scope: 'session', values: ['emacs', 'vi'], defaultValue: 'emacs', group: 'Keys', description: 'Key style in tmux\'s command prompt'},
  {id: 'mode-keys', label: 'Copy mode keys', scope: 'window', values: ['emacs', 'vi'], defaultValue: 'emacs', group: 'Keys', description: 'Key style in copy mode'},
];

export const TMUX_ACTIONS = {
  'send-prefix': {label: 'Send prefix', command: 'send-prefix'},
  'new-window': {label: 'New window', command: 'new-window -c "#{pane_current_path}"'},
  'split-vertical': {label: 'Split left/right', command: 'split-window -h -c "#{pane_current_path}"'},
  'split-horizontal': {label: 'Split top/bottom', command: 'split-window -v -c "#{pane_current_path}"'},
  'next-window': {label: 'Next window', command: 'next-window'},
  'previous-window': {label: 'Previous window', command: 'previous-window'},
  'pane-left': {label: 'Select pane left', command: 'select-pane -L'},
  'pane-right': {label: 'Select pane right', command: 'select-pane -R'},
  'pane-up': {label: 'Select pane up', command: 'select-pane -U'},
  'pane-down': {label: 'Select pane down', command: 'select-pane -D'},
  'resize-left': {label: 'Resize pane left', command: 'resize-pane -L 5'},
  'resize-right': {label: 'Resize pane right', command: 'resize-pane -R 5'},
  'resize-up': {label: 'Resize pane up', command: 'resize-pane -U 5'},
  'resize-down': {label: 'Resize pane down', command: 'resize-pane -D 5'},
  'copy-mode': {label: 'Copy mode', command: 'copy-mode'},
  'reload': {label: 'Reload NMSh-managed config', command: 'RELOAD'},
  'detach': {label: 'Detach', command: 'detach-client'},
} as const;
export type TmuxActionId = keyof typeof TMUX_ACTIONS;
export const TMUX_ACTION_IDS = Object.keys(TMUX_ACTIONS) as TmuxActionId[];
export type TmuxTable = 'prefix' | 'root';
export interface TmuxBinding {key: string; table: TmuxTable; action: TmuxActionId}

/** tmux's own default prefix-table bindings for the catalog actions (for "default" provenance and conflicts). */
export const TMUX_DEFAULT_BINDINGS: readonly TmuxBinding[] = [
  {key: 'c', table: 'prefix', action: 'new-window'}, {key: '%', table: 'prefix', action: 'split-vertical'}, {key: '"', table: 'prefix', action: 'split-horizontal'},
  {key: 'n', table: 'prefix', action: 'next-window'}, {key: 'p', table: 'prefix', action: 'previous-window'}, {key: 'Left', table: 'prefix', action: 'pane-left'},
  {key: 'Right', table: 'prefix', action: 'pane-right'}, {key: 'Up', table: 'prefix', action: 'pane-up'}, {key: 'Down', table: 'prefix', action: 'pane-down'},
  {key: '[', table: 'prefix', action: 'copy-mode'}, {key: 'd', table: 'prefix', action: 'detach'},
];

export const STATUS_MODULES = {
  session: {label: 'Session name', format: '#S'},
  windowIndex: {label: 'Window index', format: '#I'},
  windowName: {label: 'Window name', format: '#W'},
  paneIndex: {label: 'Pane index', format: '#P'},
  paneCommand: {label: 'Pane command', format: '#{pane_current_command}'},
  paneCwd: {label: 'Pane directory', format: '#{b:pane_current_path}'},
  host: {label: 'Host', format: '#h'},
  date: {label: 'Date', format: '%Y-%m-%d'},
  time: {label: 'Time', format: '%H:%M'},
} as const;
export type StatusModuleId = keyof typeof STATUS_MODULES;
export const STATUS_MODULE_IDS = Object.keys(STATUS_MODULES) as StatusModuleId[];
export const STATUS_SEPARATORS = ['·', '|', '│', '›'] as const;

export interface TmuxStatusLayout {left: StatusModuleId[]; right: StatusModuleId[]; separator: typeof STATUS_SEPARATORS[number]; windowFormat: 'index-name' | 'name' | 'index'}

export interface TmuxModel {
  /** NMSh overrides only; absent options inherit (user config or tmux default). */
  options: Record<string, string>;
  /** Prefix key, e.g. C-a; absent inherits. */
  prefix?: string;
  /** NMSh-owned bindings (only these are written; user bindings are never removed). */
  bindings: TmuxBinding[];
  /** Status Studio; absent leaves status formats alone. */
  status?: TmuxStatusLayout;
  /** New panes/windows without an explicit command: the default shell, or NMSh. */
  frontend: 'shell' | 'nmsh';
}

export const DEFAULT_TMUX_MODEL = (): TmuxModel => ({options: {}, bindings: [], frontend: 'shell'});

const KEY = /^(?:(?:C|M|S)-){0,3}(?:[a-zA-Z0-9]|F(?:[1-9]|1[0-2])|Up|Down|Left|Right|Space|Enter|Tab|BSpace|Escape|Home|End|PPage|NPage|[\\|\-_=+[\];',./`%"!@#$^&*()<>?:{}~])$/u;
export const validTmuxKey = (key: string): boolean => KEY.test(key);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validOptionValue(option: TmuxOptionDef, value: string): boolean {
  if (option.values) return option.values.includes(value);
  if (option.range) { const number = Number(value); return /^\d{1,7}$/u.test(value) && number >= option.range[0] && number <= option.range[1]; }
  return false;
}

export function normalizeTmuxModel(value: unknown): TmuxModel {
  const model = DEFAULT_TMUX_MODEL();
  if (!isRecord(value)) return model;
  if (isRecord(value.options)) for (const [id, raw] of Object.entries(value.options)) {
    const option = TMUX_OPTIONS.find(item => item.id === id);
    if (option && typeof raw === 'string' && validOptionValue(option, raw)) model.options[id] = raw;
  }
  if (typeof value.prefix === 'string' && validTmuxKey(value.prefix)) model.prefix = value.prefix;
  if (Array.isArray(value.bindings)) for (const item of value.bindings.slice(0, 64)) {
    if (isRecord(item) && typeof item.key === 'string' && validTmuxKey(item.key) && (item.table === 'prefix' || item.table === 'root')
      && TMUX_ACTION_IDS.includes(item.action as TmuxActionId) && !model.bindings.some(binding => binding.key === item.key && binding.table === item.table)) {
      model.bindings.push({key: item.key, table: item.table, action: item.action as TmuxActionId});
    }
  }
  if (isRecord(value.status)) {
    const modules = (list: unknown) => Array.isArray(list) ? list.filter((id): id is StatusModuleId => STATUS_MODULE_IDS.includes(id as StatusModuleId)).slice(0, 6) : [];
    const separator = STATUS_SEPARATORS.includes(value.status.separator as typeof STATUS_SEPARATORS[number]) ? value.status.separator as typeof STATUS_SEPARATORS[number] : '·';
    const windowFormat = value.status.windowFormat === 'name' || value.status.windowFormat === 'index' ? value.status.windowFormat : 'index-name';
    model.status = {left: modules(value.status.left), right: modules(value.status.right), separator, windowFormat};
  }
  if (value.frontend === 'nmsh') model.frontend = 'nmsh';
  return model;
}

export const tmuxModelPath = (env: NodeJS.ProcessEnv = process.env) => join(nmshConfigDirectory(env), 'tools', 'tmux.json');
export const tmuxManagedPath = (env: NodeJS.ProcessEnv = process.env) => join(nmshConfigDirectory(env), 'theme-bridge', 'tmux', 'nmsh.tmux.conf');

export function loadTmuxModel(env: NodeJS.ProcessEnv = process.env): TmuxModel {
  try { return normalizeTmuxModel(JSON.parse(readFileSync(tmuxModelPath(env), 'utf8'))); } catch { return DEFAULT_TMUX_MODEL(); }
}

export function saveTmuxModel(model: TmuxModel, env: NodeJS.ProcessEnv = process.env): void {
  const path = tmuxModelPath(env);
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const staged = `${path}.${process.pid}.tmp`;
  writeFileSync(staged, `${JSON.stringify(normalizeTmuxModel(model), null, 2)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(staged, path);
}

/** A path safe inside single quotes in tmux and /bin/sh. */
export const quotablePath = (path: string): boolean => /^\/[^'"\\\u0000-\u001f\u007f$`]+$/u.test(path);

/**
 * The pane frontend command: run NMSh, unless this tmux server was itself
 * started inside an NMSh session (NMSH_ACTIVE inherited), where NMSh's own
 * recursion guard would refuse; then the user's login shell starts instead.
 * Run through /bin/sh so it works whatever tmux's default-shell is.
 */
export function frontendCommand(nmsh: string): string | undefined {
  if (!frontendPath(nmsh)) return undefined;
  // The program text is fixed; the executable path is only ever argv data ("$1").
  return `${FRONTEND_PROGRAM} ${shellQuote(nmsh)}`;
}

const FRONTEND_PROGRAM = `exec /bin/sh -c 'if [ "$NMSH_ACTIVE" = 1 ]; then exec "\${SHELL:-/bin/sh}" -l; else exec "$1"; fi' nmsh-frontend`;

/** Any absolute path without control characters (a tmux config line cannot carry them). */
const frontendPath = (path: string): boolean => /^\/[^\u0000-\u001f\u007f]*$/u.test(path);

/** Inverse of tmuxQuote for the subset it emits; undefined for anything else. */
function tmuxUnquote(quoted: string): string | undefined {
  const match = /^"((?:[^"\\$]|\\[\\"$])*)"$/u.exec(quoted);
  return match ? match[1]!.replace(/\\(.)/gu, '$1') : undefined;
}

/** True only for exactly FRONTEND_PROGRAM followed by one shellQuote'd absolute path. */
function validFrontendLine(quoted: string): boolean {
  const command = tmuxUnquote(quoted);
  if (!command?.startsWith(`${FRONTEND_PROGRAM} `)) return false;
  const arg = command.slice(FRONTEND_PROGRAM.length + 1);
  const path = /^'(?:[^']|'\\'')*'$/u.test(arg) ? arg.slice(1, -1).replace(/'\\''/gu, "'") : /^[\w@%+=:,./-]+$/u.test(arg) ? arg : undefined;
  return path !== undefined && frontendPath(path) && shellQuote(path) === arg;
}

function setDirective(option: TmuxOptionDef, value: string): string {
  return option.scope === 'server' ? `set -s ${option.id} ${value}` : option.scope === 'window' ? `setw -g ${option.id} ${value}` : `set -g ${option.id} ${value}`;
}

const tmuxQuote = (text: string) => `"${text.replace(/[\\"$]/gu, match => `\\${match}`)}"`;

function statusFormat(modules: readonly StatusModuleId[], separator: string): string {
  return modules.length ? ` ${modules.map(id => STATUS_MODULES[id].format).join(` ${separator} `)} ` : '';
}

/**
 * The managed tmux file: typed overrides, NMSh bindings, Status Studio
 * formats, the pane frontend, then the Theme Bridge colors (when generated).
 */
export function renderTmuxConfig(model: TmuxModel, paths: {self: string; theme: string; nmsh?: string}): string {
  const lines = ['# Generated by NMSh Tool Configuration and Theme Bridge. NMSh replaces this file; your own tmux.conf stays yours.'];
  for (const option of TMUX_OPTIONS) {
    const value = model.options[option.id];
    if (value !== undefined) lines.push(setDirective(option, value));
  }
  if (model.prefix) lines.push(`set -g prefix ${model.prefix}`);
  for (const binding of model.bindings) {
    const action = TMUX_ACTIONS[binding.action];
    const command = binding.action === 'reload' ? `source-file '${paths.self}' \\; display-message "NMSh tmux config reloaded"` : action.command;
    lines.push(`bind-key ${binding.table === 'root' ? '-n ' : ''}${tmuxKey(binding.key)} ${command}`);
  }
  if (model.status) {
    lines.push(`set -g status-left ${tmuxQuote(statusFormat(model.status.left, model.status.separator))}`);
    lines.push(`set -g status-right ${tmuxQuote(statusFormat(model.status.right, model.status.separator))}`);
    const window = model.status.windowFormat === 'name' ? ' #W ' : model.status.windowFormat === 'index' ? ' #I ' : ' #I:#W ';
    lines.push(`setw -g window-status-format ${tmuxQuote(window)}`, `setw -g window-status-current-format ${tmuxQuote(window)}`);
  }
  if (model.frontend === 'nmsh' && paths.nmsh) {
    const command = frontendCommand(paths.nmsh);
    if (command) lines.push(`set -g default-command ${tmuxQuote(command)}`);
  }
  if (quotablePath(paths.theme)) lines.push(`source-file -q '${paths.theme}'`);
  return `${lines.join('\n')}\n`;
}

function tmuxKey(key: string): string {
  return /^[A-Za-z0-9]+$|^(?:(?:C|M|S)-)+[A-Za-z0-9]+$/u.test(key) ? key : `'${key.replace(/'/gu, "\\'")}'`;
}

/** Validates the managed file line by line against exactly what renderTmuxConfig can produce. */
export function validateTmuxConfig(content: string): boolean {
  const options = new Set(TMUX_OPTIONS.map(option => option.id));
  const commands = new Set<string>(Object.values(TMUX_ACTIONS).map(action => action.command));
  return content.split('\n').every(line => {
    if (line === '' || line.startsWith('# ')) return true;
    if (/^set -g prefix \S+$/u.test(line)) return validTmuxKey(line.slice(14));
    let match = /^(?:set -s|set -g|setw -g) ([a-z-]+) (\S+)$/u.exec(line);
    if (match) {
      const option = TMUX_OPTIONS.find(item => item.id === match![1]);
      return options.has(match[1]!) && Boolean(option) && validOptionValue(option!, match[2]!);
    }
    match = /^bind-key (?:-n )?(\S+) (.+)$/u.exec(line);
    if (match) return commands.has(match[2]!) || /^source-file '\/[^']+' \\; display-message "NMSh tmux config reloaded"$/u.test(match[2]!);
    if (/^set -g status-(?:left|right) "[^"\\$]*"$/u.test(line) || /^setw -g window-status(?:-current)?-format " #[IW](?::#W)? "$/u.test(line)) {
      const formats = (line.match(/"([^"]*)"/u)?.[1] ?? '');
      return !/#\(/u.test(formats);
    }
    if (line.startsWith('set -g default-command ')) return validFrontendLine(line.slice('set -g default-command '.length));
    return /^source-file -q '\/[^']+'$/u.test(line);
  });
}

// ---- Reading the user's own tmux config (supported subset only) ---------------------

export interface TmuxImport {
  options: Record<string, string>;
  prefix?: string;
  bindings: TmuxBinding[];
  /** Lines that are user-owned and were not understood (never evaluated). */
  unsupported: string[];
  /** Dynamic or recursive directives that were deliberately not followed. */
  ignored: string[];
}

const OPTION_ALIASES: Record<string, string> = {};

/**
 * Conservative parser for canonical set/set-option/set-window-option,
 * bind-key and unbind-key lines. if-shell, run-shell, source-file, %if,
 * command substitutions and anything else are reported, never evaluated.
 */
export function parseTmuxConfig(text: string): TmuxImport {
  const result: TmuxImport = {options: {}, bindings: [], unsupported: [], ignored: []};
  for (const raw of text.split(/\r?\n/u).slice(0, 5000)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (/^(?:if-shell|if|run-shell|run|source-file|source|%if|%else|%endif|%hidden)\b/u.test(line) || /#\(|\$\(|`/u.test(line)) { result.ignored.push(line.slice(0, 120)); continue; }
    const set = /^(set-option|set|set-window-option|setw)((?:\s+-[a-zA-Z]+)*)\s+([a-z@][a-z0-9-]*)\s+(.+)$/u.exec(line);
    if (set) {
      const id = OPTION_ALIASES[set[3]!] ?? set[3]!;
      const value = set[4]!.trim().replace(/^["']|["']$/gu, '');
      const option = TMUX_OPTIONS.find(item => item.id === id);
      if (id === 'prefix' && validTmuxKey(value)) result.prefix = value;
      else if (option && validOptionValue(option, value)) result.options[id] = value;
      else result.unsupported.push(line.slice(0, 120));
      continue;
    }
    const bind = /^(?:bind-key|bind)((?:\s+-[a-zA-Z]+(?:\s+[a-z-]+)?)*)\s+(\S+)\s+(.+)$/u.exec(line);
    if (bind) {
      const flags = bind[1] ?? '';
      const table: TmuxTable | undefined = /-n\b/u.test(flags) || /-T\s+root/u.test(flags) ? 'root' : /-T\s+/u.test(flags) && !/-T\s+prefix/u.test(flags) ? undefined : 'prefix';
      const key = bind[2]!.replace(/^['"]|['"]$/gu, '');
      const command = bind[3]!.trim();
      const action = TMUX_ACTION_IDS.find(id => TMUX_ACTIONS[id].command === command || TMUX_ACTIONS[id].command.split(' -c ')[0] === command);
      if (table && action && validTmuxKey(key)) result.bindings.push({key, table, action});
      else result.unsupported.push(line.slice(0, 120));
      continue;
    }
    result.unsupported.push(line.slice(0, 120));
  }
  return result;
}

/** The user's own tmux config file (existing one preferred), read bounded; undefined when absent. */
export function readUserTmuxConfig(env: NodeJS.ProcessEnv = process.env, home = env.HOME || homedir()): {path: string; text: string} | undefined {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.startsWith('/') ? env.XDG_CONFIG_HOME : join(home, '.config');
  for (const path of [join(home, '.tmux.conf'), join(xdg, 'tmux', 'tmux.conf')]) {
    try {
      if (!existsSync(path) || statSync(path).size > 512 * 1024) continue;
      return {path, text: readFileSync(path, 'utf8')};
    } catch { continue; }
  }
  return undefined;
}

export interface FieldProvenance {effective: string; override?: string; user?: string; source: 'NMSh managed file' | 'your tmux config' | 'tmux default'}

/** Effective value and where it comes from: NMSh override, then the user's config, then tmux's default. */
export function optionProvenance(option: TmuxOptionDef, model: TmuxModel, user: TmuxImport | undefined): FieldProvenance {
  const override = model.options[option.id];
  const mine = user?.options[option.id];
  if (override !== undefined) return {effective: override, override, ...(mine !== undefined ? {user: mine} : {}), source: 'NMSh managed file'};
  if (mine !== undefined) return {effective: mine, user: mine, source: 'your tmux config'};
  return {effective: option.defaultValue, source: 'tmux default'};
}

/** NMSh bindings that would override one of the user's own bindings for the same key and table. */
export function bindingConflicts(model: TmuxModel, user: TmuxImport | undefined): Array<{binding: TmuxBinding; user: TmuxBinding}> {
  return model.bindings.flatMap(binding => {
    const theirs = user?.bindings.find(item => item.key === binding.key && item.table === binding.table && item.action !== binding.action);
    return theirs ? [{binding, user: theirs}] : [];
  });
}

/** Typed changes Ask, dotfiles and the panel all apply through. */
export type TmuxChange =
  | {kind: 'option'; id: string; value?: string}
  | {kind: 'prefix'; key?: string}
  | {kind: 'binding'; binding: TmuxBinding; remove?: boolean}
  | {kind: 'status'; layout?: TmuxStatusLayout}
  | {kind: 'frontend'; value: 'shell' | 'nmsh'};

export function applyTmuxChange(model: TmuxModel, change: TmuxChange): TmuxModel | {error: string} {
  const next = structuredClone(model);
  if (change.kind === 'option') {
    const option = TMUX_OPTIONS.find(item => item.id === change.id);
    if (!option) return {error: `NMSh has no supported tmux setting ${change.id}.`};
    if (change.value === undefined) delete next.options[change.id];
    else if (!validOptionValue(option, change.value)) return {error: `${option.label}: ${change.value} is not one of the documented values.`};
    else next.options[change.id] = change.value;
  } else if (change.kind === 'prefix') {
    if (change.key === undefined) { delete next.prefix; next.bindings = next.bindings.filter(binding => binding.action !== 'send-prefix'); }
    else if (!validTmuxKey(change.key)) return {error: `${change.key} is not a key NMSh can bind safely.`};
    else {
      next.prefix = change.key;
      next.bindings = [...next.bindings.filter(binding => binding.action !== 'send-prefix'), {key: change.key, table: 'prefix', action: 'send-prefix'}];
    }
  } else if (change.kind === 'binding') {
    if (!validTmuxKey(change.binding.key) || !TMUX_ACTION_IDS.includes(change.binding.action)) return {error: 'That binding is not supported.'};
    next.bindings = next.bindings.filter(binding => !(binding.key === change.binding.key && binding.table === change.binding.table));
    if (!change.remove) next.bindings.push(change.binding);
  } else if (change.kind === 'status') {
    if (change.layout) next.status = change.layout; else delete next.status;
  } else next.frontend = change.value;
  return normalizeTmuxModel(next);
}

/** One plain sentence per change, for reviews. */
export function describeTmuxChange(change: TmuxChange): string {
  if (change.kind === 'option') {
    const option = TMUX_OPTIONS.find(item => item.id === change.id);
    return `${option?.label ?? change.id}: ${change.value === undefined ? 'inherit (remove NMSh override)' : change.value}`;
  }
  if (change.kind === 'prefix') return change.key ? `Prefix: ${change.key} (and ${change.key} ${change.key} sends it through)` : 'Prefix: inherit';
  if (change.kind === 'binding') return `${change.remove ? 'Remove' : 'Bind'} ${change.binding.table === 'root' ? '' : 'prefix '}${change.binding.key} → ${TMUX_ACTIONS[change.binding.action].label}`;
  if (change.kind === 'status') return change.layout ? 'Status line layout from Status Studio' : 'Status line layout: inherit';
  return `New panes and windows start ${change.value === 'nmsh' ? 'NMSh' : 'your default shell'}`;
}
