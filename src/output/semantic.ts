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

/**
 * Lines longer than this are not read: runner summaries and diagnostics are short, and every pattern below then runs
 * in time linear in what it reads, whatever a hostile output contains.
 */
export const MAX_LINE = 2048;

/** Items from lines `parse` accepts (it returns the item text), deduplicated and bounded. */
function collect(lines: readonly string[], parse: (line: string) => string | undefined, tone: SemanticItem['tone'] = 'failure'): {items: SemanticItem[]; omitted: number} {
  const seen = new Set<string>();
  const items: SemanticItem[] = [];
  let omitted = 0;
  for (const line of lines) {
    const text = parse(line)?.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (items.length < MAX_ITEMS) items.push({text, tone}); else omitted += 1;
  }
  return {items, omitted};
}

/** `N word` counts in one summary line (only ever applied to the one line a recognizer picked). */
const countIn = (line: string, word: string) => number(new RegExp(`(?:^|[^\\d,])(\\d{1,3}(?:,\\d{3})*|\\d{1,12}) ${word}\\b`, 'u').exec(line)?.[1]);

/** `path:line:col` with a path that has no spaces; end-anchored with bounded digits, so linear. */
const LOCATION_TAIL = /:\d{1,7}:\d{1,7}$/u;
const isLocation = (text: string) => text.length > 0 && !/\s/u.test(text) && LOCATION_TAIL.test(text);

type Recognizer = (command: string, lines: readonly string[], exitCode: number) => Omit<SemanticResult, 'complete'> | undefined;

/** Node's test runner: the spec reporter's `ℹ` summary, or TAP's `#` summary. */
const nodeTest: Recognizer = (_command, lines) => {
  for (const marker of ['ℹ', '#'] as const) {
    const value = (name: string) => {
      const prefix = `${marker} ${name} `;
      const rest = findLast(lines, line => line.startsWith(prefix))?.slice(prefix.length).trim();
      return rest !== undefined && /^\d{1,12}$/u.test(rest) ? Number(rest) : undefined;
    };
    const tests = value('tests');
    const pass = value('pass');
    const fail = value('fail');
    if (tests === undefined || pass === undefined || fail === undefined) continue;
    const skipped = value('skipped');
    const todo = value('todo');
    const cancelled = value('cancelled');
    const section = lines.indexOf('✖ failing tests:');
    const failing = marker === 'ℹ'
      ? collect(section >= 0 ? lines.slice(section + 1) : lines, line => line.startsWith('✖ ') && line !== '✖ failing tests:' ? line.slice(2).replace(/ \([\d.]{1,20}m?s\)$/u, '') : undefined)
      : collect(lines, line => {
        const head = /^not ok \d{1,9} - /u.exec(line);
        if (!head) return undefined;
        const text = line.slice(head[0].length);
        const hash = text.indexOf(' #');
        // A TODO or SKIP directive is not a failure.
        if (hash >= 0 && /^\s*(?:todo|skip)\b/iu.test(text.slice(hash + 2))) return undefined;
        return hash >= 0 ? text.slice(0, hash) : text;
      });
    return {kind: 'tests', source: 'node --test', outcome: fail > 0 || (cancelled ?? 0) > 0 ? 'failed' : 'passed',
      overview: facts([['passed', pass], ['failed', fail], ['skipped', skipped || undefined], ['todo', todo || undefined], ['cancelled', cancelled || undefined]]), ...failing};
  }
  return undefined;
};

