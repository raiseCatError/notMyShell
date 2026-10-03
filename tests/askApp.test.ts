import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {SETUP_SECTIONS} from '../src/setup/SetupCat.js';

function app(record = true): TerminalApp {
  const instance = new TerminalApp();
  Object.defineProperty(instance, 'render', {value: () => {}});
  Object.defineProperty(instance, 'dimensions', {value: () => ({columns: 120, rows: 40})});
  instance['startupPending'] = false;
  instance['promptConfiguration'] = {...instance['promptConfiguration'], askRecord: record};
  return instance;
}
/** The persisted transcript (what journals and /resume keep), as text. */
const transcriptText = (instance: TerminalApp) => {
  const transcript = instance['output'].transcript();
  return [...transcript.lines.map((line: Array<{text: string}>) => line.map(cell => cell.text).join('')), ...transcript.records.map((record: {command: string}) => record.command)].join('\n');
};
const until = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i += 1) await new Promise(resolve => setTimeout(resolve, 10)); };

test('config: Record Ask in transcript defaults On; Settings and Setup Cat share the field; local understanding defaults Off with every scope Off', () => {
  assert.equal(DEFAULT_PROMPT_CONFIGURATION.askRecord, true);
  assert.equal(normalizePromptConfiguration({}).askRecord, true, 'existing users get On');
  assert.equal(normalizePromptConfiguration({askRecord: false}).askRecord, false);
  assert.deepEqual(normalizePromptConfiguration({}).localUnderstanding, {mode: 'off', ask: false, folding: false});
  const row = SETTINGS_ROWS.find(item => item.id === 'askRecord')!;
  const section = SETUP_SECTIONS.find(item => item.id === 'ask')!;
  assert.ok(section.rows.some(item => item.row === row));
  assert.ok(section.rows.some(item => item.row === SETTINGS_ROWS.find(other => other.id === 'localUnderstanding')));
});

test('app: /ask with no request opens the greeting; Esc leaves no transcript noise', async () => {
  const instance = app();
  try {
    instance['editor'].insert('/ask');
    await instance['submit']();
    assert.ok(instance['askState']);
    assert.equal(instance['askState'].turns.length, 0);
    const before = transcriptText(instance);
    instance['handleKey']({kind: 'escape'});
    assert.equal(instance['askState'], undefined);
    assert.equal(transcriptText(instance), before);
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: /ask <request> resolves at once; recorded On keeps the visible conversation', async () => {
  const instance = app(true);
  try {
    instance['editor'].insert('/ask what shell am i using');
    await instance['submit']();
    await until(() => !instance['askState']?.busy);
    assert.match(instance['askState']!.turns.at(-1)!.text, /This session runs zsh/u, 'no second Enter needed');
    instance['handleKey']({kind: 'escape'});
    const text = transcriptText(instance);
    assert.match(text, /\/ask what shell am i using/u);
    assert.match(text, /Ask: This session runs zsh/u);
    assert.doesNotMatch(text, /capability|confidence|\{"kind"/u, 'no structured or model data');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: recording Off keeps Ask out of the transcript, but an approved read command is a normal visible submission', async () => {
  const instance = app(false);
  try {
    const submitted: string[] = [];
    const realSubmit = instance['submit'].bind(instance);
    instance['submit'] = async (realShell = false, skip = false) => {
      if (instance['editor'].text.startsWith('git')) { submitted.push(instance['editor'].text); instance['editor'].clear(); return; }
      return realSubmit(realShell, skip);
    };
    instance['context'] = {...instance['context'], root: process.cwd(), branch: 'main'};
    instance['editor'].insert('/ask check git status');
    await instance['submit']();
    await until(() => !instance['askState']?.busy);
    assert.equal(instance['askState']!.pending?.kind, 'proposal');
    instance['handleKey']({kind: 'text', value: 'y'});
    await until(() => submitted.length > 0);
    assert.deepEqual(submitted, ['git status'], 'the fixed command goes through the normal submission path');
    const text = transcriptText(instance);
    assert.doesNotMatch(text, /check git status|I can show Git status/u, 'the Ask conversation is not persisted');
    assert.equal(instance['sessionSubmissions'].some((item: {text: string}) => item.text.startsWith('/ask')), false, 'not kept for recall either');
  } finally { instance['stop'](0); instance['session'].kill(); }
});

test('app: a dangerous request never executes anything', async () => {
  const instance = app(true);
  try {
    let submitted = 0;
    instance['submit'] = async () => { submitted += 1; };
    instance['openAsk']('delete all untracked files');
    await until(() => !instance['askState']?.busy);
    assert.equal(instance['askState']!.pending?.kind, 'unsafe');
    instance['handleKey']({kind: 'escape'});
    assert.equal(submitted, 0);
  } finally { instance['stop'](0); instance['session'].kill(); }
});
