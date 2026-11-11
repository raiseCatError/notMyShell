/**
 * The only work the optional local model does, as small typed tasks with
 * strict output validation. The model receives bounded facts and returns
 * data; it never receives a shell and never returns anything NMSh runs.
 */

export const INTENT_ARGUMENT_KEYS = ['shell', 'target', 'worktree', 'when', 'query', 'provider'] as const;
export type IntentArguments = Partial<Record<typeof INTENT_ARGUMENT_KEYS[number], string>>;

export interface IntentRequest {
  text: string;
  capabilities: Array<{id: string; title: string}>;
  /** Compact facts only: names and labels, never contents. */
  facts: Record<string, string | string[]>;
}

export interface IntentInterpretation {
  capability: string | null;
  confidence: number;
  arguments: IntentArguments;
  clarification?: string;
}

export const FOLD_KINDS = ['noise', 'progress', 'test-detail', 'summary', 'warning', 'error', 'mixed'] as const;
export type FoldKind = typeof FOLD_KINDS[number];
export interface FoldRequest {command: string; exitCode: number; lines: string[]}
export interface FoldHint {kind: FoldKind; confidence: number}

const MAX_TEXT = 300;
const MAX_ARGUMENT = 120;

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key)) && required.every(key => key in value);
}

/**
 * Strict: unknown capabilities, extra fields, wrong types, long strings or
 * control characters all reject the whole interpretation. A command-like
 * field is simply an unexpected field.
 */
export function validateInterpretation(raw: unknown, capabilityIds: ReadonlySet<string>): IntentInterpretation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ['capability', 'confidence', 'arguments', 'clarification'], ['capability', 'confidence'])) return undefined;
  if (value.capability !== null && (typeof value.capability !== 'string' || !capabilityIds.has(value.capability))) return undefined;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return undefined;
  const args = value.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args) || !exactKeys(args as Record<string, unknown>, INTENT_ARGUMENT_KEYS, [])) return undefined;
  const cleaned: IntentArguments = {};
  for (const [key, item] of Object.entries(args as Record<string, unknown>)) {
    if (item === null || item === '') continue;
    if (typeof item !== 'string' || item.length > MAX_ARGUMENT || /[\u0000-\u001f\u007f]/u.test(item)) return undefined;
    cleaned[key as keyof IntentArguments] = item;
  }
  if (value.clarification !== undefined && (typeof value.clarification !== 'string' || value.clarification.length > 160 || /[\u0000-\u001f]/u.test(value.clarification))) return undefined;
  return {capability: value.capability as string | null, confidence: value.confidence, arguments: cleaned,
    ...(typeof value.clarification === 'string' ? {clarification: value.clarification} : {})};
}

export function validateFoldHint(raw: unknown): FoldHint | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ['kind', 'confidence'], ['kind', 'confidence'])) return undefined;
  if (!FOLD_KINDS.includes(value.kind as FoldKind)) return undefined;
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) return undefined;
  return {kind: value.kind as FoldKind, confidence: value.confidence};
}

/** JSON schemas handed to the runtime as a grammar, so output is structured before validation. */
export const INTENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['capability', 'confidence'],
  properties: {
    capability: {type: ['string', 'null']}, confidence: {type: 'number', minimum: 0, maximum: 1},
    arguments: {type: 'object', additionalProperties: false, properties: Object.fromEntries(INTENT_ARGUMENT_KEYS.map(key => [key, {type: 'string', maxLength: MAX_ARGUMENT}]))},
    clarification: {type: 'string', maxLength: 160},
  },
} as const;
export const FOLD_SCHEMA = {type: 'object', additionalProperties: false, required: ['kind', 'confidence'],
  properties: {kind: {type: 'string', enum: [...FOLD_KINDS]}, confidence: {type: 'number', minimum: 0, maximum: 1}}} as const;

export function intentPrompt(request: IntentRequest): string {
  const text = request.text.replace(/[\u0000-\u001f]+/gu, ' ').slice(0, MAX_TEXT);
  return [
    'You map a terminal user\'s request to ONE capability id from the list, or null. Reply with JSON only.',
    'Never invent files, sessions, branches or commands. Arguments are short words copied from the request.',
    `Capabilities:\n${request.capabilities.map(item => `${item.id}: ${item.title}`).join('\n')}`,
    `Facts:\n${Object.entries(request.facts).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')}`,
    `Request: ${text}`,
  ].join('\n\n');
}

export function foldPrompt(request: FoldRequest): string {
  return [
    'Classify this finished command output for folding. Reply with JSON only: {"kind": one of '
      + `${FOLD_KINDS.join(', ')}, "confidence": 0..1}. Errors and warnings must be classified as such.`,
    `Command: ${request.command}\nExit code: ${request.exitCode}`,
    `Output (excerpt):\n${request.lines.join('\n')}`,
  ].join('\n\n');
}

