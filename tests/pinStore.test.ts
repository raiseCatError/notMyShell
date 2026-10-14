import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {addPin, addRecipe, applies, changeItem, cleanName, inScope, keepProblem, loadPins, MAX_PINS, removeItem} from '../src/pins/PinStore.js';
import {expandSteps, placeholdersIn, quotedPlaceholder, valueProblem} from '../src/pins/recipes.js';
import {fishQuote, posixQuote} from '../src/shell/adapters/ShellAdapter.js';

function sandbox() {
  const directory = mkdtempSync(join(tmpdir(), 'nmsh-pins-'));
  return {path: join(directory, 'nmsh', 'pins.json'), directory, cleanup: () => rmSync(directory, {recursive: true, force: true})};
}

test('nothing exists until something is saved; a save creates a private file', () => {
  const {path, cleanup} = sandbox();
  try {
    assert.deepEqual(loadPins(path), {ok: true, value: {version: 1, pins: [], recipes: []}});
    assert.equal(existsSync(path), false, 'reading never creates the file');
    const pin = addPin({command: 'git status', name: '  my   status ', scope: 'directory', cwd: '/work/app'}, path, 5);
    assert.ok(pin.ok);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.deepEqual(loadPins(path), {ok: true, value: {version: 1, pins: [{id: pin.ok ? pin.value.id : '', command: 'git status', name: 'my status', scope: 'directory', cwd: '/work/app', createdAt: 5}], recipes: []}});
    assert.deepEqual(readdirSync(join(path, '..')).sort(), ['pins.json'], 'no temporary or lock files are left');
  } finally { cleanup(); }
});

