import {detectAgentCommand, detectAgentProcess} from '../agents/agents.js';
import {formatDuration} from '../status/commandTiming.js';
import {commandWord} from './liveStatus.js';
import {formatAge, tildePath} from './sessionList.js';

/**
 * Cross-session notices: one compact, factual line per other session that
 * changed state while you were elsewhere. They are frontend chrome above the
 * composer: never transcript rows, never journaled, never copied.
 *
 * The session service owns the notice for each session, because it is the
 * one process that sees every session's lifecycle. Focusing a session
 * (attaching to it or typing into it) clears its notice in the service, so it
 * disappears from every attached NMSh frontend on their next refresh.
 *
 * Every notice is built from facts the service already has: the program word
 * of the command line, the exit code, timestamps, and whether the program
 * requested attention (bell / OSC 9 / OSC 777 notify). Nothing reads what an
 * agent or program said.
 */

export const NOTICE_KINDS = ['completed', 'failed', 'attention', 'ended', 'long-running', 'input'] as const;
export type NoticeKind = typeof NOTICE_KINDS[number];

export interface SessionNotice {
  sessionId: string;
  kind: NoticeKind;
  /** When the transition happened (epoch ms). */
  at: number;
  /** Program word of the command involved (basename only, never arguments). */
  program?: string;
  /** Known agent id when the program identity proves it. */
  agent?: string;
  exitCode?: number;
  durationMs?: number;
  cwd?: string;
  /** For an input notice: how sure the service is that the program waits for input (see InputWatch). */
  confidence?: string;
}

export const MAX_VISIBLE_NOTICES = 3;
/** A wait shorter than this is someone answering, not news for another window. */
export const INPUT_NOTICE_DELAY_MS = 3000;
/** A command still running after this long is worth one notice. */
export const LONG_RUNNING_MS = 15 * 60_000;
/**
 * Retention is not visibility. The service keeps an ended session's notice
 * this long (bounded in count) so a frontend that attaches later can still
 * list it; /sessions and /resume own that history. What a frontend SHOWS
 * above the composer is much shorter, see NOTICE_VISIBLE_MS.
 */
export const ENDED_NOTICE_TTL_MS = 60 * 60_000;
export const MAX_ENDED_NOTICES = 8;

/**
 * How long a notice stays above the composer after its transition. A notice
 * is an event ("something just happened elsewhere"), not a status panel:
 * routine outcomes fade in seconds, failures linger a little longer, and only
 * a program asking for a human (attention) stays until it is focused, answered
 * or replaced. Long-running is shown once, briefly; /sessions owns the state.
 */
export const NOTICE_VISIBLE_MS = {
  completed: 12_000,
  ended: 20_000,
  endedAbnormal: 45_000,
  failed: 45_000,
  longRunning: 10_000,
} as const;

/** Visibility window in ms, or undefined for a sticky notice (attention). */
export function noticeVisibleMs(notice: SessionNotice): number | undefined {
  switch (notice.kind) {
    case 'completed': return NOTICE_VISIBLE_MS.completed;
    case 'failed': return NOTICE_VISIBLE_MS.failed;
    case 'long-running': return NOTICE_VISIBLE_MS.longRunning;
    case 'ended': return notice.exitCode ? NOTICE_VISIBLE_MS.endedAbnormal : NOTICE_VISIBLE_MS.ended;
    case 'attention': case 'input': return undefined;
  }
}

/** When the notice stops being shown (epoch ms); undefined while it is sticky. */
export function noticeExpiresAt(notice: SessionNotice): number | undefined {
  const visible = noticeVisibleMs(notice);
  return visible === undefined ? undefined : notice.at + visible;
}

export function noticeVisible(notice: SessionNotice, now: number): boolean {
  const expires = noticeExpiresAt(notice);
  return expires === undefined || now < expires;
}

/** Stable identity of one transition: the same transition is never shown twice. */
export function noticeKey(notice: SessionNotice): string {
  return `${notice.sessionId}:${notice.kind}:${notice.at}`;
}

