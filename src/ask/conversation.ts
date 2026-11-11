import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';
import {redact, sanitizeModelText, trimHistory, type AnswerContext, type AnswerTurn} from '../understanding/tasks.js';
import {suggestionRisk} from './commandSuggestions.js';
import {diagnose, failureExcerpt, WHY_FAILED} from './failure.js';
import type {ActionRisk} from './types.js';

/**
 * Ask as a general conversation with the person's local model. This module holds only deterministic pieces:
 * how a request is classified, which terminal context may be attached (only when asked for), the bounded
 * follow-up history, and how untrusted model text is rendered. Nothing here runs anything or calls a model.
 */

export interface ConversationSignals {
  /** Question-shaped, or a request for writing, rewriting or explaining: something an answer can satisfy. */
  question: boolean;
  /** A pure knowledge question ("what is the difference between merge and rebase"), not a request to act here. */
  conceptual: boolean;
  /** The person asks about terminal output: the last error, or an output to summarise. */
  context?: 'error' | 'output';
  /** Asks to see environment variables, keys, passwords or other credentials. */
  secretSeeking: boolean;
  /** The request itself appears to contain a secret (token, key, password). */
  sensitive: boolean;
}

const QUESTION_START = new RegExp(String.raw`^(?:(?:hey|hi|hello|ok|okay|so|and|but|also|then|please|ask|btw)[,.!]?\s+)*(?:`
  + String.raw`what|what's|whats|why|how|when|where|who|which|whose|is|are|am|isn't|aren't|can|could|should|would|will|do|does|did|was|were|has|have|`
  + String.raw`explain|describe|define|tell me|teach me|compare|contrast|summari[sz]e|translate|rewrite|rephrase|reword|paraphrase|proofread|correct|improve|`
  + String.raw`shorten|simplify|expand|write|draft|compose|give me|suggest|recommend|name|brainstorm|show me how|help me understand|i wonder|i want to know|`
  + String.raw`i (?:don't|do not) (?:understand|get)|difference between|pros and cons|thanks|thank you|hi|hello|hey|good (?:morning|afternoon|evening)|`
  + String.raw`make (?:this|it|that|the following) (?:shorter|longer|clearer|simpler|more \w+|less \w+|sound \w+|formal|informal|casual|polite|friendlier|concise)|`
  + String.raw`turn (?:this|it|the following) into (?:a |an )?(?:list|bullet points|haiku|poem|sentence|email|summary))\b`, 'iu');
