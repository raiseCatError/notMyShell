import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRequest} from '../src/ask/resolver.js';
import {configTargets, type ConfigEnvironment} from '../src/ask/configTargets.js';
import {systemFileAssistEnvironment} from '../src/ask/configAssist.js';
import {applyPlan, inspectFile, planJsonSet, planReplace, renderEditCommand, scanJson} from '../src/ask/fileEdit.js';
import {createAskState, receiveOutcome, askKey, visibleOptions} from '../src/ask/AskPanel.js';
import type {AskContext, AskOutcome, AskReferents} from '../src/ask/types.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-askcfg-')));
const home = join(root, 'home');
const project = join(home, 'proj');
test.after(() => rmSync(root, {recursive: true, force: true}));

function setup(): void {
  rmSync(home, {recursive: true, force: true});
  mkdirSync(join(home, '.config', 'zed'), {recursive: true});
  mkdirSync(join(home, '.config', 'nmsh'), {recursive: true});
  mkdirSync(project, {recursive: true});
  writeFileSync(join(home, '.config', 'zed', 'settings.json'), '// Zed settings\n{\n  // theme\n  "theme": "One Dark",\n  "terminal": {\n    "font_size": 13,\n  },\n}\n');
  writeFileSync(join(home, '.config', 'nmsh', 'config.json'), '{\n  "provider": "nmsh"\n}\n');
  writeFileSync(join(home, '.zshrc'), 'export PATH="$HOME/bin:$PATH"\nexport API_TOKEN=abc123\n');
  writeFileSync(join(project, 'package.json'), '{\n  "name": "foo",\n  "scripts": {\n    "test": "node --test"\n  }\n}\n');
  writeFileSync(join(project, 'tsconfig.json'), '{\n  "compilerOptions": {\n    "strict": true\n  }\n}\n');
}

const environment = (): ConfigEnvironment => ({home, env: {XDG_CONFIG_HOME: join(home, '.config')}, platform: 'linux', shell: 'zsh', projectRoot: project,
  exists: path => { try { readFileSync(path); return true; } catch { return false; } }, list: directory => { try { return execFileSync('ls', ['-A', directory], {encoding: 'utf8'}).split('\n').filter(Boolean); } catch { return []; } }});
const python3 = spawnSync('python3', ['--version']).status === 0 ? 'python3' : undefined;
const files = () => systemFileAssistEnvironment(home, project, python3, process.execPath);
function context(referents?: AskReferents): AskContext {
  const configs = configTargets(environment()).map(target => ({...target, exists: Boolean(target.path && environment().exists(target.path))}));
  return {cwd: project, home, repoRoot: project, worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [], recentFiles: [], recentCommands: [],
    editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0, configs, ...(referents ? {referents} : {})};
}
const ask = (raw: string, referents?: AskReferents) => resolveRequest(raw, context(referents), {}, undefined, files());
const opened = (outcome: AskOutcome) => outcome.kind === 'proposal' && outcome.action.kind === 'openFile' ? outcome.action.path : undefined;
const labels = (outcome: AskOutcome) => outcome.kind === 'choose' ? outcome.options.map(option => option.label) : [];
const text = (outcome: AskOutcome) => 'text' in outcome ? outcome.text : '';

