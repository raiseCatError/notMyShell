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

export type AgentEvent =
  | {kind: 'requestsCleared'}
  | {kind: 'choice'; requestId: string; questions: AgentQuestion[]}
  | {kind: 'choiceAnswered'; requestId: string; answers: Record<string, string>}
  | {kind: 'incomplete'; reason: string}
  | {kind: 'started'; harnessSessionId?: string}
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  /** A tool call; `target` is a factual file/command from the harness event, never inferred. */
  | {kind: 'tool'; id: string; name: string; target?: string; status: 'started' | 'finished' | 'failed'; detail?: string; input?: Record<string, unknown>}
  | {kind: 'approval'; requestId: string; tool: string; target?: string; input?: Record<string, unknown>}
  | {kind: 'approvalAnswered'; requestId: string; allowed: boolean}
  | {kind: 'settled'; ok: boolean; message?: string}
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
  pendingApproval?: {requestId: string; tool: string; target?: string; input?: Record<string, unknown>};
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
  const preview = event.kind === 'tool' ? {kind: event.kind, id: event.id, name: event.name, target: event.target, status: event.status, ...(event.detail ? {detail: excerpt(event.detail)} : {})}
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
    case 'user': session.state = 'working'; session.activity = undefined; session.attention = false; break;
    case 'assistant': if (session.state !== 'approval') session.state = 'working'; break;
    case 'tool': session.activity = event.status === 'started' ? toolActivity(event.name, event.target) : undefined; if (session.state !== 'approval') session.state = 'working'; break;
    case 'approval': session.state = 'approval'; session.pendingApproval = {requestId: event.requestId, tool: event.tool, ...(event.target ? {target: event.target} : {}), ...(event.input ? {input: event.input} : {})}; session.attention = true; break;
    case 'choice': session.pendingChoice = {requestId: event.requestId, questions: event.questions}; session.state = 'choice'; session.attention = true; break;
    case 'choiceAnswered': session.pendingChoice = undefined; session.state = 'working'; break;
    case 'approvalAnswered': session.pendingApproval = undefined; session.state = 'working'; break;
    case 'requestsCleared': session.pendingApproval = undefined; session.pendingChoice = undefined; break;
    case 'settled': session.state = 'waiting'; session.pendingApproval = undefined; session.pendingChoice = undefined; session.activity = undefined; session.attention = true; break;
    case 'exited': session.state = event.code === 0 ? 'exited' : 'failed'; session.activity = undefined; session.attention = true; session.pendingApproval = undefined; session.pendingChoice = undefined; break;
    case 'renamed': session.title = event.title; break;
  }
}