/** Jest's `Tests: … N total` line (and its `●` failure headings). */
const jest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => line.startsWith('Tests:') && line.endsWith(' total') && /\d$/u.test(line.slice(0, -6)));
  if (!summary) return undefined;
  const failed = countIn(summary, 'failed');
  const failing = collect(lines, line => {
    const text = line.trimStart();
    return text.startsWith('● ') && !text.startsWith('● Console') ? text.slice(2) : undefined;
  });
  return {kind: 'tests', source: 'Jest', outcome: (failed ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', countIn(summary, 'passed') ?? 0], ['failed', failed ?? 0], ['skipped', countIn(summary, 'skipped')], ['todo', countIn(summary, 'todo')]]), ...failing};
};

/** Vitest's `Tests  2 failed | 40 passed (42)` line and its FAIL lines. */
const vitest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => line.startsWith(' ') && line.trimStart().startsWith('Tests ') && /\(\d{1,9}\)$/u.test(line));
  if (!summary || !lines.some(line => line.trimStart().startsWith('Test Files '))) return undefined;
  const failed = countIn(summary, 'failed');
  const failing = collect(lines, line => {
    const text = line.trimStart();
    return text.startsWith('FAIL ') ? text.slice(5).trimStart() : undefined;
  });
  return {kind: 'tests', source: 'Vitest', outcome: (failed ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', countIn(summary, 'passed') ?? 0], ['failed', failed ?? 0], ['skipped', countIn(summary, 'skipped')], ['todo', countIn(summary, 'todo')]]), ...failing};
};

/** pytest's closing `=== 1 failed, 3 passed in 0.12s ===` line and its short summary. */
const pytest: Recognizer = (_command, lines) => {
  const summary = findLast(lines, line => {
    if (!line.startsWith('=') || !line.endsWith('=')) return false;
    const inner = line.replace(/^=+ /u, '').replace(/ =+$/u, '');
    const at = inner.lastIndexOf(' in ');
    if (at < 0 || !/^[\d.]{1,12}s(?: \([\d:]{1,12}\))?$/u.test(inner.slice(at + 4))) return false;
    return inner.slice(0, at).split(', ').every(part => /^\d{1,9} \w{1,20}$/u.test(part));
  });
  if (!summary) return undefined;
  const failed = countIn(summary, 'failed');
  const errors = countIn(summary, 'errors?');
  const failing = collect(lines, line => {
    const head = line.startsWith('FAILED ') ? 7 : line.startsWith('ERROR ') ? 6 : 0;
    return head ? line.slice(head) : undefined;
  });
  return {kind: 'tests', source: 'pytest', outcome: (failed ?? 0) + (errors ?? 0) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', countIn(summary, 'passed') ?? 0], ['failed', failed ?? 0], ['errors', errors], ['skipped', countIn(summary, 'skipped')], ['xfailed', countIn(summary, 'xfailed')]]), ...failing};
};

/** cargo test's `test result:` lines (one per test binary; summed). */
const cargoTest: Recognizer = (_command, lines) => {
  const results = lines.map(line => /^test result: (?:ok|FAILED)\. (\d{1,9}) passed; (\d{1,9}) failed; (\d{1,9}) ignored;/u.exec(line)).filter(match => match !== null);
  if (!results.length) return undefined;
  const sum = (index: number) => results.reduce((total, match) => total + Number(match[index]), 0);
  const failing = collect(lines, line => line.startsWith('test ') && line.endsWith(' ... FAILED') ? line.slice(5, -11) : undefined);
  return {kind: 'tests', source: 'cargo test', outcome: sum(2) > 0 ? 'failed' : 'passed',
    overview: facts([['passed', sum(1)], ['failed', sum(2)], ['ignored', sum(3) || undefined]]), ...failing};
};

/** go test's per-package `ok` / `FAIL` lines and `--- FAIL:` tests. */
const goTest: Recognizer = (command, lines) => {
  if (!/^\s*(?:\S+\/)?go\s+test\b/u.test(command)) return undefined;
  const ok = lines.filter(line => /^ok\s+\S+\s+(?:[\d.]+s|\(cached\))/u.test(line)).length;
  const failedPackages = lines.filter(line => /^FAIL\s+\S+\s+(?:[\d.]+s|\[build failed\]|\[setup failed\])/u.test(line)).length;
  if (!ok && !failedPackages) return undefined;
  const failing = collect(lines, line => {
    const text = line.trimStart();
    return text.startsWith('--- FAIL: ') ? text.slice(10).split(' ')[0] : undefined;
  });
  return {kind: 'tests', source: 'go test', outcome: failedPackages > 0 ? 'failed' : 'passed',
    overview: `${plural(ok, 'package')} ok · ${plural(failedPackages, 'package')} failed${failing.items.length ? ` · ${plural(failing.items.length + failing.omitted, 'failing test')}` : ''}`, ...failing};
};

/** Commands that compile or check code: their diagnostics are the point even when they exit 0. */
const BUILD = /^\s*(?:\S+\/)?(?:tsc|npx\s+tsc|vue-tsc|gcc|g\+\+|cc|c\+\+|clang|clang\+\+|make|ninja|cmake|cargo\s+(?:build|check|clippy|run|test)|rustc|swift\s+build|xcodebuild|go\s+(?:build|vet)|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:build|typecheck|check|lint|compile|tsc))\b/u;

/** One TypeScript diagnostic, pretty (`file:1:2 - error TS…: …`) or plain (`file(1,2): error TS…: …`). */
function typescriptDiagnostic(line: string): string | undefined {
  for (const severity of ['error', 'warning'] as const) {
    const pretty = line.indexOf(` - ${severity} TS`);
    if (pretty > 0 && isLocation(line.slice(0, pretty))) {
      const rest = /^(TS\d{1,6}): (.*)$/u.exec(line.slice(pretty + severity.length + 4));
      if (rest) return `${line.slice(0, pretty)} ${rest[1]}: ${rest[2]}`;
    }
    const plain = line.indexOf(`): ${severity} TS`);
    if (plain > 0) {
      const head = /^(\S+)\((\d{1,7}),(\d{1,7})$/u.exec(line.slice(0, plain));
      const rest = /^(TS\d{1,6}): (.*)$/u.exec(line.slice(plain + severity.length + 4));
      if (head && rest) return `${head[1]}:${head[2]}:${head[3]} ${rest[1]}: ${rest[2]}`;
    }
  }
  return undefined;
}

/** TypeScript diagnostics, and tsc's `Found N errors` line. */
const typescript: Recognizer = (command, lines, exitCode) => {
  const found = findLast(lines, line => /^Found \d{1,9} errors?(?: in .+)?\.?$/u.test(line));
  if (!found && !lines.some(line => typescriptDiagnostic(line) !== undefined)) return undefined;
  if (!found && exitCode === 0 && !BUILD.test(command)) return undefined;
  const items = collect(lines, typescriptDiagnostic);
  const errors = number(found ? /^Found (\d{1,9}) errors?/u.exec(found)?.[1] : undefined) ?? items.items.length + items.omitted;
  const files = found ? /in (\d{1,9}) files/u.exec(found)?.[1] : undefined;
  return {kind: 'diagnostics', source: 'TypeScript', outcome: errors > 0 ? 'failed' : 'passed',
    overview: `${plural(errors, 'error')}${files ? ` in ${files} files` : ''}`, ...items};
};

/** The location of a Rust ` --> file:line:col` line, or undefined. */
function rustLocation(line: string | undefined): string | undefined {
  const text = line?.trim();
  return text?.startsWith('--> ') && isLocation(text.slice(4)) ? text.slice(4) : undefined;
}

/** Rust: `error[E0308]: …` / `warning: …` headings with their ` --> file:line:col` location. */
const rust: Recognizer = (command, lines, exitCode) => {
  if (!lines.some(line => rustLocation(line) !== undefined)) return undefined;
  if (exitCode === 0 && !BUILD.test(command)) return undefined;
  const items: SemanticItem[] = [];
  let omitted = 0;
  let errors = 0;
  let warnings = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^(error|warning)(\[E\d{4}\])?: (.+)$/u.exec(lines[index]!);
    if (!heading || /^(?:could not compile|aborting due to|`.+` \(.+\) generated \d+ warnings?)/u.test(heading[3]!)) continue;
    const location = rustLocation(lines[index + 1]);
    if (!location) continue;
    if (heading[1] === 'error') errors += 1; else warnings += 1;
    const text = `${location} ${heading[1]}${heading[2] ?? ''}: ${heading[3]}`;
    if (items.length < MAX_ITEMS) items.push({text, tone: heading[1] === 'error' ? 'failure' : 'warning'}); else omitted += 1;
  }
  if (!errors && !warnings) return undefined;
  return {kind: 'diagnostics', source: 'Rust', outcome: errors > 0 ? 'failed' : 'passed',
    overview: [errors ? plural(errors, 'error') : '', warnings ? plural(warnings, 'warning') : ''].filter(Boolean).join(' · '), items, omitted};
}

/** One GCC/Clang diagnostic `file:line:col: error: …` as [location, severity, message]. */
function cDiagnostic(line: string): [string, string, string] | undefined {
  for (const severity of ['fatal error', 'error', 'warning'] as const) {
    const at = line.indexOf(`: ${severity}: `);
    if (at > 0 && isLocation(line.slice(0, at))) return [line.slice(0, at), severity, line.slice(at + severity.length + 4)];
  }
  return undefined;
}

/** GCC and Clang diagnostics. */
const cCompilers: Recognizer = (command, lines, exitCode) => {
  if (!lines.some(line => cDiagnostic(line) !== undefined)) return undefined;
  if (exitCode === 0 && !BUILD.test(command)) return undefined;
  let errors = 0;
  let warnings = 0;
  for (const line of lines) {
    const diagnostic = cDiagnostic(line);
    if (diagnostic) { if (diagnostic[1] === 'warning') warnings += 1; else errors += 1; }
  }
  const failures = collect(lines, line => {
    const diagnostic = cDiagnostic(line);
    return diagnostic && `${diagnostic[0]} ${diagnostic[1]}: ${diagnostic[2]}`;
  });
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
  // trimEnd is linear (a `\s+$` pattern is not), and over-long lines are not read at all.
  const lines = text.split('\n').map(line => line.length > MAX_LINE ? '' : line.trimEnd());
  const shown = command.length > 1024 ? command.slice(0, 1024) : command;
  for (const recognizer of RECOGNIZERS) {
    const result = recognizer(shown, lines, exitCode);
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
