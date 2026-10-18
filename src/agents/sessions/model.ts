import {displayText} from '../transcript/projection.js';
/**
 * Agent sessions: NMSh's view of sessions owned by external agent harnesses.
 * An agent session is not a shell session and not a model connection: the
 * harness owns models, auth, conversation, tools and permissions. Adapters
 * turn each harness's own protocol into these normalized events.
 */

/** managed: launched by NMSh with a supported control channel. attachable: NMSh can prove and rejoin it. observed: a known process, metadata only. */
export type AgentLevel = 'managed' | 'attachable' | 'observed';

export type AgentState = 'starting' | 'working' | 'waiting' | 'approval' | 'choice' | 'finished' | 'failed' | 'running' | 'exited';

export interface AgentQuestion {question: string; header: string; options: Array<{label: string; description: string}>; multiSelect: boolean}

/**
 * A tool's structured result as the provider reported it (Claude Code's `tool_use_result`), bounded and normalized.
 * Only facts the provider supplied: a diff is the provider's own patch hunks, never one NMSh computed.
 */
export type ToolResult =
  | {kind: 'patch'; path: string; hunks: import('../telemetry.js').PatchHunk[]; added: number; removed: number; created: boolean; truncated: boolean}
  | {kind: 'read'; path: string; lines?: number; start?: number; total?: number; image?: boolean}
  | {kind: 'bash'; stdout: string; stderr: string; interrupted: boolean; background?: string; truncated: boolean}
  | {kind: 'search'; files: number; matches?: number; truncated?: boolean; names: string[]}
  | {kind: 'todos'; todos: import('../telemetry.js').TodoItem[]}
  | {kind: 'agent'; text: string; tokens?: number; toolUses?: number; durationMs?: number; agentType?: string};

/** A rule change the provider offers alongside a permission request ("allow this command for the session"). */
export interface PermissionSuggestion {
  /** The provider's own update object, returned verbatim when the person chooses it. */
  update: Record<string, unknown>;
  /** Plain words for the offer, built from the update's typed fields. */
  label: string;
  /** Session-only offers change nothing on disk; others write the named settings file. */
  destination: string;
}

export type AgentEvent =
  | {kind: 'requestsCleared'}
  | {kind: 'choice'; requestId: string; questions: AgentQuestion[]}
  | {kind: 'choiceAnswered'; requestId: string; answers: Record<string, string>}
  | {kind: 'incomplete'; reason: string}
  | {kind: 'started'; harnessSessionId?: string}
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  /** A tool call; `target` is a factual file/command from the harness event, never inferred. `parent` is the subagent's spawning tool call. */
  | {kind: 'tool'; id: string; name: string; target?: string; status: 'started' | 'finished' | 'failed'; detail?: string; input?: Record<string, unknown>; result?: ToolResult; parent?: string}
  | {kind: 'approval'; requestId: string; tool: string; target?: string; input?: Record<string, unknown>; toolUseId?: string; title?: string; reason?: string;
    suggestions?: PermissionSuggestion[]; blockedPath?: string; defaultNo?: boolean}
  | {kind: 'approvalAnswered'; requestId: string; allowed: boolean; /** The rule change the person accepted with it, in words. */ remembered?: string}
  /** NMSh changed a runtime setting through a supported control and the provider acknowledged it. */
  | {kind: 'control'; field: 'model' | 'effort' | 'permissionMode'; value: string | null; label: string}
  /** The provider compacted the conversation (its context was summarized). */
  | {kind: 'compacted'; trigger: string; preTokens: number; postTokens?: number}
  /** A finished turn. `message` is a factual failure reason from structured provider fields only; `interrupted` when the person interrupted it. */
  | {kind: 'settled'; ok: boolean; message?: string; interrupted?: boolean}
  /** The model the provider reports it is running (structured runtime evidence, never inferred). */
  | {kind: 'model'; model: string}
  | {kind: 'exited'; code: number | null}
  | {kind: 'renamed'; title: string};

