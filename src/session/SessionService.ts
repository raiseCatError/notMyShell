import {QueueDispatcher} from './QueueDispatcher.js';
import {assignSignature} from './signatures.js';
import {randomUUID} from 'node:crypto';
import {chmodSync, lstatSync, unlinkSync} from 'node:fs';
import {connect, createServer, type Server, type Socket} from 'node:net';
import {ShellSession} from '../shell/ShellSession.js';
import {isShellId, knowledgeJobCount, type ShellId} from '../shell/adapters/ShellAdapter.js';
import {shellAdapter} from '../shell/adapters/registry.js';
import {SessionEvidence} from './SessionEvidence.js';
import {FrameDecoder, PROTOCOL_VERSION, SERVICE_FEATURES, encodeMessage, inputStateMessage, parseClientFeatures, queueOpFrom, queueStateMessage, type ClientFeature, type ServerMessage,
  type SessionInfo, type SessionState} from './SessionProtocol.js';
import type {InputState} from './inputState.js';
import {SESSION_ID_ENV, SESSION_MODE_ENV} from './SessionClient.js';
import {ensurePrivateRuntimeDir, socketPathFor, spoolPathFor} from './runtimeDir.js';
import {EndedNotices, INPUT_NOTICE_DELAY_MS, SessionNoticeTracker} from './SessionNotices.js';
import {StreamBacklog, type BacklogEvent, type BacklogLimits} from './StreamBacklog.js';

export const SERVICE_NAME = 'nmshd';

export interface SessionRecord {
  id: string;
  pid: number;
  cwd: string;
  createdAt: string;
  state: SessionState;
  protocolVersion: number;
  /** Familiar signature ("Mango"), assigned once at creation and kept across reattaches. */
  signature?: string;
  /** The person's own name for the session, when they renamed it. */
  name?: string;
}

type Send = (message: ServerMessage) => void;

interface ManagedSession {
  record: SessionRecord;
  shell: ShellSession;
  /** Backend of the current shell; replaced in place by switch-shell. */
  backend: ShellId;
  /** Kept in memory only, to start a replacement backend with the same environment; never stored or logged. */
  env: Record<string, string>;
  size: {columns: number; rows: number};
  /** The one writable frontend; undefined while detached. */
  controller?: Send;
  /** What the controlling frontend said it understands (its hello). */
  controllerFeatures?: ReadonlySet<ClientFeature>;
  /** The running command's input state (InputWatch, beside the PTY): the one source every surface reads. */
  input?: InputState;
  /** Pending check that a wait lasted long enough to become a cross-session notice. */
  inputNoticeTimer?: NodeJS.Timeout;
  running?: {command: string; since: number; queued?: string};
  /** When zsh last returned to its prompt. */
  idleSince: number;
  screen: AlternateScreenTracker;
  /** Bumped by every frontend resize so a pending redraw step never overrides a newer size. */
  resizes: number;
  seq: number;
  backlog: StreamBacklog;
  /** What the foreground program's own output says: recency, title, attention, last exit. */
  evidence: SessionEvidence;
  /** This session's cross-session notice; cleared when the session is focused. */
  notices: SessionNoticeTracker;
  knowledge?: string;
  /** This session's command queue; it runs only in this session's shell (see QueueDispatcher). */
  queue: QueueDispatcher;
}

export {AlternateScreenTracker} from './TerminalModes.js';
import {AlternateScreenTracker} from './TerminalModes.js';

/** Delay between the two resizes that force a fullscreen app to repaint on attach. */
const REDRAW_NUDGE_MS = 40;

export interface SessionServiceOptions {
  runtimeDir: string;
  /** Exit if no frontend connects within this window after startup. */
  startupIdleMs?: number;
  backlogLimits?: BacklogLimits;
  /** Live sessions allowed at once; detached ones are never ended to make room. */
  maxSessions?: number;
  /** Build identity reported in the welcome (informational). */
  build?: string;
}

