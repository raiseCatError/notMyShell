/**
 * Semantic Output (#386, first phase): a deterministic reading of a completed command's stored output, never a
 * replacement for it. Each recognizer is a pure function of (command, output, exit code) that accepts only its own
 * unmistakable evidence (a runner's own summary line, a compiler's own diagnostic format) and fails closed otherwise.
 * Counts are the ones the tool printed, items are lines taken verbatim from the output, and nothing is inferred
 * about state the output does not show. The raw output stays authoritative: this is presentation and an optional copy.
 */

export interface SemanticItem {
  /** The line as the tool printed it (trimmed), possibly joined with its location line. */
  text: string;
  tone: 'failure' | 'warning';
}

export interface SemanticResult {
  kind: 'tests' | 'diagnostics';
  /** Who produced the facts ("node --test", "pytest", "TypeScript"). */
  source: string;
  outcome: 'passed' | 'failed';
  /** One line of facts, as printed ("1,797 passed · 2 failed · 25 skipped"). */
  overview: string;
  /** Failing tests or diagnostics, at most MAX_ITEMS. */
  items: SemanticItem[];
  /** Items found beyond MAX_ITEMS. */
  omitted: number;
  /** False when only part of a very large output was read. */
  complete: boolean;
}

export const MAX_ITEMS = 20;
/** Output read for recognition: the end of the output, where runners and compilers summarize. */
export const MAX_SEMANTIC_BYTES = 2 * 1024 * 1024;

/** The last line that matches (runners print their summary at the end). */
function findLast(lines: readonly string[], test: (line: string) => boolean): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) if (test(lines[index]!)) return lines[index];
  return undefined;
}

const number = (value: string | undefined) => value === undefined ? undefined : Number(value.replace(/,/gu, ''));
const count = (value: number) => value.toLocaleString('en-US');
const plural = (value: number, word: string) => `${count(value)} ${word}${value === 1 ? '' : 's'}`;

function facts(parts: ReadonlyArray<readonly [label: string, value: number | undefined]>): string {
  return parts.filter(([, value]) => value !== undefined).map(([label, value]) => `${count(value!)} ${label}`).join(' · ');
}

function collect(lines: readonly string[], pattern: RegExp, render: (match: RegExpExecArray) => string, tone: SemanticItem['tone'] = 'failure'): {items: SemanticItem[]; omitted: number} {
  const seen = new Set<string>();
  const items: SemanticItem[] = [];
  let omitted = 0;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) continue;
    const text = render(match).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (items.length < MAX_ITEMS) items.push({text, tone}); else omitted += 1;
  }
  return {items, omitted};
}

type Recognizer = (command: string, lines: readonly string[], exitCode: number) => Omit<SemanticResult, 'complete'> | undefined;

