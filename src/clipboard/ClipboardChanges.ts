import {execFile} from 'node:child_process';

/** Fixed native metadata query: no string, image, type or clipboard item is requested. */
const COUNTER_SCRIPT = "ObjC.import('AppKit'); $.NSPasteboard.generalPasteboard.changeCount";

export function parseClipboardCounter(raw: string): number {
  const text = raw.trim();
  const count = Number(text);
  if (raw.length > 64 || !/^(?:0|[1-9]\d{0,15})$/u.test(text) || !Number.isSafeInteger(count))
    throw new Error('Clipboard change metadata is unavailable.');
  return count;
}

/** Conventional Linux clipboard tools expose text, not a reliable change counter. Fail closed there. */
export function clipboardCounter(platform = process.platform): (() => Promise<number>) | undefined {
  if (platform !== 'darwin') return undefined;
  return () => new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', COUNTER_SCRIPT], {encoding: 'utf8', timeout: 1500, maxBuffer: 64}, (error, stdout) => {
      if (error) { reject(new Error('Clipboard change metadata is unavailable.')); return; }
      try { resolve(parseClipboardCounter(stdout)); } catch (error) { reject(error); }
    });
  });
}

interface WatchOptions {
  counter: () => Promise<number>;
  idle: () => boolean;
  changed: () => void;
  failed: () => void;
  schedule?: (callback: () => void) => () => void;
}

/** Opt-in, frontend-only suggestions. The only dependency is a metadata counter, never a text reader. */
export class ClipboardChangeWatch {
  private active = false;
  private generation = 0;
  private previous?: number;
  private cancel?: () => void;

  constructor(private readonly options: WatchOptions) {}
  get enabled(): boolean { return this.active; }

  start(): void {
    this.stop();
    this.active = true;
    this.previous = undefined;
    void this.poll(this.generation);
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.cancel?.(); this.cancel = undefined;
    this.previous = undefined;
  }

  private async poll(generation: number): Promise<void> {
    if (!this.active || generation !== this.generation) return;
    this.cancel = undefined;
    try {
      if (this.options.idle()) {
        const count = await this.options.counter();
        if (!this.active || generation !== this.generation) return;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid change counter');
        const changed = this.previous !== undefined && count !== this.previous;
        this.previous = count;
        if (changed) this.options.changed();
      }
    } catch {
      if (!this.active || generation !== this.generation) return;
      this.stop(); this.options.failed(); return;
    }
    const schedule = this.options.schedule ?? (callback => {
      const timer = setTimeout(callback, 5000);
      timer.unref();
      return () => clearTimeout(timer);
    });
    this.cancel = schedule(() => { void this.poll(generation); });
  }
}
