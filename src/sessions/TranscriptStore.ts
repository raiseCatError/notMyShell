import {access, chmod, link, mkdir, open, readdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {OutputTranscript} from '../output/OutputBuffer.js';

/** Another live process holds this transcript's lock. */
export class TranscriptBusyError extends Error {
  constructor(id: string) { super(`transcript ${id} is being written by another NMSh process`); }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

function validRgb(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const color = value as Record<string, unknown>;
  return ['red', 'green', 'blue'].every(channel => typeof color[channel] === 'number'
    && Number.isInteger(color[channel]) && (color[channel] as number) >= 0 && (color[channel] as number) <= 255);
}

export const TRANSCRIPT_SCHEMA_VERSION = 1;

export interface TranscriptSession {
  id: string;
  createdAt: string;
  commandCount: number;
  startCwd: string;
  finalCwd: string;
  preview: string;
  pinned?: boolean;
  endedAt?: string;
  journaled?: boolean;
  /** Link to the live service session this journal presents, while it is live. */
  live?: LiveLink;
  transcript: OutputTranscript;
}

export interface LiveLink {
  sessionId: string;
  /** Last shell stream event reflected in this transcript. */
  seq: number;
  /** The command in flight when this checkpoint was taken. */
  running?: {command: string; startedAt: number; cwd: string; startId: number; outputStartId: number; historyAllowed?: number};
}

function parseLive(value: unknown): LiveLink | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const live = value as Record<string, unknown>;
  if (typeof live.sessionId !== 'string' || !Number.isSafeInteger(live.seq)) return undefined;
  const running = live.running as Record<string, unknown> | undefined;
  const validRunning = running && typeof running.command === 'string' && typeof running.cwd === 'string'
    && ['startedAt', 'startId', 'outputStartId'].every(key => Number.isSafeInteger(running[key]));
  return {sessionId: live.sessionId, seq: live.seq as number,
    ...(validRunning ? {running: running as unknown as NonNullable<LiveLink['running']>} : {})};
}

export type TranscriptSummary = Omit<TranscriptSession, 'transcript' | 'preview' | 'live'> & {
  project: string;
  /** Set while this journal presents a live service session. */
  liveSessionId?: string;
};

interface TranscriptFile extends TranscriptSession {
  schemaVersion: number;
}

function isTranscript(value: unknown): value is OutputTranscript {
  if (!value || typeof value !== 'object') return false;
  const transcript = value as Partial<OutputTranscript>;
  return (transcript.welcome === undefined || (typeof transcript.welcome.cwd === 'string'
    && (transcript.welcome.shell === 'zsh' || transcript.welcome.shell === 'fish' || transcript.welcome.shell === 'bash')
    && transcript.welcome.identity !== null
    && typeof transcript.welcome.identity === 'object'
    && typeof transcript.welcome.identity.version === 'string'
    && typeof transcript.welcome.identity.commit === 'string'
    && (transcript.welcome.identity.branch === undefined || typeof transcript.welcome.identity.branch === 'string')
    && (transcript.welcome.identity.dirty === undefined || typeof transcript.welcome.identity.dirty === 'boolean')
    && (transcript.welcome.understanding === undefined || typeof transcript.welcome.understanding === 'string')
    && (transcript.welcome.provider === undefined || transcript.welcome.provider === 'fastfetch' || transcript.welcome.provider === 'neofetch')
    && (transcript.welcome.captured === undefined
      || (Array.isArray(transcript.welcome.captured) && transcript.welcome.captured.every(line => typeof line === 'string')))))
    && Array.isArray(transcript.records)
    && transcript.records.every(record => record && (record.historyEligible === undefined || typeof record.historyEligible === 'boolean')
      && (record.startedAt === undefined || Number.isFinite(record.startedAt))
      && (record.durationMs === undefined || (Number.isFinite(record.durationMs) && record.durationMs >= 0))
      && (record.inputWaitMs === undefined || (Number.isFinite(record.inputWaitMs) && record.inputWaitMs >= 0))
      && (record.inputWaits === undefined || (Number.isSafeInteger(record.inputWaits) && record.inputWaits >= 0))
      && typeof record.command === 'string'
      && typeof record.output === 'string' && typeof record.lifecycleText === 'string'
      && typeof record.exitCode === 'number' && typeof record.startId === 'number'
      && typeof record.outputStartId === 'number'
      && (record.historicalContext === undefined
        || (typeof record.historicalContext.cwd === 'string'
          && (record.historicalContext.project === undefined || typeof record.historicalContext.project === 'string')
          && (record.historicalContext.branch === undefined || typeof record.historicalContext.branch === 'string')
          && (record.historicalContext.promptless === undefined || record.historicalContext.promptless === true)))
      && (record.historicalContext?.prompt === undefined || (typeof record.historicalContext.prompt === 'object'
        && record.historicalContext.prompt !== null
        && ['nmsh', 'starship', 'powerlevel10k', 'ohMyPosh'].includes(record.historicalContext.prompt.provider)
        && Array.isArray(record.historicalContext.prompt.segments)
        && (record.historicalContext.prompt.gapEnabled === undefined || typeof record.historicalContext.prompt.gapEnabled === 'boolean')
        && record.historicalContext.prompt.segments.every(segment => segment && typeof segment.text === 'string'
          && (segment.geometry === 'powerline' || segment.geometry === 'plain')
          && (segment.foreground === undefined || validRgb(segment.foreground))
          && (segment.background === undefined || validRgb(segment.background)))))
      && (record.activities === undefined || (Array.isArray(record.activities)
        && record.activities.every(activity => activity && typeof activity.id === 'string'
          && activity.kind === 'tap-stream' && typeof activity.label === 'string'
          && typeof activity.startedAt === 'number' && Number.isFinite(activity.startedAt)
          && (activity.completedAt === undefined || (typeof activity.completedAt === 'number' && Number.isFinite(activity.completedAt)))
          && (activity.status === 'running' || activity.status === 'completed' || activity.status === 'failed')
          && Number.isInteger(activity.outputStartId) && activity.outputStartId >= 0
          && Number.isInteger(activity.outputEndId) && activity.outputEndId >= activity.outputStartId
          && activity.outputStartId >= record.outputStartId
          && activity.outputEndId <= (record.endId ?? transcript.lines?.length ?? 0)
          && typeof activity.expanded === 'boolean'))))
    && Array.isArray(transcript.lines)
    && transcript.lines.every(line => Array.isArray(line) && line.every(cell => cell === null
      || (cell !== undefined && typeof cell === 'object' && ('empty' in cell
        ? cell.empty === true
        : typeof cell.text === 'string' && typeof cell.width === 'number' && typeof cell.style === 'string'))))
    && Array.isArray(transcript.visualGaps)
    && transcript.visualGaps.every(index => Number.isInteger(index) && index >= 0)
    && Array.isArray(transcript.lineTypes)
    && transcript.lineTypes.every(entry => Array.isArray(entry) && entry.length === 2
      && Number.isInteger(entry[0]) && entry[0] >= 0 && (entry[1] === 'command' || entry[1] === 'metadata'));
}

function parseSession(text: string): TranscriptSession {
  const file = JSON.parse(text) as Partial<TranscriptFile>;
  if (file.schemaVersion !== TRANSCRIPT_SCHEMA_VERSION
    || typeof file.id !== 'string'
    || typeof file.createdAt !== 'string'
    || typeof file.startCwd !== 'string'
    || typeof file.finalCwd !== 'string'
    || typeof file.preview !== 'string'
    || !isTranscript(file.transcript)) {
    throw new Error('Unsupported or invalid transcript archive');
  }
  return {
    id: file.id,
    createdAt: file.createdAt,
    commandCount: file.transcript.records.length,
    startCwd: file.startCwd,
    finalCwd: file.finalCwd,
    preview: file.preview,
    pinned: file.pinned === true,
    ...(typeof file.endedAt === 'string' ? {endedAt: file.endedAt} : {}),
    ...(file.journaled === true ? {journaled: true} : {}),
    ...(parseLive(file.live) ? {live: parseLive(file.live)} : {}),
    transcript: file.transcript,
  };
}

function summary(session: TranscriptSession): TranscriptSummary {
  return {id: session.id, createdAt: session.createdAt, commandCount: session.transcript.records.length,
    startCwd: session.startCwd, finalCwd: session.finalCwd,
    pinned: session.pinned === true, ...(session.endedAt ? {endedAt: session.endedAt} : {}),
    ...(session.journaled ? {journaled: true} : {}),
    ...(session.live ? {liveSessionId: session.live.sessionId} : {}),
    project: session.transcript.records[0]?.historicalContext?.project ?? ''};
}

export class TranscriptStore {
  private lastCreatedAtMs = 0;
  constructor(private readonly directory = join(nmshConfigDirectory(), 'sessions')) {}

  private async prepare(): Promise<void> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
  }

  private async writeAtomic(target: string, content: string): Promise<void> {
    const temporary = `${target}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(this.directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  }

  create(input: Omit<TranscriptSession, 'id' | 'createdAt' | 'commandCount' | 'preview'> & {preview?: string}): TranscriptSession {
    this.lastCreatedAtMs = Math.max(Date.now(), this.lastCreatedAtMs + 1);
    const createdAt = new Date(this.lastCreatedAtMs).toISOString();
    return {...input, id: `${createdAt.replace(/[:.]/gu, '-')}-${randomUUID()}`, createdAt,
      commandCount: input.transcript.records.length,
      preview: input.preview ?? input.transcript.records[0]?.command.replace(/\s+/gu, ' ').slice(0, 100) ?? ''};
  }

  /** The transcript is durable before the small listing index or retention changes. */
  async save(session: TranscriptSession, retention: number | null = null): Promise<void> {
    await this.prepare();
    const target = join(this.directory, `${session.id}.json`);
    let newSession = false;
    try {
      await access(target);
      await access(join(this.directory, `${session.id}.meta.json`));
    } catch { newSession = true; }
    await this.writeAtomic(target, `${JSON.stringify({...session, schemaVersion: TRANSCRIPT_SCHEMA_VERSION})}\n`);
    await this.syncDirectory();
    await this.writeAtomic(join(this.directory, `${session.id}.meta.json`), `${JSON.stringify(summary(session))}\n`);
    await this.syncDirectory();
    if (retention !== null && newSession) await this.rotate(retention, session.id);
  }

  async archive(input: Omit<TranscriptSession, 'id' | 'createdAt' | 'commandCount' | 'preview'> & {preview?: string}): Promise<TranscriptSession> {
    const session = this.create(input);
    await this.save(session);
    return session;
  }

  /**
   * Run `task` holding this transcript's cross-process lock, so writers that
   * finalize or checkpoint a live journal never interleave. The lock file is
   * created atomically (hard link of a file already holding our pid); one whose
   * owner process is gone is taken over. Throws TranscriptBusyError when a live
   * owner still holds it after `waitMs`.
   */
  async withLock<T>(id: string, task: () => Promise<T>, waitMs = 0): Promise<T> {
    if (!/^[\w-]+$/u.test(id)) throw new Error('Invalid session id');
    await this.prepare();
    const lock = join(this.directory, `${id}.lock`);
    const mine = `${lock}.${randomUUID()}`;
    await writeFile(mine, `${process.pid}\n`, {mode: 0o600, flag: 'wx'});
    const deadline = Date.now() + waitMs;
    try {
      for (;;) {
        try { await link(mine, lock); break; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        }
        const owner = Number.parseInt(await readFile(lock, 'utf8').catch(() => ''), 10);
        if (Number.isSafeInteger(owner) && owner > 0 && !processAlive(owner)) {
          // Move the stale lock aside before removing it, so a lock another
          // launch has just taken over is never deleted by mistake.
          const aside = `${lock}.${randomUUID()}.stale`;
          try {
            await rename(lock, aside);
            const moved = Number.parseInt(await readFile(aside, 'utf8'), 10);
            if (moved !== owner) await link(aside, lock).catch(() => {});
            await unlink(aside);
          } catch { /* another launch cleared it first */ }
          continue;
        }
        if (Date.now() >= deadline) throw new TranscriptBusyError(id);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally {
      await unlink(mine).catch(() => {});
    }
    try {
      return await task();
    } finally {
      await unlink(lock).catch(() => {});
    }
  }

  async load(id: string): Promise<TranscriptSession> {
    if (!/^[\w-]+$/u.test(id)) throw new Error('Invalid session id');
    return parseSession(await readFile(join(this.directory, `${id}.json`), 'utf8'));
  }

  async listSummaries(): Promise<TranscriptSummary[]> {
    await this.prepare();
    const entries = await readdir(this.directory, {withFileTypes: true});
    const names = entries.filter(entry => entry.isFile() && entry.name.endsWith('.json')
      && !entry.name.endsWith('.meta.json')).map(entry => entry.name.slice(0, -5));
    const summaries: TranscriptSummary[] = [];
    for (let offset = 0; offset < names.length; offset += 32) {
      const batch = await Promise.all(names.slice(offset, offset + 32).map(async id => {
        try {
          const meta = JSON.parse(await readFile(join(this.directory, `${id}.meta.json`), 'utf8')) as TranscriptSummary;
          if (meta.id !== id || typeof meta.createdAt !== 'string' || typeof meta.finalCwd !== 'string') throw new Error('Invalid session index');
          return meta;
        } catch {
          try { return summary(await this.load(id)); } catch { return undefined; /* Preserve corrupt/future archives. */ }
        }
      }));
      summaries.push(...batch.filter((item): item is TranscriptSummary => item !== undefined));
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async rotate(retention: number, newestId: string): Promise<void> {
    const unpinned = (await this.listSummaries()).filter(session => !session.pinned);
    for (const session of unpinned.slice(Math.max(0, retention)).reverse()) {
      if (session.id === newestId) continue;
      await unlink(join(this.directory, `${session.id}.json`));
      try { await unlink(join(this.directory, `${session.id}.meta.json`)); } catch { /* Old archive had no index. */ }
    }
    await this.syncDirectory();
  }

  async list(): Promise<TranscriptSession[]> {
    await this.prepare();
    const entries = await readdir(this.directory, {withFileTypes: true});
    const sessions: TranscriptSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json') || entry.name.endsWith('.meta.json')) continue;
      try {
        sessions.push(parseSession(await readFile(join(this.directory, entry.name), 'utf8')));
      } catch {
        // A corrupt or future-version archive is kept untouched and omitted from the picker.
      }
    }
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