/** Node's test runner: the spec reporter's `ℹ` summary, or TAP's `#` summary. */
const nodeTest: Recognizer = (_command, lines) => {
  for (const marker of ['ℹ', '#'] as const) {
    const value = (name: string) => number(findLast(lines, line => line.startsWith(`${marker} ${name} `))?.slice(marker.length + name.length + 2).trim().match(/^\d+$/u)?.[0]);
    const tests = value('tests');
    const pass = value('pass');
    const fail = value('fail');
    if (tests === undefined || pass === undefined || fail === undefined) continue;
    const skipped = value('skipped');
    const todo = value('todo');
    const cancelled = value('cancelled');
    const section = lines.findIndex(line => line === '✖ failing tests:');
    const failing = marker === 'ℹ'
      ? collect(section >= 0 ? lines.slice(section + 1) : lines, /^✖ (.+?)(?: \([\d.]+m?s\))?$/u, match => match[1]!)
      : collect(lines, /^not ok \d+ - (?!.*\s#\s*(?:TODO|SKIP)\b)(.+?)(?:\s+#.*)?$/iu, match => match[1]!);
    failing.items = failing.items.filter(item => item.text !== 'failing tests:');
    return {kind: 'tests', source: 'node --test', outcome: fail > 0 || (cancelled ?? 0) > 0 ? 'failed' : 'passed',
      overview: facts([['passed', pass], ['failed', fail], ['skipped', skipped || undefined], ['todo', todo || undefined], ['cancelled', cancelled || undefined]]), ...failing};
  }
  return undefined;
};

/** Jest's `Tests:` line (and its `●` failure headings). */
const jest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => /^Tests:\s+.*\d+ total$/u.test(line));
  if (!summary) return undefined;
  const part = (name: string) => number(new RegExp(`(\\d[\\d,]*) ${name}`, 'u').exec(summary)?.[1]);
  const failed = part('failed');
  const failing = collect(lines, /^\s*● (?!Console\b)(.+)$/u, match => match[1]!);
  return {kind: 'tests', source: 'Jest', outcome: (failed ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', part('passed') ?? 0], ['failed', failed ?? 0], ['skipped', part('skipped')], ['todo', part('todo')]]), ...failing};
};

/** Vitest's `Tests` summary line (`2 failed | 40 passed (42)`) and its FAIL lines. */
const vitest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => /^\s+Tests\s+(?:\d+ \w+(?: \| )?)+\s*\(\d+\)$/u.test(line));
  if (!summary || !lines.some(line => /^\s*Test Files\s+/u.test(line))) return undefined;
  const part = (name: string) => number(new RegExp(`(\\d[\\d,]*) ${name}`, 'u').exec(summary)?.[1]);
  const failed = part('failed');
  const failing = collect(lines, /^\s*FAIL\s+(.+?)\s*$/u, match => match[1]!);
  return {kind: 'tests', source: 'Vitest', outcome: (failed ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', part('passed') ?? 0], ['failed', failed ?? 0], ['skipped', part('skipped')], ['todo', part('todo')]]), ...failing};
};

/** pytest's closing `=== 1 failed, 3 passed in 0.12s ===` line and its short summary. */
const pytest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => /^=+ (?:\d+ \w+(?:, )?)+ in [\d.]+s(?: \([\d:]+\))? =+$/u.test(line));
  if (!summary) return undefined;
  const part = (name: string) => number(new RegExp(`(\\d+) ${name}`, 'u').exec(summary)?.[1]);
  const failed = part('failed');
  const errors = part('errors?');
  const failing = collect(lines, /^(?:FAILED|ERROR) (\S+)(?: - (.*))?$/u, match => match[2] ? `${match[1]} - ${match[2]}` : match[1]!);
  return {kind: 'tests', source: 'pytest', outcome: (failed ?? 0) + (errors ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', part('passed') ?? 0], ['failed', failed ?? 0], ['errors', errors], ['skipped', part('skipped')], ['xfailed', part('xfailed')]]), ...failing};
};

/** cargo test's `test result:` lines (one per test binary; summed). */
const cargoTest: Recognizer = (_command, lines) => {
  const results = lines.map(line => /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/u.exec(line)).filter(match => match !== null);
  if (!results.length) return undefined;
  const sum = (index: number) => results.reduce((total, match) => total + Number(match[index]), 0);
  const failing = collect(lines, /^test (\S+) \.\.\. FAILED$/u, match => match[1]!);
  return {kind: 'tests', source: 'cargo test', outcome: sum(2) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', sum(1)], ['failed', sum(2)], ['ignored', sum(3) || undefined]]), ...failing};
};

/** go test's per-package `ok` / `FAIL` lines and `--- FAIL:` tests. */
const goTest: Recognizer = (command, lines) => {
  if (!/^\s*(?:\S+\/)?go\s+test\b/u.test(command)) return undefined;
  const ok = lines.filter(line => /^ok\s+\S+\s+(?:[\d.]+s|\(cached\))/u.test(line)).length;
  const failedPackages = lines.filter(line => /^FAIL\s+\S+\s+(?:[\d.]+s|\[build failed\]|\[setup failed\])/u.test(line)).length;
  if (!ok && !failedPackages) return undefined;
  const failing = collect(lines, /^\s*--- FAIL: (\S+)/u, match => match[1]!);
  return {kind: 'tests', source: 'go test', outcome: failedPackages > 0 ? 'failed' : 'passed',
    overview: `${plural(ok, 'package')} ok · ${plural(failedPackages, 'package')} failed${failing.items.length ? ` · ${plural(failing.items.length + failing.omitted, 'failing test')}` : ''}`, ...failing};
};

/** Commands that compile or check code: their diagnostics are the point even when they exit 0. */
const BUILD = /^\s*(?:\S+\/)?(?:tsc|npx\s+tsc|vue-tsc|gcc|g\+\+|cc|c\+\+|clang|clang\+\+|make|ninja|cmake|cargo\s+(?:build|check|clippy|run|test)|rustc|swift\s+build|xcodebuild|go\s+(?:build|vet)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|check|lint|compile|tsc))\b/u;

/** TypeScript: `file(1,2): error TS…` or pretty `file:1:2 - error TS…`, and tsc's `Found N errors` line. */
const typescript: Recognizer = (command, lines, exitCode) => {
  const pattern = /^(\S.*?)(?:\((\d+),(\d+)\): | ?:(\d+):(\d+) - )(error|warning) (TS\d+): (.*)$/u;
  const found = findLast(lines, line => /^Found \d+ errors?(?: in .+)?\.?$/u.test(line));
  if (!found && !lines.some(line => pattern.test(line))) return undefined;
  if (!found && exitCode === 0 && !BUILD.test(command)) return undefined;
  const items = collect(lines, pattern, match => `${match[1]}:${match[2] ?? match[4]}:${match[3] ?? match[5]} ${match[7]}: ${match[8]}`);
  const errors = number(found ? /^Found (\d+) errors?/u.exec(found)?.[1] : undefined) ?? items.items.length + items.omitted;
  const files = found ? /in (\d+) files/u.exec(found)?.[1] : undefined;
  return {kind: 'diagnostics', source: 'TypeScript', outcome: errors > 0 ? 'failed' : 'passed',
    overview: `${plural(errors, 'error')}${files ? ` in ${files} files` : ''}`, ...items};
};

/** Rust: `error[E0308]: …` / `warning: …` headings with their ` --> file:line:col` location. */
const rust: Recognizer = (command, lines, exitCode) => {
  if (!lines.some(line => /^\s*--> \S+:\d+:\d+$/u.test(line))) return undefined;
  if (exitCode === 0 && !BUILD.test(command)) return undefined;
  const items: SemanticItem[] = [];
  let omitted = 0;
  let errors = 0;
  let warnings = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(error|warning)(\[E\d{4}\])?: (.+)$/u.exec(lines[index]!);
    if (!heading || /^(?:could not compile|aborting due to|`.+` \(.+\) generated \d+ warnings?)/u.test(heading[3]!)) continue;
    const location = /^\s*--> (\S+:\d+:\d+)$/u.exec(lines[index + 1] ?? '')?.[1];
    if (!location) continue;
    if (heading[1] === 'error') errors += 1; else warnings += 1;
    const text = `${location} ${heading[1]}${heading[2] ?? ''}: ${heading[3]}`;
    if (items.length < MAX_ITEMS) items.push({text, tone: heading[1] === 'error' ? 'failure' : 'warning'}); else omitted += 1;
  }
  if (!errors && !warnings) return undefined;
  return {kind: 'diagnostics', source: 'Rust', outcome: errors > 0 ? 'failed' : 'passed',
    overview: [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' · '), items, omitted};
};

/** GCC and Clang: `file:line:col: error: …` lines. */
const cCompilers: Recognizer = (command, lines, exitCode) => {
  const pattern = /^(\S+?:\d+:\d+): (fatal error|error|warning): (.+)$/u;
  if (!lines.some(line => pattern.test(line))) return undefined;
  if (exitCode === 0 && !BUILD.test(command)) return undefined;
  let errors = 0;
  let warnings = 0;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) { if (match[2] === 'warning') warnings += 1; else errors += 1; }
  }
  const failures = collect(lines, pattern, match => `${match[1]} ${match[2]}: ${match[3]}`);
  for (const item of failures.items) if (/ warning: /u.test(item.text)) item.tone = 'warning';
  return {kind: 'diagnostics', source: 'GCC/Clang', outcome: errors > 0 ? 'failed' : 'passed',
    overview: [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' · '), ...failures};
};

