import {OutputBuffer} from '../output/OutputBuffer.js';
import {completedActivity} from '../status/activity.js';
import {extractFacts} from '../status/adapters.js';
import {formatBytes} from '../session/sessionList.js';
import type {SpoolContents} from '../session/StreamBacklog.js';
import type {TranscriptSession, TranscriptStore} from './TranscriptStore.js';

export interface ArchiveLiveOptions {
  store: TranscriptStore;
  /** The journal the session's last frontend kept, if any. */
  journalId?: string;
  sessionId: string;
  spool: SpoolContents;
  /** Factual line recorded at the end, e.g. why the session ended. */
  note: string;
  cwd: string;
  now?: number;
}

/**
 * Turn a live session that ended without a frontend (killed, or its service
 * died) into an ordinary archived transcript: the last frontend journal plus
 * the stream events it never saw, applied through the same OutputBuffer and
 * lifecycle formatting the live frontend uses. Presentation only; nothing is
 * claimed to be running any more.
 */
export async function archiveLiveSession(options: ArchiveLiveOptions): Promise<TranscriptSession> {
  const {store, spool} = options;
  let journal: TranscriptSession | undefined;
  if (options.journalId) {
    try {
      const loaded = await store.load(options.journalId);
      if (!loaded.live || loaded.live.sessionId === options.sessionId) journal = loaded;
    } catch { /* unreadable: archive what the spool has */ }
  }
  const output = new OutputBuffer();
  let cwd = journal?.finalCwd ?? options.cwd;
  let running: {command: string; startedAt: number; historyAllowed?: number} | undefined;
  if (journal) {
    output.restoreTranscript(journal.transcript);
    const active = journal.live?.running;
    if (active) {
      output.resumeActive(active.command, active.startId, active.outputStartId);
      running = {command: active.command, startedAt: active.startedAt, historyAllowed: active.historyAllowed};
    }
  }
  const seen = journal?.live?.seq ?? 0;
  const complete = (exitCode: number, at: number, interrupted: boolean) => {
    if (!running) return;
    const record = output.complete(exitCode);
    if (record) {
      record.startedAt = running.startedAt;
      record.durationMs = Math.max(0, at - running.startedAt);
      record.historyEligible = running.historyAllowed === 1 && !/^\s/u.test(running.command);
    }
    const parts = completedActivity(running.command, at - running.startedAt, new Date(at), interrupted ? 0 : exitCode,
      interrupted, extractFacts(running.command, record?.output ?? ''));
    output.setCompletionLifecycle(`${parts.main}${parts.detail}`);
    output.addHistoryLine(`${parts.main}${parts.detail}`);
    running = undefined;
  };
  for (const event of spool.events) {
    if (event.seq <= seen) continue;
    if (event.kind === 'exec') {
      if (running) continue;
      output.beginCommand(event.command, [`❯ ${event.command}`], undefined, {cwd});
      running = {command: event.command, startedAt: event.at, historyAllowed: event.historyAllowed};
    } else if (event.kind === 'output') {
      output.write(event.data);
    } else {
      cwd = event.cwd;
      complete(event.exitCode, event.at, event.exitCode === 130);
    }
  }
  // A command still in flight when the shell died did not finish normally.
  complete(spool.exit?.exitCode ?? 1, spool.exit?.at ?? options.now ?? Date.now(), true);
  if (spool.truncatedBytes > 0) {
    output.addFrontendInteraction('session', `${formatBytes(spool.truncatedBytes)} of output exceeded the retention limit and was not kept.`);
  }
  output.addFrontendInteraction('session', options.note);
  const snapshot = {startCwd: journal?.startCwd ?? options.cwd, finalCwd: cwd, transcript: output.transcript(), journaled: true,
    endedAt: new Date(options.now ?? Date.now()).toISOString()};
  const archived: TranscriptSession = journal
    ? (({live: _live, ...rest}) => ({...rest, ...snapshot, commandCount: snapshot.transcript.records.length}))(journal)
    : store.create(snapshot);
  await store.save(archived);
  return archived;
}
