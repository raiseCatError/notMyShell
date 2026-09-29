/**
 * Cheap, factual evidence about what a live session's foreground program is
 * doing, gathered from its own output stream: when it last wrote, the title it
 * set, and whether it asked for attention. Nothing here guesses intent; what
 * the stream does not say stays unknown.
 */

// OSC sequences end in BEL or ST; everything up to the terminator is payload.
const OSC = /\u001b\](\d+);([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;
const TITLE_LIMIT = 80;

export interface SessionEvidenceSnapshot {
  lastOutputAt?: number;
  /** The window title the foreground program set (OSC 0/2), sanitized. */
  title?: string;
  /** When the program asked for attention (a terminal notification or bell) while a command ran. */
  attentionSince?: number;
  /** Exit code of the last finished command. */
  lastExit?: number;
}

export class SessionEvidence {
  private lastOutputAt?: number;
  private title?: string;
  private attentionSince?: number;
  private lastExit?: number;
  private running = false;
  private carry = '';

  observe(data: string, now: number): void {
    this.lastOutputAt = now;
    let text = this.carry + data;
    // Keep an unfinished OSC for the next chunk so a split sequence is still seen.
    const open = text.lastIndexOf('\u001b]');
    this.carry = '';
    if (open !== -1 && !/\u0007|\u001b\\/u.test(text.slice(open)) && text.length - open < 512) {
      this.carry = text.slice(open);
      text = text.slice(0, open);
    }
    let attention = false;
    const rest = text.replace(OSC, (_match, code: string, payload: string) => {
      if (code === '0' || code === '2') {
        const title = payload.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, TITLE_LIMIT);
        this.title = title || undefined;
      } else if (code === '9' && !payload.startsWith('4;')) attention = true; // OSC 9 notification; 9;4 is progress
      else if (code === '777' && payload.startsWith('notify;')) attention = true;
      return '';
    });
    if (rest.includes('\u0007')) attention = true;
    if (attention && this.running && this.attentionSince === undefined) this.attentionSince = now;
  }

  /** A command started: a new program, so its title and attention start fresh. */
  onExec(): void {
    this.running = true;
    this.title = undefined;
    this.attentionSince = undefined;
  }

  onPrompt(exitCode: number): void {
    this.running = false;
    this.lastExit = exitCode;
    this.title = undefined;
    this.attentionSince = undefined;
  }

  /** Someone typed into the session: any attention request has been seen. */
  onInput(): void {
    this.attentionSince = undefined;
  }

  snapshot(): SessionEvidenceSnapshot {
    return {
      ...(this.lastOutputAt !== undefined ? {lastOutputAt: this.lastOutputAt} : {}),
      ...(this.title ? {title: this.title} : {}),
      ...(this.attentionSince !== undefined ? {attentionSince: this.attentionSince} : {}),
      ...(this.lastExit !== undefined ? {lastExit: this.lastExit} : {}),
    };
  }
}
