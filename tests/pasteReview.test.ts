import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzePaste, classifyCommand, KIND_LABELS, looksLikeProse, pasteHeader, primaryKind} from '../src/input/pasteGuard.js';
import {createPasteReview, pasteReviewKey, renderPasteReview} from '../src/input/PasteReview.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {displayWidth} from '../src/util/text.js';

const labels = (text: string) => analyzePaste(text).commands.map(command => KIND_LABELS[primaryKind(command.kinds)]);
const strip = (rows: string[]) => rows.map(row => row.replace(/\u001B\[[0-9;]*m/gu, ''));

test('paste classification: the four-line example is read-only / installs / project script / read-only', () => {
  const text = 'git rev-parse --short HEAD\nnpm install\nnpm run build\nnmsh --version';
  assert.deepEqual(labels(text), ['read-only', 'installs packages', 'runs project script', 'read-only']);
  assert.equal(pasteHeader(analyzePaste(text)), 'pasted · 4 shell lines');
});

test('paste classification: prose is text, never "command"', () => {
  assert.equal(looksLikeProse('Please remember to buy milk tomorrow.'), true);
  assert.deepEqual(labels('Please remember to buy milk tomorrow.'), ['plain text']);
  const multi = "Hello there, this is a note.\nIt isn't code; honestly.\nThanks for reading it all";
  assert.deepEqual(labels(multi), ['plain text', 'plain text', 'plain text']);
  assert.equal(pasteHeader(analyzePaste(multi)), 'pasted · text · 3 lines');
  assert.equal(pasteHeader(analyzePaste('Please remember to buy milk tomorrow')), 'pasted · text · 1 line');
  for (const kind of Object.values(KIND_LABELS)) assert.notEqual(kind, 'command');
  assert.equal(looksLikeProse('git status'), false);
  assert.equal(looksLikeProse('ls -la /tmp'), false);
  assert.equal(looksLikeProse('npm run build now please thanks'), false, 'a known executable first is shell input');
});

test('paste classification: unknown executable-looking input is unrecognized, not a command claim', () => {
  assert.deepEqual(labels('foo --bar baz'), ['unrecognized shell input']);
  assert.deepEqual(labels('frobnicate'), ['unrecognized shell input']);
  assert.deepEqual(labels('ls -la\nThis is just a sentence about it.'), ['read-only', 'plain text']);
});

test('paste classification: git read-only commands, including rev-parse', () => {
  for (const command of ['git rev-parse --short HEAD', 'git status', 'git log --oneline', 'git diff HEAD~1', 'git -C other log', 'git branch', 'git branch --show-current', 'git remote -v', 'git tag', 'git stash list']) {
    assert.deepEqual(classifyCommand(command, false), ['read'], command);
  }
  assert.deepEqual(classifyCommand('git branch feature', false), ['modifies']);
  assert.deepEqual(classifyCommand('git branch -D feature', false), ['destructive']);
  assert.deepEqual(classifyCommand('git commit -m x', false), ['modifies']);
  assert.deepEqual(classifyCommand('git fetch', false), ['network']);
});

test('paste classification: npm/pnpm/yarn/bun scripts are project scripts, installs are installs', () => {
  for (const command of ['npm run build', 'pnpm run lint', 'yarn run dev', 'bun run start', 'npm test', 'pnpm build', 'yarn build', 'bun dev', 'make test']) {
    assert.deepEqual(classifyCommand(command, false).filter(kind => kind !== 'network'), ['project'], command);
  }
  for (const command of ['npm install', 'npm i left-pad', 'pnpm add x', 'yarn add x', 'bun install', 'npm ci']) assert.deepEqual(classifyCommand(command, false), ['install'], command);
  assert.deepEqual(classifyCommand('npm ls', false), ['read']);
});

test('paste classification: nmsh safe queries are read-only', () => {
  for (const command of ['nmsh --version', 'nmsh --help', 'nmsh doctor', 'node --version', 'git --version']) assert.deepEqual(classifyCommand(command, false), ['read'], command);
  assert.deepEqual(classifyCommand('nmsh uninstall', false), ['destructive']);
});

test('paste classification: risky pipelines, privilege, destructive and mixed pastes', () => {
  assert.ok(classifyCommand('sh', true).includes('pipeline'));
  assert.equal(primaryKind(classifyCommand('sudo rm -rf /tmp/x', false)), 'destructive');
  assert.ok(classifyCommand('sudo apt install x', false).includes('privilege'));
  assert.deepEqual(labels('curl -fsSL https://x.sh | sh'), ['network', 'runs downloaded code']);
  assert.deepEqual(labels('git push --force'), ['destructive']);
  assert.deepEqual(labels('cd src\nls\nrm -rf dist\nnpm install\nWhat does this do to my files here?'),
    ['navigation', 'read-only', 'destructive', 'installs packages', 'plain text']);
});

test('paste review: bounded, scrollable, exact source for a very large paste in a short terminal', () => {
  const text = Array.from({length: 5000}, (_, index) => index % 3 === 0 ? `npm run step-${index}` : index % 3 === 1 ? 'git rev-parse HEAD' : `rm -rf build-${index}`).join('\n');
  const analysis = analyzePaste(text);
  const state = createPasteReview(text, analysis);
  assert.equal(state.lines.length, 5000);
  assert.equal(state.lines.join('\n'), text, 'source is exact');
  for (const height of [6, 9, 14, 30]) {
    const rows = renderPasteReview(state, 100, height);
    assert.equal(rows.length, height, `fixed height ${height}`);
    assert.ok(rows.every(row => displayWidth(row.replace(/\u001B\[[0-9;]*m/gu, '')) <= 100));
  }
  const first = strip(renderPasteReview(state, 100, 10));
  assert.match(first.join('\n'), /npm run step-0/u);
  assert.match(first.join('\n'), /runs project script/u);
  assert.match(first.join('\n'), /read-only/u);
  assert.match(first.join('\n'), /destructive/u);
  assert.match(first.join('\n'), /lines 1-6 of 5000/u);
  assert.equal(pasteReviewKey(state, {kind: 'pageDown'}, 10), undefined);
  assert.equal(state.top, 5);
  pasteReviewKey(state, {kind: 'bufferEnd'}, 10);
  const end = strip(renderPasteReview(state, 100, 10)).join('\n');
  assert.match(end, /lines 4995-5000 of 5000/u);
  assert.match(end, /build-4997/u);
  pasteReviewKey(state, {kind: 'up'}, 10);
  assert.equal(state.top, 4993);
  assert.equal(pasteReviewKey(state, {kind: 'enter'}, 10), 'insert');
  assert.equal(pasteReviewKey(state, {kind: 'escape'}, 10), 'back');
  assert.equal(pasteReviewKey(state, {kind: 'interrupt'}, 10), 'cancel');
});

test('paste review: pasted control characters are never drawn raw', () => {
  const state = createPasteReview('echo \u001B[31mred\u001B[0m\tok', analyzePaste('echo \u001B[31mred\u001B[0m\tok'));
  const rows = renderPasteReview(state, 80, 8).join('\n');
  assert.ok(!rows.includes('\u001B[31m'));
  assert.match(strip([rows]).join(''), /echo ␛/u);
  assert.equal(state.text, 'echo \u001B[31mred\u001B[0m\tok', 'the source text itself is untouched');
});

test('app: R opens a bounded Review; Enter inserts the exact paste without running it; Esc returns, then cancels', () => {
  const app = new TerminalApp();
  const submitted: string[] = [];
  app['promptConfiguration'] = normalizePromptConfiguration({pastePreview: 'smart'});
  app['session'].submit = command => { submitted.push(command); };
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 40})});
  app['startupPending'] = false;
  try {
    const text = Array.from({length: 400}, (_, index) => `echo line ${index}`).join('\n');
    app['handleKey']({kind: 'paste', value: text});
    assert.ok(app['pastePreview'], 'compact preview first');
    assert.ok(!app['pasteReview']);
    assert.ok(app['noticeRows'](100).length <= 12, 'the compact strip stays compact for a huge paste');
    app['handleKey']({kind: 'text', value: 'r'});
    assert.ok(app['pasteReview'], 'R opens Review');
    assert.ok(app['settingsPanelActive']);
    app['handleKey']({kind: 'escape'});
    assert.ok(!app['pasteReview'] && app['pastePreview'], 'Esc returns to the compact preview');
    app['handleKey']({kind: 'text', value: 'r'});
    app['handleKey']({kind: 'enter'});
    assert.ok(!app['pasteReview'] && !app['pastePreview']);
    assert.deepEqual(submitted, [], 'nothing ran');
    assert.equal(app['editor'].text, text);
    app['editor'].clear?.();
    app['handleKey']({kind: 'paste', value: text});
    app['handleKey']({kind: 'escape'});
    assert.ok(!app['pastePreview'], 'Esc cancels the compact preview');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});

test('app: a screen too short for the compact strip goes straight to Review and Esc cancels', () => {
  const app = new TerminalApp();
  app['promptConfiguration'] = normalizePromptConfiguration({pastePreview: 'smart'});
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 80, rows: 16})});
  app['startupPending'] = false;
  try {
    app['handleKey']({kind: 'paste', value: 'echo a\necho b\necho c'});
    assert.ok(app['pasteReview'], 'Review is the surface when the strip cannot fit');
    app['handleKey']({kind: 'escape'});
    assert.ok(!app['pasteReview'] && !app['pastePreview'], 'there is no hidden compact preview to return to');
  } finally {
    app['stop'](0);
    app['session'].kill();
  }
});