/** Likely secrets are masked before any excerpt reaches the model, even though inference is local. */
const SECRETS = [
  /\b(?:api[_-]?key|token|secret|password|passwd|pwd|auth|bearer|session)\b\s*[:=]\s*\S+/giu,
  /\b(?:ghp|gho|ghs|github_pat|sk|pk|xox[abpr]|AKIA)[-_A-Za-z0-9]{12,}\b/gu,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/gu,
  /\b[0-9a-f]{32,}\b/giu,
  /\b[A-Za-z0-9+/]{40,}={0,2}/gu,
  /:\/\/[^/\s:@]+:[^/\s@]+@/gu,
];
export function redact(line: string): string {
  let result = line;
  for (const pattern of SECRETS) result = result.replace(pattern, match => (match.includes('://') ? '://[redacted]@' : '[redacted]'));
  return result;
}

/**
 * A bounded excerpt of one finished block: program word and subcommand only
 * (arguments can carry secrets), head and tail lines, each truncated and
 * redacted. Never the whole transcript.
 */
export function foldExcerpt(command: string, output: string, exitCode: number, lines = 20, width = 160): FoldRequest {
  const words = command.trim().split(/\s+/u);
  const program = words.slice(0, words[1] && /^[a-z][\w-]*$/u.test(words[1]) ? 2 : 1).join(' ');
  const all = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').split('\n').map(line => line.replace(/\r/gu, '')).filter(line => line.trim());
  const picked = all.length <= lines * 2 ? all : [...all.slice(0, lines), `… ${all.length - lines * 2} lines …`, ...all.slice(-lines)];
  return {command: program.slice(0, 60), exitCode, lines: picked.map(line => redact(line).slice(0, width))};
}

/**
 * #432: one shell command for a request typed in Ask, from the person's own local model, only when they turned
 * command suggestions on. The model gets the request text, the shell and the OS family: never files, environment,
 * history, the transcript or any output. It returns data; NMSh validates it, labels its risk itself, and offers
 * Copy or Insert. Nothing it returns is ever run by NMSh.
 */
export interface CommandRequest {text: string; shell: 'zsh' | 'bash' | 'fish'; os: 'macOS' | 'Linux'}
export interface CommandSuggestion {command: string; explanation: string}

const MAX_COMMAND = 1024;
const MAX_EXPLANATION = 300;
/** Controls, escape sequences, and invisible format characters (bidi overrides and the like) are never accepted. */
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]/u;

export const COMMAND_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['command', 'explanation'],
  properties: {command: {type: ['string', 'null'], maxLength: MAX_COMMAND}, explanation: {type: 'string', maxLength: MAX_EXPLANATION}},
} as const;

/**
 * Strict: one plain line of at most 1 KiB and a short plain explanation, or `command: null` (the model declines).
 * A second line, an escape sequence, an invisible character, an extra field (a "risk" the model claims) or anything
 * oversized rejects the whole answer. Returns null when the model declined, undefined when the answer is unusable.
 */
export function validateCommandSuggestion(raw: unknown): CommandSuggestion | null | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ['command', 'explanation'], ['command', 'explanation'])) return undefined;
  // The explanation is the model's own words; it never speaks for NMSh (NMSh's verdict is shown beside it).
  if (typeof value.explanation !== 'string' || value.explanation.length > MAX_EXPLANATION || UNSAFE_TEXT.test(value.explanation) || /nmsh/iu.test(value.explanation)) return undefined;
  if (value.command === null) return null;
  if (typeof value.command !== 'string' || value.command.length > MAX_COMMAND || UNSAFE_TEXT.test(value.command)) return undefined;
  const command = value.command.trim();
  if (!command) return undefined;
  return {command, explanation: value.explanation.trim()};
}

export function commandPrompt(request: CommandRequest): string {
  const text = request.text.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, '').slice(0, MAX_TEXT);
  return [
    `You turn a terminal user's request into ONE shell command for ${request.shell} on ${request.os}. Reply with JSON only: `
      + '{"command": "...", "explanation": "one short sentence"}.',
    'If no single command does it, or you are not sure, reply {"command": null, "explanation": "why"}.',
    'One line only. Prefer read-only commands. Do not use sudo unless the request asks for it. No comments.',
    `Request: ${text}`,
  ].join('\n\n');
}

