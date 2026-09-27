import test from 'node:test';
import assert from 'node:assert/strict';
import {fuzzyMatch, NativeSuggestions} from '../src/suggestions/NativeSuggestions.js';
import {historyIgnorePattern, ignorePatternFromEnv, type CommandEntry, type SuggestionContext} from '../src/suggestions/types.js';
import {parseAtuinHistory, parseZshHistory, unmetafy} from '../src/shell/HistoryService.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 1);
const context = (buffer: string, overrides: Partial<SuggestionContext> = {}): SuggestionContext =>
  ({buffer, cwd: '/work/app', previous: [], now: NOW, ...overrides});
const texts = (engine: NativeSuggestions, query: SuggestionContext) => engine.query(query).map(item => item.text);
const entries = (...items: Array<[string, number, Partial<CommandEntry>?]>): CommandEntry[] =>
  items.map(([command, daysAgo, rest]) => ({command, at: NOW - daysAgo * DAY, ...rest}));

test('fuzzy: in-order subsequence from a word start with a bounded spread', () => {
  assert.ok(fuzzyMatch('gst', 'git status') !== undefined);
  assert.ok(fuzzyMatch('dcu', 'docker compose up -d') !== undefined);
  assert.equal(fuzzyMatch('tsg', 'git status'), undefined, 'order matters');
  assert.equal(fuzzyMatch('ab', 'xaaaaaaaaaaaaaaaaaaaaaaab'), undefined, 'must start at a word boundary');
  assert.equal(fuzzyMatch('gz', `g${'x'.repeat(40)}z`), undefined, 'spread is limited');
  const engine = new NativeSuggestions();
  engine.load(entries(['docker compose up -d', 1], ['git status', 1]));
  assert.deepEqual(texts(engine, context('dcu')), ['docker compose up -d']);
  assert.deepEqual(texts(engine, context('git s')), ['git status'], 'prefix matches can be ghost text');
});

test('frecency: recent use beats an old command of equal frequency; frequency still counts', () => {
  const engine = new NativeSuggestions();
  engine.load(entries(['npm run build', 60], ['npm run dev', 1]));
  assert.deepEqual(texts(engine, context('npm run '))[0], 'npm run dev');
  engine.load(entries(...Array.from({length: 12}, () => ['npm run build', 2] as [string, number]), ['npm run dev', 1]));
  assert.deepEqual(texts(engine, context('npm run '))[0], 'npm run build');
});

test('directory affinity: the command used here wins over one used elsewhere', () => {
  const engine = new NativeSuggestions();
  engine.load(entries(['make test', 1, {cwd: '/work/app'}], ['make deploy', 1, {cwd: '/work/infra'}]));
  assert.equal(texts(engine, context('make '))[0], 'make test');
  assert.equal(texts(engine, context('make ', {cwd: '/work/infra'}))[0], 'make deploy');
  assert.equal(texts(engine, context('make ', {cwd: '/work/infra/modules'}))[0], 'make deploy', 'subdirectories are related');
});

test('sequence prediction: what followed the previous command ranks first', () => {
  const engine = new NativeSuggestions();
  engine.load(entries(['git checkout main', 1], ['git checkout main', 1], ['git add .', 1], ['git commit -m wip', 1],
    ['git add .', 1], ['git commit -m fix', 1]));
  assert.equal(texts(engine, context('git c', {previous: ['git add .']}))[0]!.startsWith('git commit'), true);
  assert.equal(texts(engine, context('git c'))[0], 'git checkout main');
  assert.deepEqual(texts(engine, context('', {previous: ['git add .']})).slice(0, 2).sort(), ['git commit -m fix', 'git commit -m wip']);
  assert.deepEqual(texts(engine, context('', {previous: ['unknown']})), []);
});

test('failed commands are de-prioritized, not hidden', () => {
  const engine = new NativeSuggestions();
  engine.load(entries(['cargo test --all', 1, {exitCode: 101}], ['cargo test --all', 1, {exitCode: 101}], ['cargo test', 1, {exitCode: 0}],
    ['cargo test', 1, {exitCode: 0}]));
  assert.deepEqual(texts(engine, context('cargo t')), ['cargo test', 'cargo test --all']);
});

