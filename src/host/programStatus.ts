/**
 * Host program status (OSC 7501, documented by Rex): an optional projection of what NMSh itself knows, for hosts that
 * show a status per terminal. NMSh never reads it back and nothing depends on it.
 *
 * Every report addresses NMSh's own record (`id=nmsh`), never the root record a program inside NMSh may use, and
 * only states NMSh has evidence for are reported:
 *
 *   a command runs                                  → working
 *   the shell confirms a program reads hidden input → blocked, kind=auth
 *   the shell confirms a program reads a line       → blocked, kind=question
 *   a held queued line waits for approval           → blocked, kind=permission
 *   the queue paused because an entry failed        → error
 *   anything else (the prompt is free)              → the record is cleared
 *
 * A report is written only when the state changes and only while NMSh owns the screen (the start of a command is
 * written at once, ahead of the program's output, like the OSC 133 C mark). The record is cleared when NMSh stops.
 * Messages are fixed NMSh text: no command line, path or typed input ever reaches the host.
 */

const ST = '\u001B\\';

export type ProgramStatus =
  | {state: 'working'}
  | {state: 'blocked'; kind: 'auth' | 'question' | 'permission'; message: string}
  | {state: 'error'; message: string};

/**
 * Hosts that document OSC 7501. Unknown hosts get nothing, and nothing inside tmux or screen (they own the real
 * terminal and drop or reroute unknown OSCs; Zellij too). NMSH_PROGRAM_STATUS=0 turns it off; NMSH_PROGRAM_STATUS=1 turns it on.
 */
export function programStatusSupported(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NMSH_PROGRAM_STATUS === '0' || env.TERM === 'dumb') return false;
  if (env.NMSH_PROGRAM_STATUS === '1') return true;
  if (env.TMUX || env.STY || env.ZELLIJ !== undefined || /^(tmux|screen)/u.test(env.TERM ?? '')) return false;
  return env.TERM_PROGRAM === 'rex';
}

const base64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');
const TITLE = base64('NMSh');

/** The OSC 7501 report for NMSh's record; `undefined` clears it. */
export function osc7501(status: ProgramStatus | undefined): string {
  if (!status) return `\u001B]7501;state=clear:id=nmsh${ST}`;
  const fields = [`state=${status.state}`, 'id=nmsh', 'app=nmsh', `title=${TITLE}`];
  if (status.state === 'blocked') fields.push(`kind=${status.kind}`);
  if (status.state !== 'working') fields.push(`msg=${base64(status.message.replace(/[\u0000-\u001f\u007f]/gu, ' '))}`);
  return `\u001B]7501;${fields.join(':')}${ST}`;
}

const key = (status: ProgramStatus | undefined): string => status ? JSON.stringify(status) : 'clear';

export class HostProgramStatus {
  /** What the host was last told; `clear` before anything was written, so an idle NMSh writes nothing at all. */
  private written = 'clear';

  constructor(private readonly supported: boolean, private readonly write: (data: string) => void,
    private readonly owned: () => boolean) {}

  /**
   * Reports `status` if it changed. `now` writes even while a program owns the screen: only for the start of a
   * command, before that program's own output.
   */
  set(status: ProgramStatus | undefined, now = false): void {
    if (!this.supported) return;
    const next = key(status);
    if (next === this.written || (!now && !this.owned())) return;
    this.write(osc7501(status));
    this.written = next;
  }

  /** A new prompt zone may have dropped the host's working or blocked record (OSC 133 A): the next state is resent. */
  forget(): void { if (this.written !== 'clear') this.written = 'stale'; }

  /** NMSh stops presenting this terminal: its record is removed. */
  end(): void {
    if (!this.supported || this.written === 'clear') return;
    this.write(osc7501(undefined));
    this.written = 'clear';
  }
}