/**
 * A general answer: the conversational task behind Ask's questions. The model gets the question, a bounded recent
 * history from this one Ask conversation, the shell and OS family, and, only when the person asked about it, one
 * bounded, redacted excerpt of terminal output that NMSh selected and labelled. Never the environment, files or
 * credentials. Its reply is untrusted text: sanitized here, rendered by NMSh as plain text with NMSh's own styling,
 * never run and never turned into an action.
 */
export interface AnswerTurn {role: 'user' | 'assistant'; text: string}
export interface AnswerContext {
  /** What the excerpt is, as shown to the person ("output of npm test · exit 1 · last 40 lines, redacted"). */
  label: string;
  /** NMSh's own observation (a deterministic diagnosis), kept apart from the model's interpretation. */
  observed?: string;
  /** The bounded, redacted excerpt itself. */
  excerpt: string;
}
export interface AnswerRequest {
  question: string;
  history: AnswerTurn[];
  context?: AnswerContext;
  shell: 'zsh' | 'bash' | 'fish';
  os: 'macOS' | 'Linux';
}
export interface Answer {text: string; truncated: boolean}
/** Measured per answer by the runtime when it reports them (llama.cpp does); diagnostics only. */
export interface AnswerStats {promptTokens?: number; outputTokens?: number; promptMs?: number; generateMs?: number; tokensPerSecond?: number}

/**
 * Character budgets that keep the whole prompt well inside the runtime's context window (CONTEXT_TOKENS) with room
 * for the answer: question first, then the context excerpt, then as much recent history as still fits.
 */
export const ANSWER_LIMITS = {question: 1200, context: 2000, observed: 600, history: 2400, historyTurns: 6, turnChars: 900, output: 6000} as const;
export const ANSWER_TOKENS = {fast: 512, thinking: 900} as const;

const ESCAPES = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[P^_X][^\u001b]*(?:\u001b\\)?|[@-Z\\-_]|.)?|\u009b[0-?]*[ -/]*[@-~]/gu;

/**
 * Model or request text made presentation-safe: any reasoning block, escape or control sequence, C1 control,
 * invisible format character (bidi overrides, zero-width) or carriage return is removed; tabs become spaces and
 * line/paragraph separators become newlines. Only plain printable text and newlines remain.
 */
export function sanitizeModelText(raw: string): string {
  return stripThinkBlocks(raw)
    .replace(ESCAPES, '')
    .replace(/[\u2028\u2029]/gu, '\n')
    .replace(/\t/gu, '  ')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\p{Cf}]/gu, '')
    .replace(/[  ]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n');
}

/** A closed reasoning block, or one left open by the token budget, is never shown or kept. */
export function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gu, '').replace(/<think>[\s\S]*$/u, '').replace(/^\s*<\/think>/u, '');
}

/**
 * Strict: exactly {text, truncated}; the text is sanitized and bounded. An empty answer (nothing left once any
 * reasoning is removed) is unusable, so undefined.
 */
export function validateAnswer(raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ['text', 'truncated'], ['text', 'truncated'])) return undefined;
  if (typeof value.text !== 'string' || typeof value.truncated !== 'boolean') return undefined;
  let text = sanitizeModelText(value.text).trim();
  let truncated = value.truncated;
  if (!text) return undefined;
  if (text.length > ANSWER_LIMITS.output) { text = text.slice(0, ANSWER_LIMITS.output).trimEnd(); truncated = true; }
  return {text, truncated};
}

const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);
const plain = (text: string) => sanitizeModelText(text).trim();

/**
 * The request a service accepts, bounded again on the service side: oversized fields are clipped, history keeps
 * the newest whole turns that fit, and anything malformed rejects the request.
 */
export function boundAnswerRequest(raw: unknown): AnswerRequest | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  if (!exactKeys(value, ['question', 'history', 'context', 'shell', 'os'], ['question', 'history', 'shell', 'os'])) return undefined;
  if (typeof value.question !== 'string' || !Array.isArray(value.history)) return undefined;
  if (!['zsh', 'bash', 'fish'].includes(value.shell as string) || !['macOS', 'Linux'].includes(value.os as string)) return undefined;
  const question = clip(plain(value.question), ANSWER_LIMITS.question);
  if (!question) return undefined;
  const turns: AnswerTurn[] = [];
  for (const item of value.history) {
    if (!item || typeof item !== 'object') return undefined;
    const turn = item as Record<string, unknown>;
    if (!exactKeys(turn, ['role', 'text'], ['role', 'text']) || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.text !== 'string') return undefined;
    turns.push({role: turn.role, text: turn.text});
  }
  let context: AnswerContext | undefined;
  if (value.context !== undefined) {
    const item = value.context as Record<string, unknown>;
    if (!item || typeof item !== 'object' || !exactKeys(item, ['label', 'observed', 'excerpt'], ['label', 'excerpt'])
      || typeof item.label !== 'string' || typeof item.excerpt !== 'string' || (item.observed !== undefined && typeof item.observed !== 'string')) return undefined;
    context = {label: clip(plain(item.label), 160), excerpt: clip(plain(item.excerpt), ANSWER_LIMITS.context),
      ...(typeof item.observed === 'string' && plain(item.observed) ? {observed: clip(plain(item.observed), ANSWER_LIMITS.observed)} : {})};
  }
  return {question, history: trimHistory(turns, context ? ANSWER_LIMITS.history - Math.min(ANSWER_LIMITS.history / 2, context.excerpt.length / 2) : ANSWER_LIMITS.history),
    ...(context ? {context} : {}), shell: value.shell as AnswerRequest['shell'], os: value.os as AnswerRequest['os']};
}

