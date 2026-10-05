import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyPlan, inspectFile} from '../src/ask/fileEdit.js';
import {chooseFormatter, formatterAllowed, pythonBrackets, pythonChecker, repairJson, repairPythonBracket, repairPythonIndent} from '../src/ask/repair.js';
import {systemFileAssistEnvironment} from '../src/ask/configAssist.js';
import {resolveRequest} from '../src/ask/resolver.js';
import type {AskContext} from '../src/ask/types.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-repair-')));
test.after(() => rmSync(root, {recursive: true, force: true}));
const python3 = spawnSync('python3', ['--version']).status === 0 ? 'python3' : undefined;
const facts = (name: string, content: string) => { const path = join(root, name); writeFileSync(path, content); return inspectFile(path, [root]); };
const after = (result: ReturnType<typeof repairJson>) => {
  assert.equal(result.kind, 'plan', JSON.stringify(result));
  if (result.kind !== 'plan') return '';
  const content = readFileSync(result.plan.resolvedPath, 'utf8');
  let text = content;
  for (const edit of result.plan.edits) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
};

test('JSON: one certain fix is proposed (and parses); several or none are reported', () => {
  assert.equal(after(repairJson(facts('a.json', '{\n  "a": 1\n  "b": 2\n}\n'), false)), '{\n  "a": 1,\n  "b": 2\n}\n', 'missing comma');
  assert.equal(after(repairJson(facts('b.json', '{\n  "a": [1, 2\n'), false)), '{\n  "a": [1, 2\n]\n}\n', 'unclosed containers at the end');
  assert.equal(after(repairJson(facts('c.json', '{"a": 1,}\n'), false)), '{"a": 1}\n', 'strict JSON trailing comma');
  assert.equal(repairJson(facts('d.json', '{"a": 1}\n'), false).kind, 'noop');
  assert.equal(repairJson(facts('e.json', '{"a" 1 2 3 }}}\n'), false).kind, 'refuse');
});

test('Python brackets: strings and comments are ignored; one indented unclosed opener closes; two are ambiguous', () => {
  assert.deepEqual(pythonBrackets('s = "(["  # ) ]\nt = \'\'\'\n(\n\'\'\'\n').unclosed, [], 'brackets in strings, triple strings and comments do not count');
  const list = facts('list.py', 'values = [\n    1,\n    2,\n    3\nprint(values)\n');
  const fixed = after(repairPythonBracket(list, pythonChecker(python3)));
  assert.equal(fixed, 'values = [\n    1,\n    2,\n    3\n]\nprint(values)\n');
  const ambiguous = repairPythonBracket(facts('amb.py', 'foo(bar(\nbaz()\n'), pythonChecker(python3));
  assert.equal(ambiguous.kind, 'refuse');
  assert.match(ambiguous.kind === 'refuse' ? ambiguous.reason : '', /2 unclosed brackets[\s\S]*won't guess/u);
});

test('Python indentation: the only possible body is indented; an unclear block extent asks', () => {
  const clear = facts('ind.py', 'def f(foo):\n    if foo:\n    print("x")\n    return 1\n');
  const certain = repairPythonIndent(facts('ind2.py', 'if foo:\nprint("x")\n'), pythonChecker(python3));
  assert.equal(after(certain), 'if foo:\n    print("x")\n');
  const unclear = repairPythonIndent(clear, pythonChecker(python3));
  assert.equal(unclear.kind, 'refuse', 'print and return could both belong to the if');
  assert.match(unclear.kind === 'refuse' ? unclear.reason : '', /Which lines should be inside it/u);
});

test('a candidate that still fails to compile is never proposed', { skip: !python3 && 'python3 is needed for the compile check' }, () => {
  const result = repairPythonBracket(facts('bad.py', 'values = [\n    1 +\n'), pythonChecker(python3));
  assert.equal(result.kind, 'refuse');
});

test('stale file: an applied repair refuses after the file changed', () => {
  const file = facts('stale.json', '{"a": 1 "b": 2}\n');
  const result = repairJson(file, false);
  assert.equal(result.kind, 'plan');
  writeFileSync(join(root, 'stale.json'), '{"a": 1 "b": 3}\n');
  assert.equal(result.kind === 'plan' && applyPlan(result.plan).ok, false);
});

test('formatters: installed and project-configured only; absent ones say so; argv allowlisted', () => {
  const project = join(root, 'proj');
  mkdirSync(project, {recursive: true});
  const which = (installed: string[]) => (name: string) => installed.includes(name) ? `/usr/bin/${name}` : undefined;
  assert.deepEqual(chooseFormatter(join(project, 'a.py'), project, which(['black']), () => false), {name: 'black', argv: ['black', join(project, 'a.py')], note: 'Formats the whole file with Black (pyproject.toml settings apply if present).'});
  assert.deepEqual(chooseFormatter(join(project, 'a.py'), project, which([]), () => false), {missing: ['ruff', 'black']});
  assert.equal(chooseFormatter(join(project, 'a.ts'), project, which(['prettier']), () => false), undefined, 'no project Prettier config: not imposed');
  assert.equal((chooseFormatter(join(project, 'a.ts'), project, which(['prettier']), path => path === join(project, '.prettierrc')) as {name: string}).name, 'prettier');
  assert.ok(formatterAllowed(['gofmt', '-w', 'main.go']));
  assert.ok(!formatterAllowed(['gofmt', '-w', '-r', 'x']));
  assert.ok(!formatterAllowed(['rm', '-rf', 'x']));
});

test('Ask (Local understanding Off): repair requests produce verified plans; big asks are not attempted', () => {
  const project = join(root, 'ask');
  mkdirSync(project, {recursive: true});
  writeFileSync(join(project, 'data.json'), '{\n  "a": 1\n  "b": 2\n}\n');
  writeFileSync(join(project, 'list.py'), 'values = [\n    1,\n    2\nprint(values)\n');
  const context = {cwd: project, home: root, repoRoot: project, worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [], recentFiles: [], recentCommands: [],
    editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0} as AskContext;
  const env = systemFileAssistEnvironment(root, project, python3, process.execPath, () => undefined);
  const json = resolveRequest('fix the json syntax in data.json', context, {}, undefined, env);
  assert.ok(json.kind === 'answer' && json.block?.run?.kind === 'applyEdit' && json.block.run.plan.validate === 'json');
  const py = resolveRequest('fix the missing bracket in list.py', context, {}, undefined, env);
  assert.ok(py.kind === 'answer' && /closes the "\[" opened on line 1/u.test(py.text));
  assert.notEqual(resolveRequest('fix my application', context, {}, undefined, env).kind, 'answer', 'not a verified repair');
});