export interface AgentSession {
  /** NMSh's id for this session. */
  id: string;
  harness: string;
  /** Named launch profile, separate from provider and NMSh target identity. */
  profileId?: string;
  level: AgentLevel;
  title: string;
  /** Familiar signature ("Autumn"), unique among this window's agent sessions; the title stays separately renamable. */
  signature?: string;
  cwd?: string;
  startedAt: number;
  state: AgentState;
  /** Factual activity ("Edit TerminalApp.ts") only from a harness tool event; otherwise undefined. */
  activity?: string;
  pid?: number;
  tty?: string;
  /** The harness's own session id, from its protocol. */
  harnessSessionId?: string;
  /** Bounded, in-memory visible transcript (managed sessions only). */
  events: AgentEvent[];
  pendingChoice?: {requestId: string; questions: AgentQuestion[]};
  reconnectable?: boolean;
  /** The runtime model from the provider's own structured events; absent until reported. */
  model?: string;
  pendingApproval?: {requestId: string; tool: string; target?: string; input?: Record<string, unknown>; toolUseId?: string; title?: string; reason?: string;
    suggestions?: PermissionSuggestion[]; blockedPath?: string; defaultNo?: boolean};
  /** Runtime facts with provenance (model, effort, context, usage, limits, files, tasks); absent on legacy fixtures. */
  telemetry?: import('../telemetry.js').AgentTelemetry;
  /** The reply streaming in now (presentation only, never source): replaced by the provider's completed message. */
  partial?: {text: string; at: number; thinking?: boolean};
  /** When the current turn started, for elapsed time in working state. */
  turnStartedAt?: number;
  /** Meaningful news the user has not acknowledged (approval, waiting, finished, failed, exited). */
  attention: boolean;
  updatedAt: number;
  /** Additive target facts and lifetime eligible-source store; absent on legacy fixtures. */
  capabilities?: import('../targets/capabilities.js').CapabilityFacts;
  transcript?: import('../transcript/model.js').AgentTranscript;
}

export const MAX_AGENT_EVENTS = 2000;
const cacheBudgets = new WeakMap<AgentSession, {sizes: number[]; bytes: number}>();