/** Program word and agent identity for a command line; arguments are dropped here. */
export function programIdentity(command: string | undefined, process?: string): {program?: string; agent?: string} {
  const agent = (command ? detectAgentCommand(command) : undefined) ?? detectAgentProcess(process);
  const program = command ? commandWord(command) : undefined;
  return {...(program ? {program: program.slice(0, 64)} : {}), ...(agent ? {agent: agent.id} : {})};
}

/**
 * Service-side state machine for one session's notice. Only the latest
 * transition is kept (a newer one replaces an older one: dedupe by design).
 */
export class SessionNoticeTracker {
  private current?: SessionNotice;
  private running?: {command: string; since: number; process?: string};
  /** The run a long-running notice was already raised for. */
  private longRaisedFor?: number;
  /** Attention requested at or before this time was already seen by someone focusing the session. */
  private clearedAt = -1;

  constructor(private readonly sessionId: string) {}

  onExec(command: string, at: number): void {
    this.running = {command, since: at};
    this.longRaisedFor = undefined;
  }

  /** Foreground process name, when the platform reports it (agents launched through a wrapper). */
  observeProcess(process: string | undefined): void {
    if (this.running && process) this.running.process = process;
  }

  onPrompt(exitCode: number, at: number, cwd: string): void {
    const run = this.running;
    this.running = undefined;
    if (!run) return;
    // Ctrl+C (130) is the user acting in that session, not news to report elsewhere.
    if (exitCode === 130) { this.current = undefined; return; }
    this.current = {sessionId: this.sessionId, kind: exitCode === 0 ? 'completed' : 'failed', at,
      ...programIdentity(run.command, run.process), exitCode, durationMs: Math.max(0, at - run.since), cwd};
  }

  /** The running program asked for attention (evidence from its own output stream). */
  onAttention(at: number): void {
    if (!this.running || at <= this.clearedAt) return;
    if (this.current?.kind === 'attention' && this.current.at >= this.running.since) return;
    this.current = {sessionId: this.sessionId, kind: 'attention', at, ...programIdentity(this.running.command, this.running.process)};
  }

  /**
   * The running program has been waiting for input (since `since`) long enough to be news. One notice per wait;
   * sticky until the wait ends, the session is focused, or a newer transition replaces it.
   */
  onInputNeeded(since: number, confidence: string, program?: string): void {
    if (!this.running || since <= this.clearedAt) return;
    if (this.current?.kind === 'input' && this.current.at === since) return;
    this.current = {sessionId: this.sessionId, kind: 'input', at: since, ...programIdentity(this.running.command, program ?? this.running.process), confidence};
  }

  /** The wait ended (answered, interrupted, or the program moved on): an input notice is no longer true. */
  onInputResolved(): void {
    if (this.current?.kind === 'input') this.current = undefined;
  }

  /** Raise one long-running notice per run, lazily when someone lists sessions; no timers. */
  checkLongRunning(now: number): void {
    const run = this.running;
    if (!run || this.longRaisedFor === run.since || now - run.since < LONG_RUNNING_MS) return;
    if (this.current && this.current.at >= run.since) return;
    this.longRaisedFor = run.since;
    this.current = {sessionId: this.sessionId, kind: 'long-running', at: now, ...programIdentity(run.command, run.process),
      durationMs: now - run.since};
  }

  /** The session was focused somewhere: its notice is no longer news anywhere. */
  clear(now = Date.now()): void {
    this.current = undefined;
    this.clearedAt = now;
  }

  ended(exitCode: number, at: number, cwd: string): SessionNotice {
    return {sessionId: this.sessionId, kind: 'ended', at, exitCode, cwd};
  }

  get notice(): SessionNotice | undefined { return this.current; }
}

/** Bounded, expiring list of notices for sessions that no longer exist. */
export class EndedNotices {
  private notices: SessionNotice[] = [];

  add(notice: SessionNotice): void {
    this.notices = [notice, ...this.notices.filter(item => item.sessionId !== notice.sessionId)].slice(0, MAX_ENDED_NOTICES);
  }

  dismiss(sessionId: string): boolean {
    const before = this.notices.length;
    this.notices = this.notices.filter(item => item.sessionId !== sessionId);
    return before !== this.notices.length;
  }

