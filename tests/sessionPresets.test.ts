import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SessionPresetStore, presetCommands, presetNeedsAcknowledgement, PresetStartup, validatePreset} from '../src/session/SessionPresets.js';
import {createPresetPanel, presetPanelKey, presetReviewRows, renderPresetPanel} from '../src/session/PresetPanel.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {paletteItems} from '../src/ui/CommandPalette.js';
import {displayWidth} from '../src/util/text.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {LiveSandbox, until} from './helpers/liveFrontend.js';

test('versioned sidecar create/list/inspect/delete preserves legacy config and stores only explicit values', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-store-'));
  try {
    writeFileSync(join(root,'config.json'),'{"legacy":true}');
    const store = new SessionPresetStore(root);
    assert.deepEqual(store.list(),[]);
    const preset = store.create({name:'my project',cwd:root,commands:['echo explicit']});
    assert.equal(store.get(preset.name).commands[0],'echo explicit');
    assert.equal(readFileSync(join(root,'config.json'),'utf8'),'{"legacy":true}');
    assert.equal(statSync(store.path).mode & 0o777,0o600);
    const data = JSON.parse(readFileSync(store.path,'utf8'));
    assert.equal(data.version,1);
    assert.deepEqual(Object.keys(data.presets[0]).sort(),['commands','cwd','name']);
    assert.throws(()=>store.create({name:'my project',cwd:root,commands:[]}),/Duplicate/);
    assert.throws(()=>store.get('missing'),/not found/);
    assert.throws(()=>store.create({name:'../bad',cwd:root,commands:[]}),/name/);
    assert.throws(()=>store.create({name:'bad',cwd:join(root,'missing'),commands:[]}),/cwd/);
    assert.throws(()=>validatePreset({name:'bad',cwd:root,commands:['echo\u001b']}),/commands/);
    store.delete('my project');
    assert.deepEqual(store.list(),[]);
    assert.throws(()=>store.delete('missing'),/not found/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('malformed/future/duplicate storage is preserved; unknown env values never survive serialization', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-malformed-'));
  try {
    const store = new SessionPresetStore(root);
    for (const content of ['bad','{"version":2,"presets":[]}','{"version":1,"presets":[{"name":"bad"}]}', JSON.stringify({version:1,presets:[{name:'dup',cwd:root,commands:[]},{name:'dup',cwd:root,commands:[]}]})]) {
      writeFileSync(store.path,content);
      assert.throws(()=>store.list(),/Malformed/);
      assert.throws(()=>store.create({name:'safe',cwd:root,commands:[]}),/Malformed/);
      assert.equal(readFileSync(store.path,'utf8'),content);
    }
    writeFileSync(store.path,JSON.stringify({version:1,presets:[{name:'refs',cwd:root,commands:['mise run build'],env:{SECRET:'do-not-copy'}}]}));
    const preset = store.get('refs');
    assert.ok(!JSON.stringify(preset).includes('SECRET'));
    store.acknowledge(preset);
    assert.ok(!readFileSync(store.path,'utf8').includes('do-not-copy'));
    writeFileSync(`${store.path}.lock`,'other writer');
    assert.throws(()=>store.delete('refs'),/busy/);
    assert.equal(readFileSync(`${store.path}.lock`,'utf8'),'other writer');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('acknowledgement binds exact cwd and command order; changed commands do not run or get silently acknowledged', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-ack-'));
  try {
    const store = new SessionPresetStore(root), preset = store.create({name:'work',cwd:root,commands:['echo one','echo two']});
    assert.ok(presetNeedsAcknowledgement(preset));
    assert.throws(()=>new PresetStartup(preset),/acknowledgement/);
    const approved = store.acknowledge(preset);
    assert.equal(presetNeedsAcknowledgement(approved),false);
    const changed = {...approved,commands:['echo changed']};
    writeFileSync(store.path,JSON.stringify({version:1,presets:[changed]}));
    assert.ok(presetNeedsAcknowledgement(store.get('work')));
    assert.throws(()=>store.acknowledge(approved),/changed/);
    assert.throws(()=>new PresetStartup(changed),/acknowledgement/);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('real cd quoting handles spaces/apostrophes; queue orders commands, stops failed cd/startup, never changes process cwd', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-quote-')), target = join(root,"it's a project");
  mkdirSync(target);
  try {
    const store = new SessionPresetStore(root), preset = store.acknowledge(store.create({name:'quoted',cwd:target,commands:['echo one','echo two']}));
    const before = process.cwd(), commands = presetCommands(preset);
    const shell = spawnSync('/bin/zsh',['-fc',`${commands[0]}; print -r -- "$PWD"`],{encoding:'utf8'});
    assert.equal(shell.status,0); assert.equal(shell.stdout.trim(),target);
    const queue = new PresetStartup(preset);
    assert.deepEqual(queue.next(0,before),{command:commands[0]});
    assert.deepEqual(queue.next(0,target),{command:'echo one'});
    assert.deepEqual(queue.next(0,target),{command:'echo two'});
    assert.equal(queue.next(0,target),undefined);
    assert.equal(queue.active,false);
    const failed = new PresetStartup(preset); failed.next(0,before);
    assert.ok('error' in failed.next(1,before)!);
    assert.equal(failed.next(0,target),undefined);
    const startupFailed = new PresetStartup(preset); startupFailed.next(0,before); startupFailed.next(0,target);
    assert.ok('error' in startupFailed.next(2,target)!);
    assert.equal(process.cwd(),before);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('shared preset form/review is passive, default-No, fully wrapped and keyboard usable in narrow/plain/Safe', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-ui-')), old = process.env.NO_COLOR;
  try {
    const state = createPresetPanel([]);
    presetPanelKey(state,{kind:'text',value:'n'},root);
    presetPanelKey(state,{kind:'text',value:'work'},root);
    presetPanelKey(state,{kind:'complete'},root);
    presetPanelKey(state,{kind:'complete'},root);
    presetPanelKey(state,{kind:'text',value:'echo one'},root);
    presetPanelKey(state,{kind:'newline'},root);
    presetPanelKey(state,{kind:'text',value:'echo two'},root);
    assert.equal(state.form?.commands,'echo one\necho two');
    assert.equal(presetPanelKey(state,{kind:'enter'},root),'create');
    state.form = undefined; state.detail = {name:'work',cwd:root,commands:['echo '+ 'a'.repeat(200)]};
    presetPanelKey(state,{kind:'text',value:'l'},root);
    assert.equal(state.confirm?.choice,'no');
    assert.equal(presetPanelKey(state,{kind:'enter'},root),undefined);
    presetPanelKey(state,{kind:'text',value:'l'},root);
    presetPanelKey(state,{kind:'right'},root);
    assert.equal(presetPanelKey(state,{kind:'enter'},root),'launch');
    assert.ok(presetReviewRows(state.detail,20).join('').includes('a'.repeat(200)));
    process.env.NO_COLOR = '1'; setIconStyle('safe');
    for (const width of [1,12,30,80]) {
      const rows = renderPresetPanel(state,width,24);
      assert.ok(rows.every(row=>displayWidth(row)<=width));
      assert.ok(rows.every(row=>!/\u001b\[(?:38|48);/u.test(row)));
    }
    assert.deepEqual(parseSlashCommand('/presets'),{kind:'presets'});
    assert.ok(paletteItems().some(item=>item.id === 'slash:/presets'));
  } finally {if (old === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR=old;setIconStyle('nerd');rmSync(root,{recursive:true,force:true});}
});

test('ordinary app preset listing/inspection never submits; Bottom/Top/Flow use shared panel', async () => {
  const root = mkdtempSync(join(tmpdir(),'preset-app-')), app = new TerminalApp();
  Object.defineProperty(app,'render',{value:()=>{}});
  Object.defineProperty(app,'presetStore',{value:new SessionPresetStore(root)});
  let submissions = 0;
  Object.defineProperty(app['session'],'submit',{value:()=>{submissions++;}});
  try {
    app['presetStore'].create({name:'work',cwd:root,commands:['echo visible']});
    await app['runSlash']('/presets',{kind:'presets'});
    for (const position of ['bottom','top','flow'] as const) {
      app['promptConfiguration'].composerPosition = position;
      assert.ok(app['settingsPanelActive']);
      app['handlePresetKey']({kind:'enter'},app['presetPanel']!);
      assert.match(app['settingsPanelRows'](80)!.join('\n'),/echo visible/);
    }
    assert.equal(submissions,0);
  } finally {app['stop'](0);app['session'].kill();rmSync(root,{recursive:true,force:true});}
});

test('CLI preset launch creates a distinct live shell, visible cd/ordered transcript, detach/reattach and resume without replay', async () => {
  const sandbox = new LiveSandbox({liveSessionStartup:'always'});
  try {
    const target = join(sandbox.home,"it's a project"); mkdirSync(target);
    const store = new SessionPresetStore(join(sandbox.config,'nmsh'));
    store.acknowledge(store.create({name:'work',cwd:target,commands:['print -r -- PRESET_ONE','print -r -- PRESET_TWO']}));
    const original = sandbox.launch(['--new']); await original.waitFor(/❯/);
    await until(async()=> (await sandbox.sessions()).length===1);
    const prior = (await sandbox.sessions())[0]!;
    original.pty.kill('SIGKILL'); await original.waitExit();
    await until(async()=> (await sandbox.sessions())[0]?.state==='detached');
    const launched = sandbox.launch(['--preset','work']);
    await launched.waitFor(/PRESET_TWO/);
    await until(async()=> (await sandbox.sessions()).some(session=>session.id!==prior.id && !session.running && session.cwd===target));
    const created = (await sandbox.sessions()).find(session=>session.id!==prior.id)!;
    assert.notEqual(created.pid,prior.pid);
    // Service idle can precede frontend delivery of its last prompt. Startup
    // blocks composer keys until that delivery; the completed journal is the
    // frontend's durable acknowledgement, not merely a service-side snapshot.
    await until(async()=> {
      for (const journal of await sandbox.transcripts().list()) {
        const loaded = await sandbox.transcripts().load(journal.id);
        if (loaded.live?.sessionId === created.id && loaded.transcript.records.some(record => record.command === 'print -r -- PRESET_TWO' && record.exitCode === 0)) return true;
      }
      return false;
    });
    await launched.run('print -r -- READY_PRESET',/READY_PRESET/);
    const journals = await sandbox.transcripts().list();
    let records: string[] = [];
    for (const journal of await sandbox.transcripts().list()) {
      const loaded = await sandbox.transcripts().load(journal.id);
      if (loaded.live?.sessionId === created.id) records = loaded.transcript.records.map(record=>record.command).reverse();
    }
    assert.deepEqual(records.slice(0,3),presetCommands(store.get('work')));
    launched.pty.kill('SIGKILL'); await launched.waitExit();
    await until(async()=> (await sandbox.sessions()).find(session=>session.id===created.id)?.state==='detached');
    const attached = sandbox.launch(['--attach',created.id]); await attached.waitFor(/Reattached live session/);
    await attached.run('print -r -- PRESET_PID=$$',new RegExp(`PRESET_PID=${created.pid}`));
    await attached.run('/resume',/Resume session/);
    await attached.waitFor(new RegExp(prior.cwd.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.equal((await sandbox.sessions()).find(session=>session.id===prior.id)?.state,'detached');
    assert.ok(journals.length >= 1);
  } finally {await sandbox.dispose();}
});

test('first-launch decline and changed startup commands require review before any session starts', async () => {
  const sandbox = new LiveSandbox();
  try {
    const store = new SessionPresetStore(join(sandbox.config,'nmsh'));
    const preset = store.create({name:'consent',cwd:sandbox.home,commands:['print -r -- CONSENT_STARTED']});
    const declined = sandbox.launch(['--preset','consent']);
    await declined.waitFor(/Review startup commands/);
    declined.pty.write('\r');
    assert.equal(await declined.waitExit(),0);
    assert.deepEqual(await sandbox.sessions(),[]);
    assert.ok(presetNeedsAcknowledgement(store.get('consent')));
    const accepted = sandbox.launch(['--preset','consent']);
    await accepted.waitFor(/Review startup commands/);
    accepted.pty.write('y');
    // The command text is also in the review; wait for a live composer before
    // probing an empty service that is still bootstrapping.
    await accepted.waitFor(/❯/);
    await until(async()=> (await sandbox.sessions()).length===1 && !(await sandbox.sessions())[0]!.running,15000,()=> 'accepted preset idle; output: '+accepted.output.slice(-3000));
    assert.equal(presetNeedsAcknowledgement(store.get('consent')),false);
    const approved = store.get('consent');
    writeFileSync(store.path,JSON.stringify({version:1,presets:[{...approved,commands:['print -r -- CHANGED_STARTUP']}]}));
    const changed = sandbox.launch(['--preset','consent']);
    await changed.waitFor(/Review startup commands/);
    changed.pty.write('\u001b');
    await changed.waitExit();
    assert.equal((await sandbox.sessions()).length,1);
    assert.deepEqual(store.get('consent').commands,['print -r -- CHANGED_STARTUP']);
    assert.deepEqual(preset.commands,['print -r -- CONSENT_STARTED']);
  } finally {await sandbox.dispose();}
});

test('UI preset launch detaches current session and creates a new identity without mutating its shell', async () => {
  const sandbox = new LiveSandbox();
  try {
    const store = new SessionPresetStore(join(sandbox.config,'nmsh'));
    store.create({name:'ui-work',cwd:sandbox.home,commands:['print -r -- UI_PRESET_STARTED']});
    const frontend = sandbox.launch(['--new']); await frontend.waitFor(/❯/);
    const previous = (await sandbox.sessions())[0]!;
    await frontend.run('/presets',/Session presets/);
    frontend.pty.write('\r'); await frontend.waitFor(/Stored startup commands/);
    frontend.pty.write('l'); await frontend.waitFor(/Review startup commands/);
    frontend.pty.write('y'); await frontend.waitFor(/UI_PRESET_STARTED/);
    await until(async()=> (await sandbox.sessions()).length===2 && (await sandbox.sessions()).some(session=>session.id!==previous.id && !session.running));
    assert.equal((await sandbox.sessions()).find(session=>session.id===previous.id)?.state,'detached');
    assert.equal((await sandbox.sessions()).find(session=>session.id===previous.id)?.cwd,previous.cwd);
    assert.notEqual((await sandbox.sessions()).find(session=>session.id!==previous.id)?.pid,previous.pid);
  } finally {await sandbox.dispose();}
});

test('CLI listing and factual errors execute nothing; missing cwd is rejected before launch', async () => {
  const sandbox = new LiveSandbox();
  try {
    const store = new SessionPresetStore(join(sandbox.config,'nmsh'));
    const target = join(sandbox.home,'removed');mkdirSync(target);
    store.create({name:'gone',cwd:target,commands:['touch should-not-run']});
    const entry = fileURLToPath(new URL('../src/index.ts',import.meta.url));
    const listed = spawnSync(process.execPath,['--import=tsx',entry,'--presets'],{env:sandbox.env,cwd:process.cwd(),encoding:'utf8'});
    assert.equal(listed.status,0);assert.match(listed.stdout,/gone/);assert.deepEqual(await sandbox.sessions(),[]);
    rmSync(target,{recursive:true});
    const missing = sandbox.launch(['--preset','gone']);await missing.waitFor(/cwd is missing/);assert.equal(await missing.waitExit(),1);
    const unknown = sandbox.launch(['--preset','absent']);await unknown.waitFor(/Preset not found/);assert.equal(await unknown.waitExit(),1);
    const badFlag = sandbox.launch(['--preset']);await badFlag.waitFor(/Usage: nmsh --preset/);assert.equal(await badFlag.waitExit(),2);
    assert.deepEqual(await sandbox.sessions(),[]);
  } finally {await sandbox.dispose();}
});

test('failed startup is visible and later commands are not executed', async () => {
  const sandbox = new LiveSandbox();
  try {
    const store = new SessionPresetStore(join(sandbox.config,'nmsh'));
    store.acknowledge(store.create({name:'failed',cwd:sandbox.home,commands:['false','print -r -- MUST_NOT_RUN']}));
    const frontend = sandbox.launch(['--preset','failed']);await frontend.waitFor(/Preset startup stopped/);
    assert.ok(!frontend.output.includes('MUST_NOT_RUN'));
    await frontend.run('print -r -- STILL_REAL_ZSH',/STILL_REAL_ZSH/);
    assert.equal((await sandbox.sessions()).length,1);
  } finally {await sandbox.dispose();}
});

 test('preset UI create/delete use the sidecar; in-process launch reports a factual error without mutating its session', async () => {
  const root = mkdtempSync(join(tmpdir(),'preset-actions-')), app = new TerminalApp();
  Object.defineProperty(app,'render',{value:()=>{}});
  Object.defineProperty(app,'presetStore',{value:new SessionPresetStore(root)});
  try {
    app['startPresets']();
    const state = app['presetPanel']!;
    app['handlePresetKey']({kind:'text',value:'n'},state);
    state.form = {name:'created',cwd:root,commands:'echo one\necho two',field:2};
    app['handlePresetKey']({kind:'enter'},state);
    assert.deepEqual(app['presetStore'].get('created').commands,['echo one','echo two']);
    app['handlePresetKey']({kind:'enter'},state);
    app['handlePresetKey']({kind:'text',value:'l'},state);
    app['handlePresetKey']({kind:'text',value:'y'},state);
    assert.match(state.message!,/live-session service/);
    assert.equal(app.switchPreset,undefined);
    app['handlePresetKey']({kind:'text',value:'d'},state);
    app['handlePresetKey']({kind:'enter'},state);
    assert.equal(app['presetStore'].list().length,1,'No remains the delete default');
    app['handlePresetKey']({kind:'text',value:'d'},state);
    app['handlePresetKey']({kind:'text',value:'y'},state);
    assert.deepEqual(app['presetStore'].list(),[]);
  } finally {app['stop'](0);app['session'].kill();rmSync(root,{recursive:true,force:true});}
});

 test('preset storage refuses symlink writes and preserves their target', () => {
  const root = mkdtempSync(join(tmpdir(),'preset-symlink-'));
  try {
    const target = join(root,'target.json'),store = new SessionPresetStore(root);
    writeFileSync(target,'{"version":1,"presets":[]}');symlinkSync(target,store.path);
    assert.throws(()=>store.list(),/regular file/);
    assert.throws(()=>store.create({name:'safe',cwd:root,commands:[]}),/regular file/);
    assert.equal(readFileSync(target,'utf8'),'{"version":1,"presets":[]}');
  } finally {rmSync(root,{recursive:true,force:true});}
});