/**
 * Predictable trimming: each turn is clipped to ANSWER_LIMITS.turnChars, then the oldest turns are dropped, whole
 * user/assistant exchanges first, until at most historyTurns turns and `budget` characters remain. The history
 * always starts with a user turn.
 */
export function trimHistory(turns: readonly AnswerTurn[], budget: number = ANSWER_LIMITS.history): AnswerTurn[] {
  let kept = turns.map(turn => ({role: turn.role, text: clip(plain(turn.text), ANSWER_LIMITS.turnChars)})).filter(turn => turn.text);
  const size = () => kept.reduce((sum, turn) => sum + turn.text.length, 0);
  while (kept.length && (kept.length > ANSWER_LIMITS.historyTurns || size() > budget || kept[0]!.role !== 'user')) {
    kept = kept.slice(kept[0]!.role === 'user' && kept[1]?.role === 'assistant' ? 2 : 1);
  }
  return kept;
}

export interface ChatMessage {role: 'system' | 'user' | 'assistant'; content: string}

/**
 * The conversation as chat messages. Tuned for a small model: a short system prompt with its limits stated
 * plainly (offline, no current events, sees only what is quoted, cannot act), brevity, Markdown code blocks for
 * code, and saying when it is unsure. A context excerpt is quoted in the newest user turn, with NMSh's own
 * observation kept separate so the answer can tell what was seen from what it thinks.
 */
export function answerMessages(request: AnswerRequest): ChatMessage[] {
  const system = [
    'You are Ask, a small offline assistant inside NMSh, a terminal app. You run on a small local language model.',
    `The user works in ${request.shell} on ${request.os}.`,
    'Answer the question directly and briefly: a few sentences, or a short list. Put commands and code in Markdown code blocks.',
    'You have no internet access and no news: you cannot know current events, today\'s date, prices, weather or anything recent. Say so when asked.',
    'You cannot see the user\'s files, screen, settings or environment, and you cannot run commands or change anything. You only see what is quoted in the conversation.',
    'If you are not sure, say so. Never invent facts, commands, options or file names.',
    // Both measured against the real 0.6B model (scripts/local-model): without them it claimed to have checked a
    // file it cannot see and answered rewrite requests as if they were addressed to it.
    'When asked to rewrite, correct, shorten or translate some text, reply with only the new text.',
    'If asked about the user\'s own files, settings, screen, clipboard or history, say you cannot see them.',
  ].join('\n');
  const messages: ChatMessage[] = [{role: 'system', content: system}];
  for (const turn of request.history) messages.push({role: turn.role, content: turn.text});
  const context = request.context;
  const question = context
    ? [`Terminal context (${context.label}):`, '```', context.excerpt, '```',
      ...(context.observed ? [`NMSh observed: ${context.observed}`] : []),
      '', request.question, '',
      'First say briefly what the output shows, then what you think it means and how sure you are. Do not claim more than the output shows.'].join('\n')
    : rewriteFraming(request.question);
  messages.push({role: 'user', content: question});
  return messages;
}

const REWRITE = /^((?:please |can you |could you )?(?:rewrite|rephrase|reword|paraphrase|improve|shorten|simplify|summari[sz]e|translate|make (?:this|it)|turn (?:this|it))\b[^:\n]{0,80}):\s+(\S[\s\S]*)$/iu;

/**
 * "Rewrite this more politely: send me the report now": the instruction and the text to work on, quoted apart, so a
 * small model rewrites the text instead of answering it as if it were addressed to itself (measured: 5 of 5 rewrites
 * instead of replies like "Sure! Let me know when you're ready"). Corrections ("correct the grammar: …") measured
 * slightly better as typed, so they are left alone.
 */
export function rewriteFraming(question: string): string {
  const match = REWRITE.exec(question.trim());
  return match ? `${match[1]!.trim()}.\nReply with only the new text.\n\nText: """${match[2]!.trim()}"""` : question;
}
