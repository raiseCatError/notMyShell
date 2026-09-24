import {chmod, mkdir, open, readdir, readFile, rename} from 'node:fs/promises';
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
  transcript: OutputTranscript;
}

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
    transcript: file.transcript,
  };
}

export class TranscriptStore {
  constructor(private readonly directory = join(nmshConfigDirectory(), 'sessions')) {}

  async archive(input: Omit<TranscriptSession, 'id' | 'createdAt' | 'commandCount' | 'preview'> & {preview?: string}): Promise<TranscriptSession> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    const createdAt = new Date().toISOString();
    const session: TranscriptSession = {
      ...input,
      id: `${createdAt.replace(/[:.]/gu, '-')}-${randomUUID()}`,
      createdAt,
      commandCount: input.transcript.records.length,
      preview: input.preview ?? input.transcript.records[0]?.command.replace(/\s+/gu, ' ').slice(0, 100) ?? '',
    };
    const file: TranscriptFile = {...session, schemaVersion: TRANSCRIPT_SCHEMA_VERSION};
    const target = join(this.directory, `${session.id}.json`);
    const temporary = `${target}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(file)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
    const directoryHandle = await open(this.directory, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
    return session;
  }

  async list(): Promise<TranscriptSession[]> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    await chmod(this.directory, 0o700);
    const entries = await readdir(this.directory, {withFileTypes: true});
    const sessions: TranscriptSession[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      try {
        sessions.push(parseSession(await readFile(join(this.directory, entry.name), 'utf8')));
      } catch {
        // A corrupt or future-version archive is kept untouched and omitted from the picker.
      }
    }
    return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
