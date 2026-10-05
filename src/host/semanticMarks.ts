import {hostname as osHostname} from 'node:os';
import {terminalProfile} from './capabilities.js';

/**
 * Host semantic cooperation: OSC 7 (current directory) and OSC 133 (command
 * zones), projected from NMSh's own authoritative lifecycle (the
 * authenticated private OSC 777 markers). They are an enhancement for capable
 * hosts and multiplexers; NMSh never reads them back or depends on them.
 *
 *   ready (prompt)  → [D;status if a command was running] OSC 7 (if cwd changed) A B
 *   exec (command)  → C
 *   shell ends      → D (no status: unknown) if a command was still running
 *
 * Markers are never written while a fullscreen program owns the terminal;
 * anything due then is held and written when NMSh owns the screen again.
 */

const ST = '\u001B\\';

export interface SemanticSupport {
  /** OSC 133 command zones. */
  marks: boolean;
  /** OSC 7 current working directory. */
  cwd: boolean;
}

/**
 * Hosts documented to understand these sequences (and multiplexers, which
 * consume them for their own pane state). Unknown hosts get nothing.
 * NMSH_SEMANTIC=0 turns both off; NMSH_SEMANTIC=1 forces both on.
 */
export function semanticSupport(env: NodeJS.ProcessEnv = process.env): SemanticSupport {
  if (env.NMSH_SEMANTIC === '0' || env.TERM === 'dumb') return {marks: false, cwd: false};
  if (env.NMSH_SEMANTIC === '1') return {marks: true, cwd: true};
  if (env.TMUX || /^(tmux|screen)/u.test(env.TERM ?? '')) return {marks: Boolean(env.TMUX), cwd: true};
  if (env.TERM_PROGRAM === 'Apple_Terminal') return {marks: false, cwd: true};
  const profile = terminalProfile(env);
  const known = profile === 'ghostty' || profile === 'kitty' || profile === 'wezterm' || profile === 'iterm2' || profile === 'windows-terminal';
  return {marks: known, cwd: known};
}

const UNRESERVED = /[A-Za-z0-9\-._~/]/u;

/** `file://host/path` with every byte outside the unreserved set (and `/`) percent-encoded. */
export function osc7(cwd: string, host = osHostname()): string | undefined {
  if (!cwd.startsWith('/') || cwd.length > 4096 || /[\u0000-\u001f\u007f]/u.test(cwd)) return undefined;
  const safeHost = /^[A-Za-z0-9.-]{1,253}$/u.test(host) ? host : '';
  let path = '';
  for (const byte of Buffer.from(cwd, 'utf8')) {
    const character = String.fromCharCode(byte);
    path += byte < 0x80 && UNRESERVED.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `\u001B]7;file://${safeHost}${path}${ST}`;
}

export const osc133 = (kind: 'A' | 'B' | 'C' | 'D', status?: number): string =>
  `\u001B]133;${kind}${kind === 'D' && status !== undefined && Number.isInteger(status) ? `;${status}` : ''}${ST}`;

export class HostSemantics {
  private zone: 'none' | 'prompt' | 'running' = 'none';
  private lastCwd?: string;
  private pending = '';

  constructor(private readonly support: SemanticSupport, private readonly write: (data: string) => void,
    private readonly owned: () => boolean, private readonly host = osHostname()) {}

  get state(): 'none' | 'prompt' | 'running' { return this.zone; }

  private emit(data: string): void {
    if (!data) return;
    this.pending += data;
    this.flush();
  }

  /** Writes anything held back once NMSh owns the screen (never mid fullscreen program). */
  flush(): void {
    if (!this.pending || !this.owned()) return;
    const data = this.pending;
    this.pending = '';
    this.write(data);
  }

  /** The shell reported readiness (OSC 777 status;cwd). */
  prompt(cwd: string, status: number): void {
    let out = '';
    if (this.support.marks && this.zone === 'running') out += osc133('D', status);
    if (this.support.cwd && cwd !== this.lastCwd) {
      const sequence = osc7(cwd, this.host);
      if (sequence) { out += sequence; this.lastCwd = cwd; }
    }
    if (this.support.marks) out += `${osc133('A')}${osc133('B')}`;
    this.zone = 'prompt';
    this.emit(out);
  }

  /** The shell reported a command about to run (OSC 777 exec). */
  exec(): void {
    if (this.zone !== 'prompt') return;
    this.zone = 'running';
    if (this.support.marks) this.emit(osc133('C'));
  }

  /** The shell ended or was replaced: a still-open command zone is closed without inventing a status. */
  end(): void {
    if (this.zone === 'running' && this.support.marks) this.emit(osc133('D'));
    this.zone = 'none';
    this.lastCwd = undefined;
  }
}
