import {stripAnsi} from '../util/text.js';

/**
 * Completion-time folding: whether a finished command block starts
 * collapsed. Deterministic heuristics over the output itself; nothing is
 * executed, fetched, or inferred. It errs toward keeping output visible:
 * boring output left expanded is fine, hidden output the user needed is not.
 * Live-stream presentation (INLINE/LIVE/PASSTHROUGH) is the classifier's
 * concern and never decided here.
 */

/** Facts the live classifier observed while the command streamed. */
export interface StreamFacts {
  progressRewrites: boolean;
  sustainedStreaming: boolean;
}

export interface FoldInput {
  command: string;
  /** Plain or ANSI output; only its text is inspected. */
  output: string;
  exitCode: number;
  lineCount: number;
  facts?: StreamFacts;
}

export interface FoldDecision {
  fold: boolean;
  /** Internal: positive toward folding. Never shown in the normal UI. */
  score: number;
  reasons: string[];
}

export type OutputFoldingMode = 'smart' | 'never';
export const OUTPUT_FOLDING_MODES: readonly OutputFoldingMode[] = ['smart', 'never'];

/** Output at or below this many lines never auto-folds. */
export const MIN_AUTO_FOLD_LINES = 30;
/** Score needed to fold; below it the block stays expanded. */
export const FOLD_THRESHOLD = 3;

/** Lines kept visible above and below a collapsed middle. */
export const FOLD_HEAD_LINES = 3;
export const FOLD_TAIL_LINES = 5;

const ERRORS = /\b[A-Z]\w*(?:Error|Exception):|\b(?:error|errors|exception|traceback|panic(?:ked)?|fatal|failed|failure|failing|segmentation fault|assert(?:ion)?error|not ok)\b|[✖✗✘]|\bE\d{3,4}\b|^\s*FAIL\b/iu;
const WARNINGS = /\bwarn(?:ing)?s?\b/iu;
const STACK_FRAME = /^\s+at\s+\S.*[(:]\d+(?::\d+)?\)?\s*$|^\s*File ".*", line \d+|^\s*#\d+\s+0x[\da-f]+|^goroutine \d+ \[/iu;
const COMPILER = /^\S+:\d+:\d+:?\s|^\S+\(\d+,\d+\):\s/u;
const DIFF_HEADER = /^(?:diff --git |@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@|--- a\/|\+\+\+ b\/|index [\da-f]+\.\.[\da-f]+)/u;
const DIFF_LINE = /^[+-](?![+-]{2})/u;
const CHATTER = /^(?:npm|yarn|pnpm|bun) (?:warn|notice|http|info|verb)\b|\b(?:downloading|downloaded|resolving|resolved|fetching|fetched|installing|installed|extracting|compiling|compiled|building|linking|unpacking|pulling|progress|reused|preparing)\b|\d{1,3}(?:\.\d+)?%|^\s*(?:[✓✔]|ok \d+|PASS\b)|\bpassing\b/iu;

/** Commands whose output is usually the thing requested: a small visibility bias. */
const VISIBLE_COMMANDS = new Set(['cat', 'bat', 'less', 'more', 'head', 'tail', 'rg', 'grep', 'egrep', 'ag', 'find', 'fd', 'ls', 'tree',
  'diff', 'jq', 'yq', 'man', 'env', 'printenv', 'history', 'ps', 'lsof', 'du', 'df']);
const VISIBLE_GIT = new Set(['diff', 'log', 'status', 'show', 'blame', 'grep', 'branch', 'reflog', 'shortlog', 'stash']);
/** Known noisy command classes: a small folding bias. */
const NOISY_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  npm: new Set(['install', 'i', 'ci', 'update', 'test', 't', 'run']), pnpm: new Set(['install', 'i', 'add', 'update', 'test', 'run']),
  yarn: new Set(['install', 'add', 'upgrade', 'test', 'run']), bun: new Set(['install', 'add', 'test', 'run']),
  brew: new Set(['install', 'upgrade', 'update', 'reinstall']), pip: new Set(['install']), pip3: new Set(['install']),
  cargo: new Set(['build', 'test', 'install', 'fetch']), go: new Set(['build', 'test', 'get', 'install', 'mod']),
  docker: new Set(['build', 'pull', 'push']), gradle: new Set(['build']), mvn: new Set(['install', 'package', 'compile']),
};
const NOISY_COMMANDS = new Set(['make', 'ninja', 'cmake', 'uv', 'poetry', 'bundle', 'pod', 'swift', 'xcodebuild']);

