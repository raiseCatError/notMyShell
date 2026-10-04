/**
 * Agent sessions: NMSh's view of sessions owned by external agent harnesses.
 * An agent session is not a shell session and not a model connection: the
 * harness owns models, auth, conversation, tools and permissions. Adapters
 * turn each harness's own protocol into these normalized events.
 */

/** managed: launched by NMSh with a supported control channel. attachable: NMSh can prove and rejoin it. observed: a known process, metadata only. */
export type AgentLevel = 'managed' | 'attachable' | 'observed';

export type AgentState = 'starting' | 'working' | 'waiting' | 'approval' | 'finished' | 'failed' | 'running' | 'exited';

export type AgentEvent =
  | {kind: 'started'; harnessSessionId?: string}
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  /** A tool call; `target` is a factual file/command from the harness event, never inferred. */
  | {kind: 'tool'; id: string; name: string; target?: string; status: 'started' | 'finished' | 'failed'; detail?: string}
  | {kind: 'approval'; requestId: string; tool: string; target?: string}
  | {kind: 'approvalAnswered'; requestId: string; allowed: boolean}
  | {kind: 'settled'; ok: boolean; message?: string}
  | {kind: 'exited'; code: number | null}
  | {kind: 'renamed'; title: string};

export interface AgentSession {
  /** NMSh's id for this session. */
  id: string;
  harness: string;
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
  pendingApproval?: {requestId: string; tool: string; target?: string};
  /** Meaningful news the user has not acknowledged (approval, waiting, finished, failed, exited). */
  attention: boolean;
  updatedAt: number;
}

export const MAX_AGENT_EVENTS = 2000;

const FILLER = /^(?:(?:please|pls|can you|could you|would you|help me|i want to|i need to|let's|lets|go ahead and|now)\s+)+/iu;
const VERBS = /^(?:implement|add|fix|make|create|update|write|refactor|build|change|improve|investigate|look into|review|debug|set up|setup)\s+(?:the\s+|a\s+|an\s+|my\s+|our\s+)?/iu;

/** A compact deterministic title from the first prompt: "implement the Ask chat viewport and fix folding" → "Ask chat viewport". */
export function titleFromPrompt(prompt: string, fallback: string): string {
  let text = prompt.split('\n')[0]!.trim().replace(FILLER, '').replace(VERBS, '');
  text = text.split(/\s+(?:and|then|so|because|but)\s+|[,.;:!?(]/u)[0]!.trim();
  const words = text.split(/\s+/u).filter(Boolean).slice(0, 4);
  if (!words.length || words.join(' ').length < 3) return fallback;
  const title = words.join(' ').slice(0, 40);
  return title[0]!.toUpperCase() + title.slice(1);
}

/** Factual one-line activity from a tool event: "Edit TerminalApp.ts", "Bash npm test". */
export function toolActivity(name: string, target?: string): string {
  const base = target ? (target.includes('/') && !/\s/u.test(target) ? target.slice(target.lastIndexOf('/') + 1) : target) : '';
  return `${name}${base ? ` ${base.length > 40 ? `${base.slice(0, 39)}…` : base}` : ''}`;
}

export function pushEvent(session: AgentSession, event: AgentEvent, now = Date.now()): void {
  session.events.push(event);
  if (session.events.length > MAX_AGENT_EVENTS) session.events.splice(0, session.events.length - MAX_AGENT_EVENTS);
  session.updatedAt = now;
  switch (event.kind) {
    case 'started': if (event.harnessSessionId) session.harnessSessionId = event.harnessSessionId; break;
    case 'user': session.state = 'working'; session.activity = undefined; session.attention = false; break;
    case 'assistant': if (session.state !== 'approval') session.state = 'working'; break;
    case 'tool': session.activity = event.status === 'started' ? toolActivity(event.name, event.target) : session.activity; if (session.state !== 'approval') session.state = 'working'; break;
    case 'approval': session.state = 'approval'; session.pendingApproval = {requestId: event.requestId, tool: event.tool, ...(event.target ? {target: event.target} : {})}; session.attention = true; break;
    case 'approvalAnswered': session.pendingApproval = undefined; session.state = 'working'; break;
    case 'settled': session.state = event.ok ? 'waiting' : 'failed'; session.activity = undefined; session.attention = true; break;
    case 'exited': session.state = event.code === 0 ? 'exited' : 'failed'; session.activity = undefined; session.attention = true; session.pendingApproval = undefined; break;
    case 'renamed': session.title = event.title; break;
  }
}