test('config resolution: named targets open directly; "open my config" uses the conversation or asks among real files', () => {
  setup();
  assert.equal(opened(ask('open zed config')), join(home, '.config', 'zed', 'settings.json'));
  assert.equal(opened(ask('open nmsh config')), join(home, '.config', 'nmsh', 'config.json'));
  assert.equal(opened(ask('open my zsh config')), join(home, '.zshrc'));
  assert.deepEqual(labels(ask('open project config')), ['package.json', 'tsconfig.json'], 'only the project files that exist');
  assert.equal(opened(ask('open project config', {config: {id: 'project:tsconfig.json', label: 'tsconfig.json', path: join(project, 'tsconfig.json')}})), join(project, 'tsconfig.json'));
  // "open my config" — A: Zed in the conversation; B: NMSh; C: shell talk; D: no context.
  const zed = ask('change my zed terminal settings');
  assert.match(text(zed), /Zed settings is at ~\/\.config\/zed\/settings\.json\. NMSh doesn't have verified knowledge of its setting keys/u);
  assert.equal(opened(ask('open my config', (zed as {referents: AskReferents}).referents)), join(home, '.config', 'zed', 'settings.json'));
  assert.equal(opened(ask('open my config', {config: {id: 'nmsh', label: 'NMSh config', path: join(home, '.config', 'nmsh', 'config.json')}})), join(home, '.config', 'nmsh', 'config.json'));
  assert.equal(opened(ask('open the config where my aliases go')), join(home, '.zshrc'));
  const vague = ask('open my config');
  assert.equal(vague.kind, 'choose');
  assert.deepEqual(labels(vague).sort(), ['NMSh config', 'Zed settings', 'package.json', 'tsconfig.json', 'zsh config'].sort(), 'only configs that exist; never generic categories');
});

test('missing config: said plainly; created only where the path and format are known, through a plan', () => {
  setup();
  rmSync(join(home, '.config', 'zed', 'settings.json'));
  const outcome = ask('open zed config');
  assert.match(text(outcome), /Zed settings doesn't exist yet at ~\/\.config\/zed\/settings\.json/u);
  const create = outcome.kind === 'answer' ? outcome.next?.find(option => option.label === 'Create it') : undefined;
  assert.ok(create?.outcome && create.outcome.kind === 'answer' && create.outcome.block?.run?.kind === 'applyEdit');
  assert.ok(!(ask('open ghostty config').kind === 'answer' && (ask('open ghostty config') as {next?: unknown[]}).next?.length), 'no known initial format: no create');
});

test('JSONC: add, no-op, update, duplicates refuse; comments, trailing commas and other keys are untouched', () => {
  setup();
  const path = join(home, '.config', 'zed', 'settings.json');
  const before = readFileSync(path, 'utf8');
  const add = ask('add this to my zed config:\n{"terminal": {"line_height": "comfortable"}}');
  assert.equal(add.kind, 'answer');
  assert.match(text(add), /adds terminal\.line_height/u);
  assert.match(text(add), /\+ {5}"line_height": "comfortable",/u);
  const plan = add.kind === 'answer' && add.block?.run?.kind === 'applyEdit' ? add.block.run.plan : undefined;
  assert.ok(plan);
  assert.deepEqual(applyPlan(plan!), {ok: true});
  const after = readFileSync(path, 'utf8');
  assert.ok(after.startsWith('// Zed settings\n{\n  // theme\n  "theme": "One Dark",'), 'comments and order kept');
  assert.ok(scanJson(after, true).ok, 'still valid JSONC');
  assert.equal(after.length - before.length, after.split('\n').length > before.split('\n').length ? after.length - before.length : 0);
  assert.match(text(ask('add this to my zed config:\n{"terminal": {"line_height": "comfortable"}}')), /already has that setting; nothing to change/u, 'idempotent');
  const update = ask('set terminal.font_size to 15 in my zed config');
  assert.match(text(update), /updates terminal\.font_size[\s\S]*- {5}"font_size": 13,[\s\S]*\+ {5}"font_size": 15,/u);
  writeFileSync(path, '{"a": 1, "a": 2}\n');
  assert.match(text(ask('set a to 3 in my zed config')), /appears 2 times/u);
  writeFileSync(path, '{"a": 1,,}\n');
  assert.match(text(ask('set a to 3 in my zed config')), /isn't valid JSON with comments/u, 'malformed: no plan');
});

test('package.json: "show package.json" then "add this under scripts" → verified plan', () => {
  setup();
  const show = ask('open package.json');
  const referents = show.kind === 'proposal' ? show.referents : undefined;
  assert.equal(referents?.file, join(project, 'package.json'));
  const add = ask('add this under scripts: "lint": "eslint ."', referents);
  assert.match(text(add), /adds scripts\.lint/u);
  assert.match(text(add), /\+ {5}"lint": "eslint \."/u);
});

test('shell config: idempotent append; secrets in context are masked; key=value and TOML set', () => {
  setup();
  const add = ask('add this line to my shell config:\nalias ll="ls -la"');
  assert.match(text(add), /appends 1 line[\s\S]*\+ alias ll="ls -la"/u);
  assert.doesNotMatch(text(add), /abc123/u, 'an unrelated secret value never appears');
  const plan = add.kind === 'answer' && add.block?.run?.kind === 'applyEdit' ? add.block.run.plan : undefined;
  applyPlan(plan!);
  assert.match(text(ask('add this line to my shell config:\nalias ll="ls -la"')), /already contains that/u);
  writeFileSync(join(project, 'pyproject.toml'), '[project]\nname = "x"\n\n[tool.ruff]\nline-length = 88\n');
  const toml = ask('set tool.ruff.line-length to 100 in pyproject.toml');
  assert.match(text(toml), /- line-length = 88[\s\S]*\+ line-length = 100/u);
});

test('exact replacement: one, none, several (choose, then the chosen span), multiline block', () => {
  setup();
  const file = join(project, 'foo.py');
  writeFileSync(file, 'x = 5\ny = 1\n');
  const one = ask('in foo.py replace x = 5 with x = 10');
  assert.match(text(one), /foo\.py · line 1[\s\S]*- x = 5\n\+ x = 10/u);
  assert.match(text(ask('in foo.py replace z = 1 with z = 2')), /not in/u);
  writeFileSync(file, 'x = 5\nprint(x)\nx = 5\n');
  const many = ask('in foo.py replace x = 5 with x = 10');
  assert.deepEqual(labels(many), ['line 1 · x = 5', 'line 3 · x = 5']);
  const second = many.kind === 'choose' ? many.options[1]!.outcome! : many;
  const plan = second.kind === 'answer' && second.block?.run?.kind === 'applyEdit' ? second.block.run.plan : undefined;
  applyPlan(plan!);
  assert.equal(readFileSync(file, 'utf8'), 'x = 5\nprint(x)\nx = 10\n', 'exactly the chosen span');
  writeFileSync(join(project, 'parser.py'), 'def f(x):\n    if x:\n        foo()\n        bar()\n    return x\n');
  const blockEdit = ask('replace this block in parser.py\n    if x:\n        foo()\n        bar()\nwith\n    if x:\n        baz()');
  assert.match(text(blockEdit), /- {9}foo\(\)\n- {9}bar\(\)\n\+ {9}baz\(\)/u);
});

test('generated commands: run from the plan, refuse if the file changed, keep mode, work under sh and fish quoting', () => {
  setup();
  const file = join(project, 'foo.py');
  writeFileSync(file, 'x = 5\n');
  chmodSync(file, 0o640);
  const facts = inspectFile(file, [home]);
  const result = planReplace(facts, 'x = 5', 'x = 10');
  assert.equal(result.kind, 'plan');
  if (result.kind !== 'plan') return;
  for (const runtimes of [...(python3 ? [{python3, node: process.execPath}] : []), {node: process.execPath}]) {
    writeFileSync(file, 'x = 5\n');
    const command = renderEditCommand(result.plan, facts.content!, runtimes);
    assert.doesNotMatch(command.split('\n').slice(1, -1).join('\n'), /'/u, 'no single quotes inside the quoted script');
    assert.equal(spawnSync('/bin/sh', ['-c', command]).status, 0);
    assert.equal(readFileSync(file, 'utf8'), 'x = 10\n');
    assert.equal((spawnSync('stat', ['-c', '%a', file], {encoding: 'utf8'}).stdout || '640').trim(), '640', 'mode kept');
    writeFileSync(file, 'x = 5\n# edited meanwhile\n');
    const stale = spawnSync('/bin/sh', ['-c', command], {encoding: 'utf8'});
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /changed since it was inspected; nothing was written/u);
    assert.equal(readFileSync(file, 'utf8'), 'x = 5\n# edited meanwhile\n');
  }
  writeFileSync(file, 'x = 5\nchanged\n');
  assert.equal(applyPlan(result.plan).ok, false, 'Run refuses a stale plan too');
});

test('safety: symlink target shown; read-only and outside-home refused; removal unsupported', () => {
  setup();
  mkdirSync(join(home, 'dotfiles'));
  writeFileSync(join(home, 'dotfiles', 'zshrc'), 'export A=1\n');
  rmSync(join(home, '.zshrc'));
  symlinkSync(join(home, 'dotfiles', 'zshrc'), join(home, '.zshrc'));
  assert.match(text(ask('add this line to my shell config:\nexport B=2')), /~\/\.zshrc → ~\/dotfiles\/zshrc \(a symlink; the target file is what changes\)/u);
  chmodSync(join(home, 'dotfiles', 'zshrc'), 0o444);
  if (process.getuid?.() !== 0) assert.match(text(ask('add this line to my shell config:\nexport C=3')), /not writable by you; Ask won't change permissions or use sudo/u);
  assert.match(planJsonSet(inspectFile('/etc/hostname', [home]), 'json', [{path: ['a'], value: 1}]).kind === 'refuse' ? 'refused' : '', /refused/u);
  for (const request of ['remove the theme setting from my zed config', 'delete this line from my zshrc']) assert.equal(ask(request).kind, 'unsupported', request);
});

test('actions: Copy/Insert/Run; Run reaches only the final Yes/No; "show me the command instead"', () => {
  setup();
  const add = ask('set terminal.font_size to 16 in my zed config');
  const state = createAskState();
  receiveOutcome(state, add);
  assert.deepEqual(visibleOptions(state).map(option => option.key), ['block:copy', 'block:insert', 'block:run']);
  state.selected = 2;
  assert.equal(askKey(state, {kind: 'enter'}), undefined);
  assert.equal(state.pending?.kind, 'proposal');
  assert.match(state.pending?.kind === 'proposal' ? state.pending.text : '', /^Apply this edit to .*settings\.json\?$/u);
  assert.equal(state.confirm, 'no');
  const again = ask('show me the command instead', state.referents);
  assert.ok(again.kind === 'answer' && again.block?.script?.includes('nothing was written'));
});

test('pasting a snippet into Ask keeps its lines', () => {
  const state = createAskState();
  askKey(state, {kind: 'paste', value: 'add this:\r\n{"a": 1}\r\n'});
  assert.equal(state.input, 'add this:\n{"a": 1}\n');
});