function commandHint(command: string): {bias: number; reason?: string} {
  const words = command.trim().replace(/^(?:sudo|env|time|command|noglob)\s+/u, '').split(/\s+/u);
  const [first = '', second = ''] = words.map(word => word.replace(/^.*\//u, ''));
  if (first === 'git' && VISIBLE_GIT.has(second)) return {bias: -3, reason: `git ${second} output is the result`};
  if (VISIBLE_COMMANDS.has(first)) return {bias: -3, reason: `${first} output is the result`};
  if (NOISY_SUBCOMMANDS[first]?.has(second) || NOISY_COMMANDS.has(first)) return {bias: 1, reason: 'install/build command'};
  return {bias: 0};
}

/** Same line modulo numbers, hashes, durations and spacing. */
function normalize(line: string): string {
  return line.toLowerCase().replace(/[\da-f]{7,}/gu, 'h').replace(/\d+(?:\.\d+)?/gu, '#').replace(/\s+/gu, ' ').trim();
}

export function evaluateFold(input: FoldInput): FoldDecision {
  if (input.exitCode !== 0) return {fold: false, score: -Infinity, reasons: ['failed commands stay expanded']};
  if (input.lineCount <= MIN_AUTO_FOLD_LINES) return {fold: false, score: -Infinity, reasons: [`${input.lineCount} lines is short`]};

  const lines = stripAnsi(input.output).split('\n').map(line => line.replace(/\r/gu, '')).filter(line => line.trim());
  const total = Math.max(1, lines.length);
  let score = 0;
  const reasons: string[] = [];
  const add = (value: number, reason: string) => { score += value; reasons.push(`${value > 0 ? '+' : ''}${value} ${reason}`); };

  const errors = lines.filter(line => ERRORS.test(line)).length;
  const frames = lines.filter(line => STACK_FRAME.test(line)).length;
  const compiler = lines.filter(line => COMPILER.test(line)).length;
  const warnings = lines.filter(line => WARNINGS.test(line)).length;
  const diffHeaders = lines.filter(line => DIFF_HEADER.test(line)).length;
  const diffLines = lines.filter(line => DIFF_LINE.test(line)).length;
  // Near-veto: anything that looks like a failure outweighs every folding signal.
  if (errors > 0) add(-6, `${errors} error-like lines`);
  if (frames >= 2) add(-4, 'stack trace');
  if (compiler > 0) add(-3, 'compiler diagnostics');
  if (diffHeaders > 0 || diffLines / total > 0.3) add(-4, 'diff-like output');
  if (warnings > 0 && warnings <= 5) add(-1, 'a few warnings');

  const unique = new Set(lines.map(normalize)).size;
  const repetition = 1 - unique / total;
  if (repetition >= 0.6) add(3, `repetitive (${Math.round(repetition * 100)}%)`);
  else if (repetition >= 0.35) add(1.5, `partly repetitive (${Math.round(repetition * 100)}%)`);
  else if (repetition < 0.15) add(-1, 'varied output');

  const chatter = lines.filter(line => CHATTER.test(line)).length / total;
  if (chatter >= 0.4) add(2, 'progress/install/test chatter');
  else if (chatter >= 0.2) add(1, 'some chatter');

  if (input.facts?.progressRewrites) add(2, 'progress rewrites');
  if (input.facts?.sustainedStreaming) add(1, 'sustained streaming');
  if (input.lineCount > 1000) add(2, 'very large');
  else if (input.lineCount > 200) add(1, 'large');

  const hint = commandHint(input.command);
  if (hint.bias) add(hint.bias, hint.reason!);

  return {fold: score >= FOLD_THRESHOLD, score, reasons};
}

/**
 * Lines kept visible around a collapsed middle. Short blocks collapse to the
 * disclosure row alone, so a "hidden" count is never one or two lines.
 */
export function foldWindow(lineCount: number): {head: number; tail: number} {
  return lineCount >= FOLD_HEAD_LINES + FOLD_TAIL_LINES + 5 ? {head: FOLD_HEAD_LINES, tail: FOLD_TAIL_LINES} : {head: 0, tail: 0};
}
