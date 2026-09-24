import {TranscriptStore, type TranscriptSession} from './TranscriptStore.js';
import type {OutputTranscript} from '../output/OutputBuffer.js';

export interface JournalSnapshot {
  startCwd: string;
  finalCwd: string;
  transcript: OutputTranscript;
}

/** Serializes atomic checkpoints; rendering and keystrokes never wait for disk IO. */
export class SessionJournal {
  private current?: TranscriptSession;
  private pending: Promise<void> = Promise.resolve();
  private timer?: NodeJS.Timeout;
  private closed = false;

  constructor(
    private readonly store: TranscriptStore,
    private readonly retention: number | null,
    private readonly snapshot: () => JournalSnapshot,
    private readonly onError: (error: unknown) => void,
  ) {}

  get id(): string | undefined { return this.current?.id; }

  async start(): Promise<void> {
    this.closed = false;
    this.current = this.store.create({...this.snapshot(), journaled: true});
    await this.flush();
  }

  /** At most one snapshot per second during sustained output. */
  schedule(): void {
    if (!this.current || this.closed || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch(this.onError);
    }, 1000);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.current) return;
    const snapshot = this.snapshot();
    const session: TranscriptSession = {...this.current, ...snapshot,
      commandCount: snapshot.transcript.records.length,
      preview: snapshot.transcript.records[0]?.command.replace(/\s+/gu, ' ').slice(0, 100) ?? ''};
    this.current = session;
    this.pending = this.pending.catch(() => {}).then(() => this.store.save(session, this.retention));
    await this.pending;
  }

  async finish(): Promise<void> {
    if (!this.current) return;
    const previous = this.current;
    this.current = {...this.current, endedAt: new Date().toISOString()};
    try {
      await this.flush();
      this.current = undefined;
    } catch (error) {
      this.current = previous;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.finish();
  }
}