test('ignored commands are never suggested or learned; session commands survive a history reload', () => {
  const ignore = historyIgnorePattern('(export *SECRET*|pass *)');
  const engine = new NativeSuggestions(ignore);
  engine.load(entries(['export API_SECRET=1', 1], ['pass show bank', 1], ['export PATH=/bin', 1]));
  engine.record({command: ' echo hidden'});
  engine.record({command: 'echo shown', at: NOW});
  assert.deepEqual(texts(engine, context('export ')), ['export PATH=/bin']);
  assert.deepEqual(texts(engine, context('pass')), []);
  assert.deepEqual(texts(engine, context('echo')), ['echo shown']);
  engine.load(entries(['ls', 1]));
  assert.deepEqual(texts(engine, context('echo')), ['echo shown']);
  assert.equal(engine.size, 2);
  assert.ok(ignorePatternFromEnv({HISTORY_IGNORE: 'ls', ZSH_AUTOSUGGEST_HISTORY_IGNORE: 'cd *'})!.test('cd /x'));
});

test('history sources: atuin metadata, zsh extended history, continuation lines and metafied UTF-8', () => {
  const atuin = parseAtuinHistory('2026-09-02 10:00:00\t0\t/work\tgit status\n\u00002026-09-01 10:00:00\t1\tunknown\techo "a\tb"\n\u0000');
  assert.deepEqual(atuin, [
    {command: 'echo "a\tb"', at: Date.UTC(2026, 8, 1, 10), exitCode: 1},
    {command: 'git status', at: Date.UTC(2026, 8, 2, 10), exitCode: 0, cwd: '/work'},
  ]);
  const zsh = parseZshHistory(': 1700000000:0;ls -la\n: 1700000001:0;for f in *; do\\\necho $f\\\ndone\nplain\n');
  assert.deepEqual(zsh.map(entry => entry.command), ['ls -la', 'for f in *; do\necho $f\ndone', 'plain']);
  assert.equal(zsh[0]!.at, 1700000000000);
  const metafied = Buffer.from('echo é', 'utf8');
  const encoded = Buffer.from([...metafied].flatMap(byte => byte >= 0x83 && byte <= 0xa2 ? [0x83, byte ^ 0x20] : [byte]));
  assert.equal(unmetafy(encoded).toString('utf8'), 'echo é');
});

test('benchmark: 100k-entry history answers keystrokes well within the budget', () => {
  const tools = ['git', 'npm', 'docker', 'kubectl', 'cargo', 'make', 'python3', 'ls', 'cd', 'grep'];
  const verbs = ['status', 'run', 'build', 'test', 'logs', 'apply', 'get', 'push', 'pull', 'exec'];
  const history: CommandEntry[] = [];
  for (let index = 0; index < 100_000; index += 1) {
    const tool = tools[index % tools.length]!;
    const verb = verbs[(index * 7) % verbs.length]!;
    history.push({command: `${tool} ${verb} target-${index % 3000} --flag ${index % 17}`, at: NOW - (100_000 - index) * 60_000,
      cwd: `/work/project-${index % 40}`, exitCode: index % 23 === 0 ? 1 : 0});
  }
  const engine = new NativeSuggestions();
  const loadStart = performance.now();
  engine.load(history, NOW);
  const loadMs = performance.now() - loadStart;
  const timings: number[] = [];
  const buffers = tools.flatMap(tool => [tool.slice(0, 1), tool.slice(0, 2), `${tool} `, `${tool} st`, `${tool} ru`, `${tool.slice(0, 2)}x`, 'gst', 'dcl']);
  // Best of three per buffer: the suite runs files in parallel, and contention is not query cost.
  for (const buffer of buffers) {
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const started = performance.now();
      engine.query(context(buffer, {previous: ['git status target-1 --flag 1'], cwd: '/work/project-3'}));
      best = Math.min(best, performance.now() - started);
    }
    timings.push(best);
  }
  timings.sort((a, b) => a - b);
  const p95 = timings[Math.floor(timings.length * 0.95)]!;
  // Generous ceiling for shared CI runners; typical local p95 is a few milliseconds.
  assert.ok(p95 < 60, `p95 ${p95.toFixed(1)}ms`);
  assert.ok(loadMs < 5000, `load ${loadMs.toFixed(0)}ms`);
  test.diagnostic?.(`native suggestions: ${engine.size} unique, load ${loadMs.toFixed(0)}ms, p95 ${p95.toFixed(2)}ms`);
});
