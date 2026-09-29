import {appendFileSync, mkdirSync, readFileSync, statSync, unlinkSync} from 'node:fs';
import {dirname} from 'node:path';

/** One shell stream event as retained for replay. */
export type BacklogEvent =
  | {kind: 'output'; seq: number; at: number; data: string}
  | {kind: 'exec'; seq: number; at: number; command: string}
  | {kind: 'prompt'; seq: number; at: number; exitCode: number; cwd: string};

/** Non-event spool records: journal acknowledgements, truncation and the shell's end. */
type SpoolRecord = BacklogEvent
  | {kind: 'ack'; seq: number; journalId: string}
  | {kind: 'truncated'; bytes: number}
  | {kind: 'exit'; exitCode: number; at: number};

export interface BacklogLimits {
  /** Unacknowledged bytes kept in memory before spilling to the spool file. */
  memoryBytes: number;
  /** Spool size after which output payloads are dropped (with a counted marker). */
  spoolBytes: number;
}

export const DEFAULT_BACKLOG_LIMITS: BacklogLimits = {memoryBytes: 1024 * 1024, spoolBytes: 64 * 1024 * 1024};

function eventBytes(event: BacklogEvent): number {
  return event.kind === 'output' ? event.data.length : event.kind === 'exec' ? event.command.length : event.cwd.length;
}

function validEvent(value: unknown): value is SpoolRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const int = (key: string) => Number.isSafeInteger(record[key]);
  switch (record.kind) {
    case 'output': return int('seq') && int('at') && typeof record.data === 'string';
    case 'exec': return int('seq') && int('at') && typeof record.command === 'string';
    case 'prompt': return int('seq') && int('at') && int('exitCode') && typeof record.cwd === 'string';
    case 'ack': return int('seq') && typeof record.journalId === 'string';
    case 'truncated': return int('bytes');
    case 'exit': return int('exitCode') && int('at');
    default: return false;
  }
}

export interface SpoolContents {
  events: BacklogEvent[];
  ackedSeq: number;
  journalId?: string;
  truncatedBytes: number;
  exit?: {exitCode: number; at: number};
}

/**
 * Read a spool written by StreamBacklog. Every record is one complete JSON
 * line, so a crash mid-write can only leave a torn final line: it and any
 * other invalid line are skipped rather than trusted.
 */
export function readSpool(path: string): SpoolContents {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return {events: [], ackedSeq: 0, truncatedBytes: 0}; }
  const contents: SpoolContents = {events: [], ackedSeq: 0, truncatedBytes: 0};
  for (const line of text.split('\n')) {
    if (!line) continue;
    let record: unknown;
    try { record = JSON.parse(line); } catch { continue; }
    if (!validEvent(record)) continue;
    if (record.kind === 'ack') {
      if (record.seq >= contents.ackedSeq) { contents.ackedSeq = record.seq; contents.journalId = record.journalId; }
    } else if (record.kind === 'truncated') contents.truncatedBytes += record.bytes;
    else if (record.kind === 'exit') contents.exit = {exitCode: record.exitCode, at: record.at};
    else contents.events.push(record);
  }
  contents.events = contents.events.filter(event => event.seq > contents.ackedSeq);
  return contents;
}

/**
 * Shell stream events not yet durable in a frontend journal. Recent events
 * stay in memory; beyond memoryBytes they spill to an append-only JSONL spool
 * so a long detached period costs disk, not service memory. Past spoolBytes,
 * output text is dropped but command boundaries are kept, and the dropped
 * byte count is reported instead of silently truncating.
 */
export class StreamBacklog {
  private memory: BacklogEvent[] = [];
  private memoryBytes = 0;
  private spooled = false;
  private spoolSize = 0;
  private acked = 0;
  private journal?: string;
  private truncated = 0;

  constructor(private readonly spoolPath: string, private readonly limits: BacklogLimits = DEFAULT_BACKLOG_LIMITS) {}

  get ackedSeq(): number { return this.acked; }
  get journalId(): string | undefined { return this.journal; }
  get truncatedBytes(): number { return this.truncated; }
  get spooling(): boolean { return this.spooled; }

  append(event: BacklogEvent): void {
    this.memory.push(event);
    this.memoryBytes += eventBytes(event);
    if (this.memoryBytes > this.limits.memoryBytes) this.spill();
  }

  ack(seq: number, journalId: string): void {
    if (seq < this.acked) return;
    this.acked = seq;
    this.journal = journalId || undefined;
    this.memory = this.memory.filter(event => event.seq > seq);
    this.memoryBytes = this.memory.reduce((total, event) => total + eventBytes(event), 0);
    if (!this.spooled) return;
    if (this.memory.length === 0 && this.lastSpooledSeq <= seq) {
      // Everything spooled is now durable in the journal; start over.
      this.removeSpool();
    } else this.write([{kind: 'ack', seq, journalId}]);
  }

  private lastSpooledSeq = 0;

  /** Unacknowledged events in order: spooled first, then in memory. */
  events(): BacklogEvent[] {
    const spooled = this.spooled ? readSpool(this.spoolPath).events.filter(event => event.seq > this.acked) : [];
    return [...spooled, ...this.memory.filter(event => event.seq > this.acked)];
  }

  /**
   * Persist everything with the shell's end, so the spool can be archived
   * later. Always written: the exit record is how recovery tells an ordinary
   * exit from a service that died.
   */
  finish(exitCode: number, at: number): void {
    this.spill();
    this.write([{kind: 'exit', exitCode, at}]);
  }

  dispose(): void {
    this.memory = [];
    this.memoryBytes = 0;
    if (this.spooled) this.removeSpool();
  }

  private spill(): void {
    const records: SpoolRecord[] = [];
    if (!this.spooled) {
      // The runtime directory is private (0700); the spool directory is too.
      mkdirSync(dirname(this.spoolPath), {recursive: true, mode: 0o700});
      this.spooled = true;
      this.spoolSize = 0;
      if (this.acked > 0) records.push({kind: 'ack', seq: this.acked, journalId: this.journal ?? ''});
    }
    let dropped = 0;
    for (const event of this.memory) {
      if (event.kind === 'output' && this.spoolSize + event.data.length > this.limits.spoolBytes) {
        dropped += event.data.length;
        continue;
      }
      if (dropped > 0) { records.push({kind: 'truncated', bytes: dropped}); this.truncated += dropped; dropped = 0; }
      records.push(event);
      this.spoolSize += eventBytes(event);
      this.lastSpooledSeq = event.seq;
    }
    if (dropped > 0) { records.push({kind: 'truncated', bytes: dropped}); this.truncated += dropped; }
    this.memory = [];
    this.memoryBytes = 0;
    this.write(records);
  }

  private write(records: SpoolRecord[]): void {
    if (records.length === 0) return;
    // One append per batch of whole lines; a torn tail is skipped by readSpool.
    appendFileSync(this.spoolPath, records.map(record => `${JSON.stringify(record)}\n`).join(''), {mode: 0o600});
  }

  private removeSpool(): void {
    try { unlinkSync(this.spoolPath); } catch { /* already gone */ }
    this.spooled = false;
    this.spoolSize = 0;
  }

  /** Bytes currently on disk; for tests and diagnostics. */
  spoolFileBytes(): number {
    try { return statSync(this.spoolPath).size; } catch { return 0; }
  }
}