  list(now: number): SessionNotice[] {
    this.notices = this.notices.filter(item => now - item.at < ENDED_NOTICE_TTL_MS);
    return [...this.notices];
  }
}

// ---------------------------------------------------------------- frontend

export interface NoticeView {
  /** Up to MAX_VISIBLE_NOTICES rows; the last one may summarize overflow. */
  notices: SessionNotice[];
  /** Notices not shown individually. */
  hidden: number;
}

/**
 * Choose what to show: newest first, never this frontend's own session,
 * deduplicated by transition identity, capped at three rows. When there are
 * more, the third row becomes a collapsed "+N more" summary. With `now`, a
 * notice past its visibility window is not selected (see NOTICE_VISIBLE_MS).
 */
export function selectNotices(all: readonly SessionNotice[], ownSessionId: string | undefined, dismissed: ReadonlySet<string> = new Set(), now?: number): NoticeView {
  const seen = new Set<string>();
  const ordered = [...all]
    .filter(notice => notice.sessionId !== ownSessionId && !dismissed.has(noticeKey(notice)) && (now === undefined || noticeVisible(notice, now)))
    .sort((a, b) => b.at - a.at || a.sessionId.localeCompare(b.sessionId))
    .filter(notice => { const key = noticeKey(notice); if (seen.has(key)) return false; seen.add(key); return true; });
  if (ordered.length <= MAX_VISIBLE_NOTICES) return {notices: ordered, hidden: 0};
  return {notices: ordered.slice(0, MAX_VISIBLE_NOTICES - 1), hidden: ordered.length - (MAX_VISIBLE_NOTICES - 1)};
}

/** Short stable label for a session: its numeric position if known, else an id prefix. */
export function sessionLabel(sessionId: string, ordinal?: number): string {
  return ordinal !== undefined ? `Session ${ordinal}` : `Session ${sessionId.slice(0, 4)}`;
}

export interface NoticeLineParts {
  kind: NoticeKind;
  /** The glyph slot; the caller picks Nerd/Safe. */
  symbol: 'done' | 'attention' | 'failed' | 'ended' | 'long' | 'input';
  text: string;
}

const AGENT_NAMES: Record<string, string> = {claude: 'Claude', codex: 'Codex'};

/** Factual wording for one notice. */
export function describeNotice(notice: SessionNotice, label: string, now: number): NoticeLineParts {
  const who = notice.agent ? AGENT_NAMES[notice.agent] ?? notice.program : notice.program;
  const age = formatAge(Math.max(0, now - notice.at));
  const where = notice.cwd ? ` · ${tildePath(notice.cwd)}` : '';
  switch (notice.kind) {
    case 'completed':
      return {kind: notice.kind, symbol: 'done', text: `${label} · ${who ? `${who} finished` : 'command finished'}${notice.durationMs !== undefined ? ` after ${formatDuration(notice.durationMs)}` : ''} · ${age} ago`};
    case 'failed':
      return {kind: notice.kind, symbol: 'failed', text: `${label} · ${who ?? 'command'} failed (exit ${notice.exitCode ?? '?'}) · ${age} ago`};
    case 'attention':
      return {kind: notice.kind, symbol: 'attention', text: `${label} · ${who ?? 'program'} asked for attention · ${age} ago`};
    case 'input':
      return {kind: notice.kind, symbol: 'input', text: `${label} · ${who ?? 'a command'} ${notice.confidence === 'likely' ? 'may be waiting for input' : 'is waiting for input'} · ${age} · /resume`};
    case 'input':
      return {kind: notice.kind, symbol: 'input', text: `${label} · ${who ?? 'a command'} ${notice.confidence === 'likely' ? 'may be waiting for input' : 'is waiting for input'} · ${age} · /resume`};
    case 'long-running':
      return {kind: notice.kind, symbol: 'long', text: `${label} · ${who ?? 'command'} still running · ${formatDuration(notice.durationMs ?? 0)}`};
    case 'ended':
      return {kind: notice.kind, symbol: 'ended', text: `${label} · shell ended${notice.exitCode ? ` (exit ${notice.exitCode})` : ''}${where} · ${age} ago`};
  }
}
