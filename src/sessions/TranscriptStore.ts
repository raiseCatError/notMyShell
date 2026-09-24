import {access, chmod, mkdir, open, readdir, readFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {OutputTranscript} from '../output/OutputBuffer.js';

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
  transcript: OutputTranscript;
}

export type TranscriptSummary = Omit<TranscriptSession, 'transcript' | 'preview'> & {project: string};

interface TranscriptFile extends TranscriptSession {
  schemaVersion: number;
}

function isTranscript(value: unknown): value is OutputTranscript {
  if (!value || typeof value !== 'object') return false;
  const transcript = value as Partial<OutputTranscript>;
  return (transcript.welcome === undefined || (typeof transcript.welcome.cwd === 'string'
    && transcript.welcome.shell === 'zsh'
    && transcript.welcome.identity !== null
    && typeof transcript.welcome.identity === 'object'
    && typeof transcript.welcome.identity.version === 'string'
    && typeof transcript.welcome.identity.commit === 'string'
    && (transcript.welcome.identity.branch === undefined || typeof transcript.welcome.identity.branch === 'string')
    && (transcript.welcome.identity.dirty === undefined || typeof transcript.welcome.identity.dirty === 'boolean')))
    && Array.isArray(transcript.records)
    && transcript.records.every(record => record && typeof record.command === 'string'
      && typeof record.output === 'string' && typeof record.lifecycleText === 'string'
      && typeof record.exitCode === 'number' && typeof record.startId === 'number'
      && typeof record.outputStartId === 'number'
      && (record.historicalContext === undefined
        || (typeof record.historicalContext.cwd === 'string'
          && (record.historicalContext.project === undefined || typeof record.historicalContext.project === 'string')
          && (record.historicalContext.branch === undefined || typeof record.historicalContext.branch === 'string')))
      && (record.historicalContext?.prompt === undefined || (typeof record.historicalContext.prompt === 'object'
        && record.historicalContext.prompt !== null
        && ['nmsh', 'starship', 'powerlevel10k'].includes(record.historicalContext.prompt.provider)
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
    transcript: file.transcript,
  };
}

function summary(session: TranscriptSession): TranscriptSummary {
  return {id: session.id, createdAt: session.createdAt, commandCount: session.transcript.records.length,
    startCwd: session.startCwd, finalCwd: session.finalCwd,
    pinned: session.pinned === true, ...(session.endedAt ? {endedAt: session.endedAt} : {}),
    ...(session.journaled ? {journaled: true} : {}),
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