export const DEFAULT_MAX_SESSIONS = 16;

function toMessage(event: BacklogEvent): ServerMessage {
  switch (event.kind) {
    case 'output': return {type: 'output', data: event.data, seq: event.seq, at: event.at};
    case 'exec': return {type: 'exec', command: event.command, seq: event.seq, at: event.at,
      ...(event.historyAllowed === undefined ? {} : {historyAllowed: event.historyAllowed}), ...(event.queued === undefined ? {} : {queued: event.queued})};
    case 'prompt': return {type: 'prompt', exitCode: event.exitCode, cwd: event.cwd, seq: event.seq, at: event.at,
      ...(event.knowledge === undefined ? {} : {knowledge: event.knowledge}),
      ...(event.inputWaits ? {inputWaitMs: event.inputWaitMs ?? 0, inputWaits: event.inputWaits} : {})};
  }
}

export class ServiceAlreadyRunningError extends Error {}

function canConnect(path: string): Promise<boolean> {
  return new Promise(resolve => {
    const probe = connect(path);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

/**
 * Local per-user service owning PTY + managed zsh sessions. A session is
 * attached to at most one frontend connection; losing that connection for any
 * reason (window close, crash, SIGKILL) detaches it, and the shell keeps
 * running until zsh itself exits or a frontend terminates it. The service
 * exits once it has no sessions and no clients.
 */
export class SessionService {
  readonly socketPath: string;
  private server: Server | undefined;
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly connections = new Set<Socket>();
  private readonly endedNotices = new EndedNotices();
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;
  readonly done: Promise<void>;
  private resolveDone!: () => void;

  constructor(private readonly options: SessionServiceOptions) {
    this.socketPath = socketPathFor(options.runtimeDir);
    this.done = new Promise(resolve => { this.resolveDone = resolve; });
  }

  get registry(): SessionRecord[] {
    return [...this.sessions.values()].map(session => ({...session.record}));
  }

  private info(session: ManagedSession, features: ReadonlySet<ClientFeature> = new Set()): SessionInfo {
    const {record, running} = session;
    const request = running ? session.input?.request : undefined;
    const evidence = session.evidence.snapshot();
    // Read only when someone lists sessions; nothing polls the process table.
    const process = running ? session.shell.foregroundProcess : undefined;
    session.notices.observeProcess(process);
    if (evidence.attentionSince !== undefined) session.notices.onAttention(evidence.attentionSince);
    session.notices.checkLongRunning(Date.now());
    // A notice kind an older frontend cannot decode is left out for it (it would reject the whole list).
    const notice = session.notices.notice?.kind === 'input' && !features.has('input-state') ? undefined : session.notices.notice;
    return {id: record.id, pid: record.pid, state: record.state, cwd: record.cwd, createdAt: Date.parse(record.createdAt), shell: session.backend,
      ...(record.signature ? {signature: record.signature} : {}), ...(record.name ? {name: record.name} : {}),
      ...(running ? {running: running.command, runningSince: running.since} : {idleSince: session.idleSince}),
      ...(session.backlog.journalId ? {journalId: session.backlog.journalId} : {}),
      ...(process && process !== 'zsh' ? {process} : {}),
      ...(running && session.screen.active ? {fullscreen: 1} : {}),
      ...(evidence.lastOutputAt !== undefined ? {lastOutputAt: evidence.lastOutputAt} : {}),
      ...(evidence.title ? {title: evidence.title} : {}),
      ...(evidence.attentionSince !== undefined ? {attentionSince: evidence.attentionSince} : {}),
      ...(evidence.lastExit !== undefined && !running ? {lastExit: evidence.lastExit} : {}),
      ...(notice ? {notice} : {}),
      ...(request ? {inputSince: request.since, inputConfidence: request.confidence, inputMode: request.mode,
        ...(request.prompt ? {inputPrompt: request.prompt.slice(0, 120)} : {})} : {}),
      ...(features.has('queue') && session.queue.queue.size ? {queued: session.queue.queue.size,
        ...(session.queue.state.paused ? {queuePaused: session.queue.state.paused.reason} : {})} : {})};
  }

  async start(): Promise<void> {
    ensurePrivateRuntimeDir(this.options.runtimeDir);
    await this.clearStaleSocket();
    const server = createServer(socket => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.socketPath, () => { server.off('error', reject); resolve(); });
    });
    chmodSync(this.socketPath, 0o600);
    this.server = server;
    this.idleTimer = setTimeout(() => this.maybeShutdown(), this.options.startupIdleMs ?? 10_000);
  }

  private async clearStaleSocket(): Promise<void> {
    let stat;
    try { stat = lstatSync(this.socketPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (!stat.isSocket() || stat.uid !== process.getuid?.()) throw new Error('refusing unexpected file at socket path');
    if (await canConnect(this.socketPath)) throw new ServiceAlreadyRunningError('session service already running');
    unlinkSync(this.socketPath);
  }

  private accept(socket: Socket): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    this.connections.add(socket);
    socket.setEncoding('utf8');
    const decoder = new FrameDecoder();
    const send = (message: ServerMessage) => { if (!socket.destroyed) socket.write(encodeMessage(message)); };
    let greeted = false;
    let owned: ManagedSession | undefined;
    let features: ReadonlySet<ClientFeature> = new Set();

    socket.on('data', chunk => {
      for (const result of decoder.push(chunk as unknown as string)) {
        if (!result.ok) {
          if (!greeted) { send({type: 'error', code: 'protocol', message: result.error}); socket.end(); return; }
          send({type: 'error', code: 'malformed', message: result.error});
          continue;
        }
        const message = result.message;
        if (!greeted) {
          if (message.type !== 'hello' || message.version !== PROTOCOL_VERSION) {
            send({type: 'error', code: 'version',
              message: `service speaks protocol ${PROTOCOL_VERSION}; client sent ${message.type === 'hello' ? message.version : 'no handshake'}`});
            socket.end();
            return;
          }
          greeted = true;
          features = parseClientFeatures(message.features);
          send({type: 'welcome', version: PROTOCOL_VERSION, service: SERVICE_NAME, startupSafety: 1, features: SERVICE_FEATURES.join(','),
            ...(this.options.build ? {build: this.options.build} : {})});
          continue;
        }
        switch (message.type) {
          case 'create':
            if (owned) { send({type: 'error', code: 'state', message: 'connection already controls a session'}); break; }
            if (this.sessions.size >= (this.options.maxSessions ?? DEFAULT_MAX_SESSIONS)) {
              send({type: 'error', code: 'limit', message: `${this.sessions.size} live sessions are already running (the limit); end one or kill a detached one from /resume`});
              break;
            }
            try {
              const backend = message.shell === undefined ? 'zsh' : message.shell;
              if (!isShellId(backend)) throw new Error(`unknown shell backend ${backend}`);
              owned = this.create(message.cwd, message.env, message.columns, message.rows, send, backend);
              owned.controllerFeatures = features;
              send({type: 'created', sessionId: owned.record.id, pid: owned.record.pid, shell: owned.backend});
            } catch (error) {
              send({type: 'error', code: 'spawn', message: error instanceof Error ? error.message : String(error)});
            }
            break;
          case 'attach': {
            if (owned) { send({type: 'error', code: 'state', message: 'connection already controls a session'}); break; }
            const session = this.sessions.get(message.sessionId);
            if (!session) { send({type: 'error', code: 'unknown', message: 'no live session with that id'}); break; }
            if (session.controller) { send({type: 'error', code: 'attached', message: 'session is attached to another frontend'}); break; }
            owned = session;
            this.bind(session, send, features);
            // Opening a session is focusing it: its notice is no longer news in any window.
            session.notices.clear();
            this.endedNotices.dismiss(session.record.id);
            const info = this.info(session, features);
            const {backlog} = session;
            send({type: 'attached', sessionId: info.id, pid: info.pid, cwd: info.cwd, fullscreen: session.screen.ownsTerminal ? 1 : 0,
              ...(session.screen.ownsTerminal && session.screen.restoreSequence() ? {modes: session.screen.restoreSequence()} : {}),
              ...(info.running ? {running: info.running, runningSince: info.runningSince} : {}),
              ...(features.has('queue') && session.running?.queued !== undefined ? {runningQueued: session.running.queued} : {}),
              ...(backlog.journalId ? {journalId: backlog.journalId} : {}), ackedSeq: backlog.ackedSeq,
              ...(session.knowledge === undefined ? {} : {knowledge: session.knowledge}), shell: session.backend,
              ...(session.shell.isReady ? {} : {startup: session.shell.startupTail() ?? ''})});
            // Everything the journal does not have yet, then the live stream continues.
            const missed = backlog.events();
            for (const event of missed) send(toMessage(event));
            send({type: 'replayed', truncatedBytes: backlog.truncatedBytes});
            // The live input state is not a stream event: a reattaching frontend gets it now, after the replay.
            if (features.has('input-state') && info.running && session.input) send(inputStateMessage(session.input));
            if (features.has('queue')) send(queueStateMessage(session.queue.state, {}));
            this.redraw(session, message.columns, message.rows);
            break;
          }
          case 'detach':
            if (owned) {
              const id = owned.record.id;
              this.detach(owned, send);
              owned = undefined;
              send({type: 'detached', sessionId: id});
            }
            break;
          case 'list':
            send({type: 'sessions', sessions: [...this.sessions.values()].map(session => this.info(session, features)), ended: this.endedNotices.list(Date.now())});
            break;
          case 'dismiss':
            this.sessions.get(message.sessionId)?.notices.clear();
            this.endedNotices.dismiss(message.sessionId);
            send({type: 'dismissed', sessionId: message.sessionId});
            break;
          case 'queue': {
            const change = queueOpFrom(message.change);
            if (!owned || !features.has('queue')) send({type: 'error', code: 'state', message: 'no session queue for this connection'});
            else if (!change) send({type: 'error', code: 'queue', message: 'not a queue change'});
            else owned.queue.request(change);
            break;
          }
          case 'input':
            // Ctrl+C reaching a running command: what was queued after it waits (see QueueDispatcher).
            if (message.data.includes('\u0003')) owned?.queue.onInterrupt();
            owned?.evidence.onInput();
            owned?.notices.clear();
            if (owned) {
              const rejected = (data: string, submission: boolean) => send({type: 'input-rejected', data, submission: submission ? 1 : 0});
              owned.shell.once('inputRejected', rejected);
              owned.shell.write(message.data, message.submission === 1);
              owned.shell.off('inputRejected', rejected);
            }
            break;
          case 'switch-shell': {
            if (!owned) { send({type: 'error', code: 'state', message: 'no session to switch'}); break; }
            const refusal = this.switchRefusal(owned, message.shell);
            if (refusal) { send({type: 'error', code: refusal.code, message: refusal.message}); break; }
            try {
              this.switchShell(owned, message.shell as ShellId, message.cwd);
              send({type: 'shell-switched', shell: owned.backend, pid: owned.record.pid});
            } catch (error) {
              send({type: 'error', code: 'switch-failed', message: error instanceof Error ? error.message : String(error)});
            }
            break;
          }
          case 'rename': {
            const target = this.sessions.get(message.sessionId);
            if (!target) { send({type: 'error', code: 'unknown', message: 'no live session with that id'}); break; }
            const name = message.name.replace(/[\u0000-\u001f\u007f]/gu, '').trim().slice(0, 40);
            if (name) target.record.name = name; else delete target.record.name;
            send({type: 'sessions', sessions: [...this.sessions.values()].map(session => this.info(session, features)), ended: this.endedNotices.list(Date.now())});
            break;
          }
          case 'resize':
            if (owned) { owned.size = {columns: message.columns, rows: message.rows}; owned.resizes += 1; this.resize(owned, message.columns, message.rows, send); }
            break;
          case 'ack': owned?.backlog.ack(message.seq, message.journalId); break;
          case 'kill': {
            const target = this.sessions.get(message.sessionId);
            if (!target) { send({type: 'error', code: 'unknown', message: 'no live session with that id'}); break; }
            // Never pull a shell out from under a frontend that is using it.
            if (target.controller) { send({type: 'error', code: 'attached', message: 'session is attached to another frontend'}); break; }
            target.shell.once('exit', () => send({type: 'killed', sessionId: message.sessionId}));
            target.shell.kill();
            break;
          }
          case 'terminate': owned?.shell.kill(); break;
          default: send({type: 'error', code: 'unsupported', message: `unsupported message ${message.type}`});
        }
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      this.connections.delete(socket);
      // The frontend is gone however it left (even SIGKILL): detach, never kill.
      if (owned) this.detach(owned, send);
      this.maybeShutdown();
    });
  }

  private bind(session: ManagedSession, send: Send, features: ReadonlySet<ClientFeature>): void {
    session.controller = send;
    session.controllerFeatures = features;
    session.record.state = 'attached';
  }

  private detach(session: ManagedSession, send: Send): void {
    if (session.controller !== send) return;
    session.controller = undefined;
    session.controllerFeatures = undefined;
    session.record.state = 'detached';
  }

  /**
   * A new input state from the session's watch: the attached frontend hears it at once; a wait that lasts becomes
   * one cross-session notice (sticky until answered or focused), and a resolved wait withdraws it.
   */
  private onInputState(session: ManagedSession, state: InputState): void {
    const before = session.input?.request;
    session.input = state;
    if (session.controllerFeatures?.has('input-state')) session.controller?.(inputStateMessage(state));
    const request = state.request;
    if (!request) {
      if (session.inputNoticeTimer) { clearTimeout(session.inputNoticeTimer); session.inputNoticeTimer = undefined; }
      if (before) session.notices.onInputResolved();
      return;
    }
    if (before?.since === request.since && session.inputNoticeTimer) return;
    if (session.inputNoticeTimer) clearTimeout(session.inputNoticeTimer);
    session.inputNoticeTimer = setTimeout(() => {
      session.inputNoticeTimer = undefined;
      const current = session.input?.request;
      if (current && current.since === request.since) session.notices.onInputNeeded(current.since, current.confidence, current.program);
    }, Math.max(0, request.since + INPUT_NOTICE_DELAY_MS - Date.now()));
    session.inputNoticeTimer.unref?.();
  }

  /**
   * Adopt the attaching frontend's size. A fullscreen app only repaints on a
   * real size change, so step through a neighbouring size first: each step
   * delivers SIGWINCH and the final one lands on the new frontend's size.
   */
  private redraw(session: ManagedSession, columns: number, rows: number): void {
    this.resize(session, columns, rows > 2 ? rows - 1 : rows + 1, session.controller);
    const generation = session.resizes;
    setTimeout(() => {
      if (this.sessions.has(session.record.id) && session.resizes === generation) this.resize(session, columns, rows, session.controller);
    }, REDRAW_NUDGE_MS);
  }

  /**
   * Resize one session's PTY without letting a failure escape into the
   * service: nmshd owns every live session, so one session's PTY error must
   * never end the others. ShellSession already ignores the benign teardown
   * race; anything else is reported to the client that caused it.
   */
  private resize(session: ManagedSession, columns: number, rows: number, send?: Send): void {
    try {
      session.shell.resize(columns, rows);
    } catch (error) {
      send?.({type: 'error', code: 'resize', message: `could not resize the session: ${error instanceof Error ? error.message : String(error)}`});
    }
  }

  private create(cwd: string, env: Record<string, string>, columns: number, rows: number, send: Send, backend: ShellId = 'zsh'): ManagedSession {
    // The shell gets the launching frontend's environment and cwd, never the
    // service's own startup state. The env is opaque: it is not stored or logged.
    const id = randomUUID();
    const shell = new ShellSession(cwd, columns, rows, env.HOME || '', {...env, [SESSION_MODE_ENV]: 'service', [SESSION_ID_ENV]: id}, backend);
    // A familiar signature unique among live sessions, assigned once; reattaching never changes it.
    const signature = assignSignature(id, [...this.sessions.values()].flatMap(item => item.record.signature ? [item.record.signature] : []));
    const record: SessionRecord = {id, pid: shell.pid, cwd, createdAt: new Date().toISOString(),
      state: 'attached', protocolVersion: PROTOCOL_VERSION, signature};
    const session: ManagedSession = {record, shell, backend, env, size: {columns, rows}, controller: send, idleSince: Date.now(), screen: new AlternateScreenTracker(), resizes: 0,
      seq: 0, backlog: new StreamBacklog(spoolPathFor(this.options.runtimeDir, record.id), this.options.backlogLimits),
      evidence: new SessionEvidence(), notices: new SessionNoticeTracker(record.id), queue: new QueueDispatcher(shell)};
    session.queue.on('state', (state, event) => {
      if (session.controllerFeatures?.has('queue')) session.controller?.(queueStateMessage(state, event));
    });
    this.sessions.set(record.id, session);
    this.wire(session);
    return session;
  }

  /** Connect a session's current shell to its stream. Every event is retained until a frontend journal acknowledges it. */
  private wire(session: ManagedSession): void {
    const {record, shell} = session;
    const emit = (event: BacklogEvent, live: ServerMessage = toMessage(event)) => {
      session.backlog.append(event);
      session.controller?.(live);
    };
    shell.on('data', data => {
      const at = Date.now();
      session.evidence.observe(data, at);
      session.screen.observeModes(data);
      const kept = session.screen.push(data);
      if (kept) emit({kind: 'output', seq: ++session.seq, at, data: kept}, {type: 'output', data, seq: session.seq, at});
      else session.controller?.({type: 'output', data});
    });
    shell.on('startup', output => session.controller?.({type: 'startup', output}));
    shell.on('inputState', state => this.onInputState(session, state));
    shell.on('exec', (command, historyAllowed) => {
      const at = Date.now();
      // The queue says whether this is the entry it just submitted: every window, live or later, learns it from here.
      const queued = session.queue.onExec(command)?.text;
      session.running = {command, since: at, ...(queued === undefined ? {} : {queued})};
      session.evidence.onExec();
      session.notices.onExec(command, at);
      emit({kind: 'exec', seq: ++session.seq, at, command, ...(historyAllowed === undefined ? {} : {historyAllowed}), ...(queued === undefined ? {} : {queued})});
    });
    shell.on('prompt', marker => {
      session.knowledge = marker.knowledge;
      record.cwd = marker.cwd;
      session.running = undefined;
      session.idleSince = Date.now();
      session.evidence.onPrompt(marker.exitCode);
      session.notices.onPrompt(marker.exitCode, Date.now(), marker.cwd);
      session.screen.reset();
      emit({kind: 'prompt', seq: ++session.seq, at: Date.now(), exitCode: marker.exitCode, cwd: marker.cwd,
        ...(marker.knowledge === undefined ? {} : {knowledge: marker.knowledge}),
        ...(marker.inputWaits ? {inputWaitMs: marker.inputWaitMs ?? 0, inputWaits: marker.inputWaits} : {})});
      // After the prompt is on its way: the next queued command, if any, starts from this evidence only.
      session.queue.onPrompt(marker.exitCode);
    });
    shell.on('exit', event => {
      session.queue.onShellExit();
      this.sessions.delete(record.id);
      if (session.inputNoticeTimer) { clearTimeout(session.inputNoticeTimer); session.inputNoticeTimer = undefined; }
      // Ending with no window attached is news; with one attached, that window saw it.
      if (!session.controller) this.endedNotices.add(session.notices.ended(event.exitCode, Date.now(), record.cwd));
      // Detached: keep what the journal lacks on disk for archiving. Attached:
      // the frontend journal is authoritative and the backlog goes.
      if (session.controller) session.backlog.dispose();
      else session.backlog.finish(event.exitCode, Date.now());
      session.controller?.({type: 'exit', exitCode: event.exitCode, ...(event.signal ? {signal: event.signal} : {})});
      session.controller = undefined;
      this.maybeShutdown();
    });
  }

  /**
   * Why a backend switch must not happen now, if anything would be lost: a
   * running command or full-screen program, a shell still starting, or
   * background/stopped jobs (ending the old shell would end them too).
   */
  private switchRefusal(session: ManagedSession, target: string): {code: string; message: string} | undefined {
    if (!isShellId(target)) return {code: 'unknown-shell', message: `${target} is not a supported shell backend (zsh, fish, bash).`};
    if (target === session.backend) return {code: 'same-shell', message: `This session already runs ${shellAdapter(target).label}.`};
    const available = shellAdapter(target).unavailableReason(session.env);
    if (available) return {code: 'unavailable', message: available};
    if (!session.shell.isReady) return {code: 'busy', message: 'The current shell is still starting; switch once it is ready.'};
    if (session.running) return {code: 'busy', message: `"${session.running.command.slice(0, 60)}" is still running; switching would end it. Finish or interrupt it first.`};
    if (session.screen.ownsTerminal) return {code: 'busy', message: 'A full-screen program owns the terminal; switching would end it.'};
    const jobs = knowledgeJobCount(session.knowledge);
    if (jobs) return {code: 'jobs', message: `${jobs} background or stopped job${jobs === 1 ? '' : 's'} would end with the current shell. Finish them first (jobs, fg, kill %N).`};
    return undefined;
  }

  /**
   * Replace the shell process under the same session identity. The old
   * shell's listeners are removed before it is ended, so its exit never ends
   * the session; the new one starts in cwd with the original environment.
   */
  private switchShell(session: ManagedSession, target: ShellId, cwd: string): void {
    const next = new ShellSession(cwd, session.size.columns, session.size.rows, session.env.HOME || '', {...session.env, [SESSION_MODE_ENV]: 'service',
      [SESSION_ID_ENV]: session.record.id}, target);
    const previous = session.shell;
    previous.removeAllListeners();
    previous.kill();
    session.shell = next;
    session.backend = target;
    session.record.pid = next.pid;
    session.record.cwd = cwd;
    session.knowledge = undefined;
    session.running = undefined;
    session.idleSince = Date.now();
    session.screen.reset();
    session.queue.onShellSwitched(next);
    this.wire(session);
  }

  private maybeShutdown(): void {
    if (this.sessions.size === 0 && this.connections.size === 0) void this.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const session of this.sessions.values()) session.shell.kill();
    this.sessions.clear();
    for (const socket of this.connections) socket.destroy();
    // Closing the listening server unlinks its socket path.
    await new Promise<void>(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.resolveDone();
  }
}

export async function runSessionService(options: SessionServiceOptions): Promise<void> {
  const service = new SessionService(options);
  try {
    await service.start();
  } catch (error) {
    if (error instanceof ServiceAlreadyRunningError) return;
    throw error;
  }
  const stop = () => void service.close();
  process.once('SIGTERM', stop);
  process.once('SIGHUP', stop);
  process.once('SIGINT', stop);
  await service.done;
}
