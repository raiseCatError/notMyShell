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
