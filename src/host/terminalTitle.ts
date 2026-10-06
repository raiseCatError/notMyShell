import {safeContextText} from '../context/facts.js';
import {terminalProfile} from './capabilities.js';

/**
 * Opt-in terminal title ownership (OSC 2).
 *
 * NMSh writes a bounded, sanitized identity ("notMyShell — Mango", or the
 * running command in transcript mode) only while it owns the screen. A
 * program in passthrough sets its own title through its own output; NMSh
 * writes nothing meanwhile, and re-asserts its title once the screen returns.
 * Titles derive from directory, session and command names, which are hostile
 * data: control characters, bidi formatting and string terminators never reach
 * the OSC payload. Where the host keeps a title stack, NMSh pushes the title it
 * found and pops it on exit; elsewhere it leaves the title for the next owner.
 */

export type TerminalTitleMode = 'off' | 'project' | 'session';
export const TERMINAL_TITLE_MODES: readonly TerminalTitleMode[] = ['off', 'project', 'session'];

export interface TitleSupport {
  enabled: boolean;
  /** XTWINOPS 22/23: push the host's title before the first write and pop it on exit. */
  stack: boolean;
}

/** NMSH_TITLE=0 refuses all title writes; dumb terminals never get them. */
export function titleSupport(env: NodeJS.ProcessEnv = process.env): TitleSupport {
  if (env.NMSH_TITLE === '0' || env.TERM === 'dumb') return {enabled: false, stack: false};
  const profile = terminalProfile(env);
  return {enabled: true, stack: !env.TMUX && (profile === 'kitty' || profile === 'wezterm' || profile === 'iterm2')};
}

/** Printable, single-line, bounded: an OSC payload can never be terminated or extended from inside. */
export function sanitizeTitle(text: string): string {
  return safeContextText(text.replace(/\s+/gu, ' ').trim(), 80).replace(/[\u0007\u001b\u009c]/gu, '');
}

export const osc2 = (title: string): string => `\u001B]2;${sanitizeTitle(title)}\u001B\\`;
const PUSH = '\u001B[22;2t';
const POP = '\u001B[23;2t';

export class HostTitle {
  private written?: string;
  private desired?: string;
  private pushed = false;
  private stale = false;

  constructor(private readonly support: TitleSupport, private readonly write: (data: string) => void, private readonly owned: () => boolean) {}

  /** What NMSh would show now; undefined means "not NMSh's to set" (setting Off). */
  set(title: string | undefined): void {
    this.desired = title === undefined ? undefined : sanitizeTitle(title);
    this.flush();
  }

  /** A program or another shell owned the screen and may have set its own title: write ours again when we return. */
  foreign(): void { this.stale = true; }

  flush(): void {
    if (!this.support.enabled || !this.owned()) return;
    if (this.desired === undefined) {
      // Turned Off: hand back what the host had (stack) or clear NMSh's own title.
      if (this.written !== undefined) {
        this.write(this.pushed ? POP : osc2(''));
        this.pushed = false;
        this.written = undefined;
      }
      return;
    }
    if (this.desired === this.written && !this.stale) return;
    if (this.written === undefined && this.support.stack && !this.pushed) { this.write(PUSH); this.pushed = true; }
    this.write(osc2(this.desired));
    this.written = this.desired;
    this.stale = false;
  }

  /** NMSh is leaving the terminal: restore the pushed title where the host supports it. */
  end(): void {
    if (this.pushed) this.write(POP);
    this.pushed = false;
    this.written = undefined;
  }
}