const FILLER = /^(?:(?:please|pls|can you|could you|would you|help me|i want to|i need to|let's|lets|go ahead and|now)\s+)+/iu;
const VERBS = /^(?:implement|add|fix|make|create|update|write|refactor|build|change|improve|investigate|look into|review|debug|set up|setup)\s+(?:the\s+|a\s+|an\s+|my\s+|our\s+)?/iu;

/** A compact deterministic title from the first prompt: "implement the Ask chat viewport and fix folding" → "Ask chat viewport". */
export function titleFromPrompt(prompt: string, fallback: string): string {
  let text = displayText(prompt).split('\n')[0]!.trim().replace(FILLER, '').replace(VERBS, '');
  text = text.split(/\s+(?:and|then|so|because|but)\s+|[,.;:!?(]/u)[0]!.trim();
  const words = text.split(/\s+/u).filter(Boolean).slice(0, 4);
  if (!words.length || words.join(' ').length < 3) return fallback;
  const title = words.join(' ').slice(0, 40);
  return title[0]!.toUpperCase() + title.slice(1);
}

/** Factual one-line activity from a tool event: "Edit TerminalApp.ts", "Bash npm test". */
export function toolActivity(name: string, target?: string): string {
  name = displayText(name).slice(0, 100);
  if (target) target = displayText(target).slice(0, 160);
  const base = target ? (target.includes('/') && !/\s/u.test(target) ? target.slice(target.lastIndexOf('/') + 1) : target) : '';
  return `${name}${base ? ` ${base.length > 40 ? `${base.slice(0, 39)}…` : base}` : ''}`;
}

export function pushEvent(session: AgentSession, event: AgentEvent, now = Date.now()): void {
  session.transcript?.append(event);
  // This array is only the recent presentation cache; complete source lives in transcript.
  const excerpt = (text: string) => text.length > 4000 ? `${text.slice(0, 4000)}\n[excerpt · use eligible source store]` : text;
  const preview = event.kind === 'tool' ? {kind: event.kind, id: event.id, name: event.name, target: event.target, status: event.status, ...(event.detail ? {detail: excerpt(event.detail)} : {}), ...(event.parent ? {parent: event.parent} : {})}
    : event.kind === 'approval' ? {kind: event.kind, requestId: event.requestId, tool: event.tool, target: event.target}
    : event.kind === 'user' || event.kind === 'assistant' ? {...event, text: excerpt(event.text)}
    : event.kind === 'choice' ? {...event, questions: event.questions.map(q => ({...q, question: q.question.slice(0, 200), options: q.options.map(o => ({label: o.label.slice(0, 100), description: o.description.slice(0, 200)}))}))}
    : event.kind === 'choiceAnswered' ? {...event, answers: Object.fromEntries(Object.entries(event.answers).map(([key, value]) => [key.slice(0, 200), value.slice(0, 200)]))}
    : event;
  let budget = cacheBudgets.get(session);
  if (!budget || budget.sizes.length !== session.events.length) {
    const sizes = session.events.map(e => Buffer.byteLength(JSON.stringify(e)));
    budget = {sizes, bytes: sizes.reduce((a, b) => a + b, 0)}; cacheBudgets.set(session, budget);
  }
  const size = Buffer.byteLength(JSON.stringify(preview));
  session.events.push(preview); budget.sizes.push(size); budget.bytes += size;
  while (session.events.length > MAX_AGENT_EVENTS || budget.bytes > 1024 * 1024) {session.events.shift(); budget.bytes -= budget.sizes.shift()!;}
  session.updatedAt = now;
  switch (event.kind) {
    case 'started': if (event.harnessSessionId) session.harnessSessionId = event.harnessSessionId; break;
    case 'user': session.state = 'working'; session.activity = undefined; session.attention = false; session.turnStartedAt = now; break;
    case 'tool': session.activity = event.status === 'started' ? toolActivity(event.name, event.target) : undefined; if (session.state !== 'approval') session.state = 'working'; break;
    case 'approval': {
      const {kind: _kind, ...request} = event;
      session.state = 'approval'; session.pendingApproval = request; session.attention = true; break;
    }
    case 'choice': session.pendingChoice = {requestId: event.requestId, questions: event.questions}; session.state = 'choice'; session.attention = true; break;
    case 'choiceAnswered': session.pendingChoice = undefined; session.state = 'working'; break;
    case 'approvalAnswered': session.pendingApproval = undefined; session.state = 'working'; break;
    case 'requestsCleared': session.pendingApproval = undefined; session.pendingChoice = undefined; break;
    case 'settled': session.state = 'waiting'; session.pendingApproval = undefined; session.pendingChoice = undefined; session.activity = undefined; session.attention = true; session.partial = undefined; session.turnStartedAt = undefined; break;
    case 'exited': session.state = event.code === 0 ? 'exited' : 'failed'; session.activity = undefined; session.attention = true; session.pendingApproval = undefined; session.pendingChoice = undefined; session.partial = undefined; session.turnStartedAt = undefined; break;
    case 'assistant': if (session.state !== 'approval') session.state = 'working'; session.partial = undefined; break;
    case 'renamed': session.title = event.title; break;
    case 'model': session.model = event.model; break;
  }
}

/** One factual line for a finished turn: never a contradiction such as "failed: success". */
export function settledText(event: {ok: boolean; message?: string; interrupted?: boolean}): string {
  if (event.ok) return 'Finished; waiting for you.';
  if (event.interrupted) return 'Interrupted; waiting for you.';
  return event.message ? `Run failed: ${event.message}.` : 'Run failed.';
}