const CONCEPT_START = /^(?:(?:hey|hi|ok|okay|so|and|also|please)[,.]?\s+)*(?:what (?:is|are|was|were|does|do)|what's|whats|why (?:is|are|does|do|would|did)|when (?:should|would|is|do)|explain|describe|define|compare|tell me about|difference between)\b/iu;
const HERE_AND_NOW = /\b(?:my|mine|here|this (?:folder|directory|repo|repository|machine|computer|file|branch)|for me|right now)\b/iu;
const SECRET_WORDS = /\b(?:env(?:ironment)?(?: variables?| vars?)?|\$?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|api ?keys?|access ?keys?|tokens?|passwords?|passwd|secrets?|credentials?|ssh keys?|private keys?|\.env|keychain|cookies?)\b/iu;
const SECRET_ASK = /\b(?:show|print|reveal|dump|display|cat|read|echo|leak|send|give me|tell me|list|what(?: is|'s| are)) (?:me )?(?:all )?(?:of )?(?:my|the|our|your|this machine's|their)\b/iu;
const CONTEXT_REQUEST = /\b(?:explain|summari[sz]e|interpret|describe|read|look at|analy[sz]e|help (?:me )?with|what (?:does|do|is)|what's|whats|why|fix)\b.*\b(?:last|previous|latest|that|this|the|my) (?:command(?:'s)? )?(?:error|failure|output|result|log|traceback|stack ?trace|exception|warning|crash)s?\b/iu;
const SUMMARISE_THIS = /^(?:please )?(?:summari[sz]e|explain) (?:it|that|this)(?: (?:output|for me))?$/iu;

export function conversationSignals(raw: string): ConversationSignals {
  const text = raw.trim();
  const question = QUESTION_START.test(text) || /\?\s*$/u.test(text);
  const context = CONTEXT_REQUEST.test(text) || WHY_FAILED.test(text.toLowerCase()) || /\bwhy did (?:it|that|this) fail\b/iu.test(text) || SUMMARISE_THIS.test(text)
    ? (/\b(?:error|fail(?:ed|ure|ing)?|wrong|traceback|stack ?trace|exception|crash|broken)\b/iu.test(text) ? 'error' as const : 'output' as const) : undefined;
  return {
    question,
    conceptual: question && (CONCEPT_START.test(text) || /\bdifference between\b/iu.test(text)) && !HERE_AND_NOW.test(text) && !/^(?:how (?:do|can|would|should) i|how to)\b/iu.test(text),
    ...(context ? {context} : {}),
    secretSeeking: SECRET_WORDS.test(text) && SECRET_ASK.test(text),
    sensitive: redact(text) !== text,
  };
}

const LANGUAGE = /\b(?:python|javascript|typescript|java|rust|golang|ruby|php|swift|kotlin|sql|excel|haskell|lua|perl|c\+\+|c#)\b/iu;
const DETERMINERS = /\b(?:a|an|the|today's|todays|my|your|our|their|this|that|these|those|some|any)\s+$/iu;

/**
 * A question Ask's own catalog answered by a command word it merely contains: "What does HTTP status 404 mean"
 * (http), "What are the top news headlines" (top), "What is today's date" (date), "What is a Python list" (python3).
 * The command answer stands when the word is used as a command: written in lowercase and not after an article or
 * possessive ("what does chmod 755 mean", "what does the ls command do"). A project answer that only says there is
 * no project ("what does set -e do in a bash script") does not outrank a question either.
 */
export function questionOutranks(own: {kind: string; capability?: string; text?: string}, raw: string, followUp = false): boolean {
  if (own.kind !== 'answer' || !own.text) return false;
  // A question Ask only placed after "correcting" its words ("symbolic" → "symbols") was not about NMSh's vocabulary.
  if (/^Interpreted as: /u.test(own.text)) return true;
  if (own.capability === 'project.run' && /^This folder has no package\.json/u.test(own.text)) return !/\b(?:project|package\.json|npm|pnpm|yarn|bun|scripts)\b/iu.test(raw);
  if (own.capability !== 'help.command') return false;
  // In a conversation, "how do I sort one?" continues it; only an explicit command question leaves it.
  if (followUp && !/`|\b(?:command|cli|man ?page|flags?|options?|subcommands?)\b/iu.test(raw)) return true;
  const name = /^([\w.+-]+)[ :]/u.exec(own.text)?.[1];
  if (!name) return false;
  const base = name.replace(/\d+$/u, '').replace(/[.+]/gu, '\\$&');
  // "how do I sort a list in Python": a question about another language, not about the sort command.
  const language = LANGUAGE.exec(raw)?.[0]?.toLowerCase();
  if (language && !new RegExp(`^${base}`, 'iu').test(language)) return true;
  const uses = [...raw.matchAll(new RegExp(String.raw`(?<![\w-])${base}\d*(?![\w-])`, 'giu'))];
  if (!uses.length) return false;
  return !uses.some(use => /^[a-z]/u.test(use[0]) && (!DETERMINERS.test(raw.slice(0, use.index)) || /^\s+(?:command|cli|tool|program|utility|binary)\b/iu.test(raw.slice(use.index! + use[0].length))));
}

/** Short and pointing at nothing in particular ("fix it", "make it faster"): a clarifying question, not a refusal. */
export const VAGUE_REQUEST = /^(?:please |can you |could you )?(?:fix|improve|change|update|clean|speed up|optimi[sz]e|make|do|redo|undo|check|handle|sort out)\b(?:\s+(?:it|this|that|them|things?|stuff|everything|up|faster|better|work|again))+[.!]?$/iu;

/** Fixed replies for requests that never reach the model. */
export const SECRET_REPLY = 'Ask never reads your environment, credentials, keys or files, and never sends them to a model. Use your own tools for that, in your own shell.';
export const SENSITIVE_REPLY = 'That looks like it contains a secret (a token, key or password), so it was not sent to the local model. Remove it and ask again.';

/** The newest few exchanges, trimmed predictably (see trimHistory); kept in this Ask only, never on disk. */
export function appendHistory(history: readonly AnswerTurn[], question: string, answer: string): AnswerTurn[] {
  return trimHistory([...history, {role: 'user', text: question}, {role: 'assistant', text: answer}]);
}

/** The last exchange answered again (a thinking pass replaces the quick answer it refines). */
export function replaceLastAnswer(history: readonly AnswerTurn[], answer: string): AnswerTurn[] {
  const last = history.at(-1);
  return last?.role === 'assistant' ? trimHistory([...history.slice(0, -1), {role: 'assistant', text: answer}]) : [...history];
}

export interface OutputRecord {command: string; exitCode: number; output: string}

const CONTEXT_LINES = 40;
const CONTEXT_WIDTH = 160;
const CONTEXT_CHARS = 2000;

/**
 * The minimum terminal context for "explain the last error" or "summarise this output": the redacted command and
 * the last lines of that one block's output, ANSI removed, each line redacted and clipped, the whole bounded.
 * For an error, NMSh's own deterministic diagnosis is attached separately as what was observed.
 */
export function outputContext(record: OutputRecord, kind: 'error' | 'output'): AnswerContext {
  const all = failureExcerpt(record.output).map(line => line.trimEnd());
  while (all.length && !all.at(-1)) all.pop();
  let lines = all.slice(-CONTEXT_LINES).map(line => (line.length > CONTEXT_WIDTH ? `${line.slice(0, CONTEXT_WIDTH - 1)}…` : line));
  const command = redact(sanitizeModelText(record.command)).replace(/\s+/gu, ' ').trim().slice(0, 160);
  while (lines.length > 1 && lines.join('\n').length + command.length > CONTEXT_CHARS) lines = lines.slice(1);
  const shown = lines.length;
  const label = `output of ${command.split(' ').slice(0, 3).join(' ')}${command.split(' ').length > 3 ? ' …' : ''} · exit ${record.exitCode} · ${shown === all.length ? `${shown} line${shown === 1 ? '' : 's'}` : `last ${shown} of ${all.length} lines`}, redacted`;
  const excerpt = [`$ ${command}`, ...lines, `[exit code ${record.exitCode}]`].join('\n');
  let observed: string | undefined;
  if (kind === 'error') {
    const diagnosis = diagnose({command: record.command, exitCode: record.exitCode, output: record.output});
    observed = [`exit code ${record.exitCode}`, diagnosis.likely ? `likely: ${diagnosis.likely}` : undefined,
      diagnosis.evidence[0] ? `the output says: ${diagnosis.evidence[0].slice(0, 200)}` : undefined].filter(Boolean).join('; ');
  }
  return {label, excerpt, ...(observed ? {observed} : {})};
}

/** Fenced code blocks in an answer, with their language tag. */
export function codeBlocks(text: string): Array<{language: string; code: string}> {
  const blocks: Array<{language: string; code: string}> = [];
  let open: {language: string; lines: string[]} | undefined;
  for (const line of text.split('\n')) {
    const fence = /^\s*```\s*([\w+-]*)/u.exec(line);
    if (fence && !open) { open = {language: (fence[1] ?? '').toLowerCase(), lines: []}; continue; }
    if (fence && open && /^\s*```\s*$/u.test(line)) { blocks.push({language: open.language, code: open.lines.join('\n')}); open = undefined; continue; }
    if (open) open.lines.push(line);
  }
  if (open) blocks.push({language: open.language, code: open.lines.join('\n')});
  return blocks;
}

const SHELL_LANGUAGES = new Set(['sh', 'bash', 'zsh', 'shell', 'console', 'fish', 'shellsession', 'terminal']);
const RISK_WORDS: Record<ActionRisk, string> = {informational: 'shows information', read: 'reads only', navigate: 'changes directory',
  configure: 'changes settings', mutate: 'changes things', destructive: 'destructive', install: 'installs software'};

/**
 * NMSh's own check of each shell code block in an answer, index-aligned with codeBlocks (undefined for code that
 * isn't a shell command). The model's text never sets the verdict; Ask never runs any of it.
 */
export function shellChecks(text: string): Array<string | undefined> {
  return codeBlocks(text).map(block => {
    const lines = block.code.split('\n').map(line => line.replace(/^\s*[$%#>]\s+/u, '').trim()).filter(line => line && !line.startsWith('#'));
    const looksLikeCommand = SHELL_LANGUAGES.has(block.language) || (!block.language && lines.length > 0 && lines.length <= 3 && /^(?:sudo\s+)?[a-z][\w.+-]*(?:\s|$)/u.test(lines[0]!));
    if (!looksLikeCommand || !lines.length) return undefined;
    const risk = lines.map(line => suggestionRisk(line)).sort((a, b) => RISK_ORDER.indexOf(b) - RISK_ORDER.indexOf(a))[0]!;
    return `NMSh's check: ${RISK_WORDS[risk]}. Ask never runs it; copy it to run it yourself after checking.`;
  });
}
const RISK_ORDER: ActionRisk[] = ['informational', 'navigate', 'read', 'configure', 'mutate', 'install', 'destructive'];

/** The answer as plain text for Copy: exactly the sanitized answer, no NMSh styling. */
export const answerCopyText = (text: string) => sanitizeModelText(text).trim();
/** Every code block's content, for Copy code. */
export const answerCodeText = (text: string) => codeBlocks(sanitizeModelText(text)).map(block => block.code).join('\n').trim();

/** Word wrap by display width; a word longer than the width is split so nothing overflows a narrow terminal. */
export function wrapPlain(text: string, width: number): string[] {
  const limit = Math.max(8, width);
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/(\s+)/u)) {
    if (!word) continue;
    if (displayWidth(line + word) <= limit) { line += word; continue; }
    if (!word.trim()) { lines.push(line.trimEnd()); line = ''; continue; }
    if (line.trim()) lines.push(line.trimEnd());
    line = '';
    let rest = word;
    while (displayWidth(rest) > limit) {
      let cut = '';
      for (const char of rest) { if (displayWidth(cut + char) > limit) break; cut += char; }
      lines.push(cut);
      rest = rest.slice(cut.length);
    }
    line = rest;
  }
  lines.push(line.trimEnd());
  return lines;
}

/**
 * Model text as rows for the Ask panel: sanitized again (it is untrusted), with only NMSh's own colors. Fenced code
 * is indented and hard-wrapped (never reflowed), lists get a hanging indent, headings and emphasis markers are
 * simplified. NMSh's check follows each shell block. Every row fits `width`.
 */
export function modelTextRows(raw: string, width: number, checks: ReadonlyArray<string | undefined> = []): string[] {
  const primary = foreground(UI_COLORS.primary);
  const secondary = foreground(UI_COLORS.secondary);
  const subtle = foreground(UI_COLORS.subtle);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001b[0m';
  const text = sanitizeModelText(raw);
  const rows: string[] = [];
  let code: string[] | undefined;
  let block = 0;
  const closeCode = () => {
    if (!code) return;
    for (const line of code) for (const part of hardWrap(line, width - 4)) rows.push(`    ${primary}${part}${reset}`);
    const check = checks[block];
    if (check) for (const part of wrapPlain(check, width - 4)) rows.push(`    ${subtle}${part}${reset}`);
    rows.push('');
    block += 1;
    code = undefined;
  };
  for (const line of text.split('\n')) {
    if (/^\s*```/u.test(line)) {
      if (code) { closeCode(); continue; }
      if (rows.length && rows.at(-1) !== '') rows.push('');
      code = [];
      continue;
    }
    if (code) { code.push(line); continue; }
    const inline = line.replace(/\*\*(.+?)\*\*|__(.+?)__/gu, (_match, a: string | undefined, b: string | undefined) => a ?? b ?? '');
    const heading = /^\s*#{1,6}\s+(.*)$/u.exec(inline);
    if (heading) { for (const part of wrapPlain(heading[1]!, width)) rows.push(`${primary}${part}${reset}`); continue; }
    const item = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/u.exec(inline);
    if (item) {
      const depth = Math.min(3, Math.floor(item[1]!.length / 2));
      const marker = /^\d/u.test(item[2]!) ? item[2]! : '•';
      const lead = `${'  '.repeat(depth)}${marker} `;
      const parts = wrapPlain(item[3]!, width - displayWidth(lead));
      parts.forEach((part, index) => rows.push(`${index === 0 ? `${accent}${lead}${reset}` : ' '.repeat(displayWidth(lead))}${secondary}${part}${reset}`));
      continue;
    }
    if (!inline.trim()) { if (rows.length && rows.at(-1) !== '') rows.push(''); continue; }
    for (const part of wrapPlain(inline.trim(), width)) rows.push(`${secondary}${part}${reset}`);
  }
  closeCode();
  while (rows.at(-1) === '') rows.pop();
  return rows;
}

function hardWrap(line: string, width: number): string[] {
  const limit = Math.max(8, width);
  if (displayWidth(line) <= limit) return [line];
  const parts: string[] = [];
  let current = '';
  for (const char of line) {
    if (displayWidth(current + char) > limit) { parts.push(current); current = '  '; }
    current += char;
  }
  if (current.trim()) parts.push(current);
  return parts;
}
