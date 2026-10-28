import {Journal} from '../src/backups/journal.js';
import {createChangesPanel} from '../src/backups/ChangesPanel.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPromptConfiguration, savePromptConfiguration} from '../src/prompt/configuration.js';

function sandbox(): {dir: string; path: string; done: () => void} {
  const dir = mkdtempSync(join(tmpdir(), 'nmsh-config-persist-'));
  return {dir, path: join(dir, 'config.json'), done: () => { try { chmodSync(dir, 0o700); } catch { /* gone */ } rmSync(dir, {recursive: true, force: true}); }};
}

test('absent config: defaults load and first save creates the file', () => {
  const box = sandbox();
  try {
    const config = loadPromptConfiguration(box.path);
    savePromptConfiguration({...config, glyphStyle: 'safe'}, box.path, config);
    assert.equal(loadPromptConfiguration(box.path).glyphStyle, 'safe');
  } finally { box.done(); }
});

test('ordinary valid save keeps unknown fields', () => {
  const box = sandbox();
  try {
    writeFileSync(box.path, JSON.stringify({onboardingComplete: true, futureField: {a: 1}}), 'utf8');
    const config = loadPromptConfiguration(box.path);
    savePromptConfiguration({...config, glyphStyle: 'safe'}, box.path, config);
    const saved = JSON.parse(readFileSync(box.path, 'utf8')) as Record<string, unknown>;
    assert.deepEqual(saved.futureField, {a: 1});
    assert.equal(saved.glyphStyle, 'safe');
  } finally { box.done(); }
});

test('malformed config is never destroyed by a save; the error names the path', () => {
  const box = sandbox();
  try {
    const bytes = '{"futureField": 1, "oops": ';
    writeFileSync(box.path, bytes, 'utf8');
    const config = loadPromptConfiguration(box.path);
    assert.throws(() => savePromptConfiguration({...config, glyphStyle: 'safe'}, box.path, config), (error: Error) => error.message.includes(box.path));
    assert.equal(readFileSync(box.path, 'utf8'), bytes);
    assert.deepEqual(readdirSync(box.dir), ['config.json']);
  } finally { box.done(); }
});

test('non-object JSON config is treated as malformed', () => {
  const box = sandbox();
  try {
    writeFileSync(box.path, '[1,2]', 'utf8');
    assert.throws(() => savePromptConfiguration(loadPromptConfiguration(box.path), box.path), /config\.json/);
    assert.equal(readFileSync(box.path, 'utf8'), '[1,2]');
  } finally { box.done(); }
});

test('unreadable config is never replaced by a save', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const box = sandbox();
  try {
    writeFileSync(box.path, JSON.stringify({futureField: 7}), 'utf8');
    chmodSync(box.path, 0o000);
    assert.throws(() => savePromptConfiguration(loadPromptConfiguration(box.path), box.path), (error: Error) => error.message.includes(box.path));
    chmodSync(box.path, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(box.path, 'utf8')), {futureField: 7});
  } finally { box.done(); }
});

test('two frontends with the same stale base keep each other\'s unrelated settings', () => {
  const box = sandbox();
  try {
    writeFileSync(box.path, JSON.stringify({onboardingComplete: true}), 'utf8');
    const a = loadPromptConfiguration(box.path);
    const b = loadPromptConfiguration(box.path);
    savePromptConfiguration({...a, glyphStyle: 'safe'}, box.path, a);
    savePromptConfiguration({...b, transcriptPresentation: 'chat', syntax: {...b.syntax, mode: 'off'} as typeof b.syntax}, box.path, b);
    const final = loadPromptConfiguration(box.path);
    assert.equal(final.glyphStyle, 'safe');
    assert.equal(final.transcriptPresentation, 'chat');
  } finally { box.done(); }
});

test('mkdir of missing parent still works', () => {
  const box = sandbox();
  try {
    const nested = join(box.dir, 'x', 'config.json');
    savePromptConfiguration(loadPromptConfiguration(nested), nested);
    assert.equal(existsSync(nested), true);
    mkdirSync(join(box.dir, 'y'));
  } finally { box.done(); }
});

test('settings save survives a rejected checkpoint under a group writable HOME', () => {
 const box=sandbox();box.path=join(box.dir,'.config/nmsh/config.json');const previous=process.env.HOME;process.env.HOME=box.dir;
 try {chmodSync(box.dir,0o775);savePromptConfiguration({...loadPromptConfiguration(box.path),glyphStyle:'safe'},box.path);assert.equal(loadPromptConfiguration(box.path).glyphStyle,'safe');
 const journal=new Journal({home:box.dir,directory:join(box.dir,'.config/nmsh/backups')});
 assert.match(createChangesPanel(journal,[]).message,/Settings backup unavailable/u);
 savePromptConfiguration({...loadPromptConfiguration(box.path),glyphStyle:'safe'},box.path);
 assert.doesNotMatch(createChangesPanel(journal,[]).message,/Settings backup unavailable/u);
 }
 finally {if(previous===undefined)delete process.env.HOME;else process.env.HOME=previous;box.done();}
});

test('settings still save when checkpoint completion fails',t=>{
 const box=sandbox();t.after(box.done);
 t.mock.method(Journal.prototype,'complete',()=>{throw new Error('completion unavailable');});
 savePromptConfiguration({...loadPromptConfiguration(box.path),glyphStyle:'safe'},box.path);
 assert.equal(loadPromptConfiguration(box.path).glyphStyle,'safe');
 assert.match(createChangesPanel(new Journal({home:box.dir,directory:join(box.dir,'backups')}),[]).message,/completion unavailable/u);
});
