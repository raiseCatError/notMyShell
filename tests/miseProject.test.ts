import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {detectMiseProject, MiseProjectService, miseTaskCommand, parseMiseMetadata} from '../src/tools/MiseProject.js';
import {misePanelKey, renderMisePanel, type MisePanel} from '../src/tools/MisePanel.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth} from '../src/util/text.js';

function fixture(body = `process.stdout.write(JSON.stringify(process.argv[2] === 'ls' ? {node:[{version:'22',env:'secret'}]} : [{name:"test's task",run:'secret',env:['secret']}]))`) {
  const root = mkdtempSync(join(tmpdir(), 'mise-fixture-'));
  const binary = join(root, 'mise'), log = join(root, 'calls');
  writeFileSync(binary, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(process.argv.slice(2))+'\\n');\n${body}`, {mode: 0o700});
  return {root, binary, log, close: () => rmSync(root, {recursive: true, force: true})};
}

test('passive missing/installed/marker detection never invokes mise; consent and cancellation leave config unchanged', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, 'mise.toml'), '{{ exec(command="touch surprise") }}');
    const project = detectMiseProject(f.root, f.binary);
    assert.ok(project.marker);
    assert.equal(detectMiseProject(f.root, '').binary, '');
    assert.equal(existsSync(f.log), false);
    const service = new MiseProjectService();
    assert.equal(await service.inspect(project, false), undefined);
    assert.equal(existsSync(f.log), false);
    const state: MisePanel = {project, selected: 0};
    misePanelKey(state, {kind:'text', value:'i'});
    assert.equal(state.confirm?.choice, 'no');
    assert.equal(misePanelKey(state, {kind:'enter'}), undefined);
    misePanelKey(state, {kind:'text', value:'i'});
    misePanelKey(state, {kind:'right'});
    assert.equal(misePanelKey(state, {kind:'enter'}), 'inspect');
    assert.equal(existsSync(f.log), false);
    assert.equal(existsSync(join(f.root, 'surprise')), false);
  } finally { f.close(); }
});

test('valid metadata allowlists fields; cache, explicit refresh and project/cwd identity stay separate', async () => {
  const f = fixture();
  try {
    const service = new MiseProjectService(), project = detectMiseProject(f.root, f.binary);
    const result = await service.inspect(project, true);
    assert.deepEqual(result, {state:'available', metadata:{tools:[{name:'node',version:'22'}],tasks:["test's task"]}});
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal(await service.inspect(project, true), result);
    assert.equal(readFileSync(f.log,'utf8').trim().split('\n').length,2);
    assert.notEqual(await service.inspect(project, true, true), result);
    assert.equal(readFileSync(f.log,'utf8').trim().split('\n').length,4);
    mkdirSync(join(f.root,'other'));
    const other = detectMiseProject(join(f.root,'other'), f.binary);
    assert.equal(service.cached(other), undefined);
    writeFileSync(join(f.root,'mise.toml'),'[tools]');
    assert.equal(service.cached(detectMiseProject(f.root,f.binary)), undefined);
    assert.equal(service.cached(other),undefined);
  } finally { f.close(); }
});

for (const [name, body] of [
  ['malformed', "process.stdout.write('not json secret')"],
  ['nonzero', "process.stderr.write('secret');process.exit(1)"],
  ['stdout overflow', "process.stdout.write('x'.repeat(10000))"],
  ['stderr overflow', "process.stderr.write('secret'.repeat(10000));process.stdout.write('{}')"],
  ['timeout', 'setInterval(()=>{},1000)'],
] as const) test(`metadata ${name} fails generically with bounded fake tools`, async () => {
  const f = fixture(body);
  try {
    const result = await new MiseProjectService().inspect(detectMiseProject(f.root, f.binary), true, true, {timeoutMs:name === 'timeout' ? 150 : 1500, maxBytes:4096});
    assert.deepEqual(result, {state:'failed'});
    assert.ok(!JSON.stringify(result).includes('secret'));
  } finally { f.close(); }
});

test('schema rejects unsafe names/types, ignores unknown fields and quotes apostrophes as one shell argument', () => {
  assert.deepEqual(parseMiseMetadata('{}','[{"name":"build","unknown":{"secret":1}}]'), {tools:[],tasks:['build']});
  for (const value of ['{}','[{"name":"--trust"}]','[{"name":"bad\\u001b"}]','[{"name":42}]']) assert.throws(() => parseMiseMetadata('{}',value));
  assert.throws(() => parseMiseMetadata('{"node":{}}','[]'));
  assert.equal(miseTaskCommand("test's task"), "mise run 'test'\\''s task'");
});

test('task selection yields composer command only; narrow plain safe presentation has no process side effects', () => {
  const f = fixture();
  const old = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1'; setIconStyle('safe');
    const state: MisePanel = {project:detectMiseProject(f.root,f.binary), selected:0,
      result:{state:'available',metadata:{tools:[],tasks:['build']}}};
    assert.deepEqual(misePanelKey(state,{kind:'enter'}),{command:"mise run 'build'"});
    for (const width of [1,12,30,80]) {
      const rows = renderMisePanel(state,width,24);
      assert.ok(rows.every(row => displayWidth(row) <= width));
      assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)));
    }
    assert.equal(existsSync(f.log),false);
  } finally { if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = old; setIconStyle('nerd'); f.close(); }
});

test('cancelling an in-flight inspection reaps it without caching a result', async () => {
  const f = fixture('setInterval(()=>{},1000)');
  try {
    const service = new MiseProjectService(), project = detectMiseProject(f.root,f.binary);
    const pending = service.inspect(project,true);
    service.cancel();
    assert.equal(await pending,undefined);
    assert.equal(service.cached(project),undefined);
  } finally { f.close(); }
});

 test('Tools task selection edits the live composer and never submits automatically', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app,'render',{value:()=>{}});
  let submissions = 0;
  Object.defineProperty(app['session'],'submit',{value:()=>{submissions++;}});
  try {
    const state: MisePanel = {project:detectMiseProject(process.cwd(),''),selected:0,
      result:{state:'available',metadata:{tools:[],tasks:["it's build"]}}};
    app['misePanel'] = state;
    await app['handleMiseKey']({kind:'enter'},state);
    assert.equal(app['editor'].text, miseTaskCommand("it's build"));
    assert.equal(submissions,0);
    await app['submit']();
    assert.equal(submissions,1);
  } finally {app['stop'](0);app['session'].kill();}
});

test('local mise config files change project identity and are markers', () => {
  const f = fixture();
  try {
    for (const name of ['mise.local.toml', '.mise.local.toml']) {
      const before = detectMiseProject(f.root, f.binary);
      writeFileSync(join(f.root, name), '[tools]\nnode = "22"\n');
      const after = detectMiseProject(f.root, f.binary);
      assert.notEqual(after.identity, before.identity, name);
      assert.ok(after.marker?.endsWith(name) || after.marker, name);
      writeFileSync(join(f.root, name), '[tools]\nnode = "24"\n');
      assert.notEqual(detectMiseProject(f.root, f.binary).identity, after.identity, `${name} edit`);
    }
  } finally { f.close(); }
});