/** Most specific first: a runner's summary wins over diagnostics that happen to appear in its output. */
const RECOGNIZERS: readonly Recognizer[] = [nodeTest, jest, vitest, pytest, cargoTest, goTest, typescript, rust, cCompilers];

/** The semantic reading of a completed output, or undefined when no recognizer is sure. */
export function recognizeOutput(command: string, output: string, exitCode: number): SemanticResult | undefined {
  if (!output) return undefined;
  const complete = output.length <= MAX_SEMANTIC_BYTES;
  const text = complete ? output : output.slice(-MAX_SEMANTIC_BYTES);
  const lines = text.split('\n').map(line => line.replace(/\r$/u, '').replace(/\s+$/u, ''));
  for (const recognizer of RECOGNIZERS) {
    const result = recognizer(command, lines, exitCode);
    if (result) return {...result, complete};
  }
  return undefined;
}

/** Plain text of a reading, for `/copy --semantic` and `--both`: everything, whatever is folded on screen. */
export function semanticText(result: SemanticResult): string {
  const lines = [`${result.source}: ${result.overview}`, ...result.items.map(item => item.text)];
  if (result.omitted) lines.push(`… ${count(result.omitted)} more in the raw output`);
  if (!result.complete) lines.push('(read from the last 2 MiB of a longer output)');
  return lines.join('\n');
}