test('secrets are refused, not stored; oversized, empty and duplicate pins too', () => {
  const {path, cleanup} = sandbox();
  try {
    for (const command of ['curl -H "Authorization: Bearer abc.def.ghi" x', 'export TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'mysql --password=hunter2 db']) {
      const result = addPin({command}, path);
      assert.equal(result.ok, false, command);
      assert.match(result.ok ? '' : result.reason, /secret/u);
    }
    assert.equal(existsSync(path), false, 'a refused save writes nothing');
    assert.match(keepProblem('   ') ?? '', /nothing to keep/u);
    assert.match(keepProblem('x'.repeat(70_000)) ?? '', /too long/u);
    assert.equal(keepProblem('cd ~/Projects && ls'), undefined, 'private paths are fine');
    assert.ok(addPin({command: 'ls'}, path).ok);
    assert.match(addPin({command: 'ls'}, path).ok ? '' : (addPin({command: 'ls'}, path) as {reason: string}).reason, /already pinned/u);
  } finally { cleanup(); }
});

test('a file this version cannot read is reported and never replaced', () => {
  const {path, directory, cleanup} = sandbox();
  try {
    assert.ok(addPin({command: 'ls'}, path).ok);
    for (const content of ['{ not json', '{"version":2,"pins":[]}', '[]']) {
      writeFileSync(path, content);
      const loaded = loadPins(path);
      assert.equal(loaded.ok, false);
      const result = addPin({command: 'pwd'}, path);
      assert.equal(result.ok, false, 'a save does not overwrite it');
      assert.equal(readFileSync(path, 'utf8'), content);
    }
    assert.equal(readdirSync(join(directory, 'nmsh')).filter(name => name !== 'pins.json').length, 0);
  } finally { cleanup(); }
});

test('hostile or damaged entries are dropped on load; names are single clean lines', () => {
  const {path, cleanup} = sandbox();
  try {
    assert.ok(addPin({command: 'ls'}, path).ok);
    writeFileSync(path, JSON.stringify({version: 1, pins: [
      {id: 'good', command: 'ls', name: 'a‮b\nc\u0007d', scope: 'directory', cwd: 'relative/path', createdAt: 1},
      {id: '../escape', command: 'ls'}, {id: 'nocommand'}, {id: 'big', command: 'x'.repeat(70_000)}, 'string', null,
    ], recipes: [
      {id: 'r1', name: 'Deploy', steps: ['a', 'b']}, {id: 'r2', name: '', steps: ['a']}, {id: 'r3', name: 'Bad', steps: ['a', 7]}, {id: 'r4', name: 'Empty', steps: []},
    ]}));
    const loaded = loadPins(path);
    assert.ok(loaded.ok);
    if (!loaded.ok) return;
    assert.deepEqual(loaded.value.pins.map(pin => [pin.id, pin.name, pin.scope, pin.cwd]), [['good', 'a b c d', 'global', undefined]]);
    assert.deepEqual(loaded.value.recipes.map(recipe => recipe.id), ['r1']);
    assert.equal(cleanName('x'.repeat(500)).length, 80);
  } finally { cleanup(); }
});

test('rename, scope and delete act on the item with that id only, and report a vanished item', () => {
  const {path, cleanup} = sandbox();
  try {
    const a = addPin({command: 'ls', cwd: '/w'}, path, 1);
    const b = addPin({command: 'pwd'}, path, 2);
    assert.ok(a.ok && b.ok);
    if (!a.ok || !b.ok) return;
    assert.ok(changeItem(a.value.id, {name: 'list'}, path).ok);
    assert.ok(changeItem(a.value.id, {scope: 'directory'}, path).ok);
    assert.match((changeItem(b.value.id, {scope: 'directory'}, path) as {reason: string}).reason, /not pinned from a directory/u);
    assert.ok(removeItem(b.value.id, path).ok);
    assert.match((removeItem(b.value.id, path) as {reason: string}).reason, /no longer exists/u);
    const loaded = loadPins(path);
    assert.deepEqual(loaded.ok && loaded.value.pins.map(pin => [pin.name, pin.scope]), [['list', 'directory']]);
  } finally { cleanup(); }
});

test('limits: pins, recipes and steps are bounded', () => {
  const {path, cleanup} = sandbox();
  try {
    for (let index = 0; index < MAX_PINS; index += 1) assert.ok(addPin({command: `echo ${index}`}, path).ok || index > 0);
    const loaded = loadPins(path);
    assert.ok(loaded.ok && loaded.value.pins.length === MAX_PINS);
    assert.match((addPin({command: 'one more'}, path) as {reason: string}).reason, /at most 500/u);
    assert.match((addRecipe({name: 'big', steps: Array.from({length: 101}, () => 'ls')}, path) as {reason: string}).reason, /at most 100/u);
  } finally { cleanup(); }
});

test('recipes: named once (any case), secrets refused, steps kept in order', () => {
  const {path, cleanup} = sandbox();
  try {
    const recipe = addRecipe({name: ' Deploy  app ', description: 'push it', steps: ['git pull', 'npm run build', 'scp -r dist {{host}}:/srv'], scope: 'directory', cwd: '/w/app'}, path, 9);
    assert.ok(recipe.ok);
    assert.equal(recipe.ok && recipe.value.name, 'Deploy app');
    assert.match((addRecipe({name: 'deploy APP', steps: ['ls']}, path) as {reason: string}).reason, /already exists/u);
    assert.match((addRecipe({name: 'bad', steps: ['ls', 'export API_KEY=sk-abcdefghijklmnopqrstuvwxyz']}, path) as {reason: string}).reason, /secret/u);
    assert.match((addRecipe({name: '', steps: ['ls']}, path) as {reason: string}).reason, /needs a name/u);
    assert.match((addRecipe({name: 'none', steps: []}, path) as {reason: string}).reason, /at least one/u);
    assert.ok(changeItem(recipe.ok ? recipe.value.id : '', {steps: ['one', 'two']}, path).ok);
    const loaded = loadPins(path);
    assert.deepEqual(loaded.ok && loaded.value.recipes[0]!.steps, ['one', 'two']);
  } finally { cleanup(); }
});

test('scope: directory items apply in their directory and below; global ones everywhere; "all" shows everything', () => {
  const items = [
    {id: 'g', scope: 'global' as const, createdAt: 1},
    {id: 'd', scope: 'directory' as const, cwd: '/w/app', createdAt: 2},
    {id: 'o', scope: 'directory' as const, cwd: '/other', createdAt: 3},
  ];
  assert.deepEqual(inScope(items, '/w/app').map(item => item.id), ['d', 'g']);
  assert.deepEqual(inScope(items, '/w/app/src').map(item => item.id), ['d', 'g']);
  assert.deepEqual(inScope(items, '/w/application').map(item => item.id), ['g'], 'a sibling with the same prefix is not inside');
  assert.deepEqual(inScope(items, '/elsewhere').map(item => item.id), ['g']);
  assert.deepEqual(inScope(items, '/elsewhere', true).map(item => item.id), ['o', 'd', 'g']);
  assert.equal(applies(items[1]!, '/w/app'), true);
});

test('two NMSh processes saving at once lose nothing', () => {
  const {path, cleanup} = sandbox();
  try {
    const script = `
      import {addPin} from ${JSON.stringify(join(process.cwd(), 'src/pins/PinStore.ts'))};
      for (let index = 0; index < 15; index += 1) addPin({command: process.argv[2] + ' ' + index}, process.argv[3]);
    `;
    const scriptPath = join(path, '..', '..', 'writer.mts');
    writeFileSync(scriptPath, script);
    const children = ['alpha', 'beta', 'gamma'].map(name => spawnSync(process.execPath, ['--import=tsx', scriptPath, name, path], {encoding: 'utf8', timeout: 60_000}));
    for (const child of children) assert.equal(child.status, 0, child.stderr);
    const loaded = loadPins(path);
    assert.ok(loaded.ok);
    assert.equal(loaded.ok && loaded.value.pins.length, 45);
    assert.equal(loaded.ok && new Set(loaded.value.pins.map(pin => pin.id)).size, 45);
  } finally { cleanup(); }
});

test('placeholders: found in order, quoted as one word for the shell, never inside quotes', () => {
  assert.deepEqual(placeholdersIn(['scp {{file}} {{host}}:/srv', 'ssh {{host}} ls', 'echo {{bad name}} {{x_1}}']), ['file', 'host', 'x_1']);
  assert.equal(quotedPlaceholder('echo "{{name}}"'), 'name');
  assert.equal(quotedPlaceholder("echo '{{name}}'"), 'name');
  assert.equal(quotedPlaceholder('echo {{name}} "done"'), undefined);
  assert.equal(quotedPlaceholder('echo \\"{{name}}'), undefined, 'an escaped quote opens nothing');
  const steps = ['scp {{file}} {{host}}:/srv'];
  assert.deepEqual(expandSteps(steps, {file: "it's a file.txt", host: 'box'}), {ok: true, steps: ["scp 'it'\\''s a file.txt' 'box':/srv"]});
  assert.deepEqual(expandSteps(['rm {{f}}'], {f: 'a; reboot $(id)'}, fishQuote), {ok: true, steps: ["rm 'a; reboot $(id)'"]});
  assert.deepEqual(expandSteps(['echo {{a}} {{a}}'], {a: 'x y'}, posixQuote), {ok: true, steps: ["echo 'x y' 'x y'"]});
  assert.match((expandSteps(steps, {file: 'x'}) as {reason: string}).reason, /\{\{host\}\}/u);
  assert.match((expandSteps(['rm {{f}}'], {f: '-rf'}) as {reason: string}).reason, /\{\{f\}\}/u, 'an option-looking value is refused');
});

test('values: no options, controls, bidi or oversize; a value is never expanded by the shell', () => {
  for (const bad of ['', '-rf', '--help', 'a\nb', 'a\u0007b', 'a‮b', 'x'.repeat(501)]) assert.ok(valueProblem(bad), JSON.stringify(bad));
  for (const good of ['./-rf', 'plain', '$(id)', '`id`', '~/x', 'a b', "it's", 'ü😀']) assert.equal(valueProblem(good), undefined, good);
  for (const hostile of ['$(touch /tmp/pwn)', '`id`', '$HOME', '*', 'a;b', "x' ; echo y '", '${IFS}']) {
    const result = expandSteps(['printf %s {{v}}'], {v: hostile});
    assert.ok(result.ok);
    if (!result.ok) return;
    const run = spawnSync('sh', ['-c', result.steps[0]!], {encoding: 'utf8', timeout: 5000, cwd: tmpdir()});
    assert.equal(run.stdout, hostile, `the shell printed the value, unexpanded: ${hostile}`);
  }
});
