import test from 'node:test';
import assert from 'node:assert/strict';
import {createAskState} from '../src/ask/AskPanel.js';
import type {CommandRequest} from '../src/understanding/tasks.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #432 through the real TerminalApp: Ask's own resolver first; only a request it cannot place reaches the person's
 * local model, only when command suggestions are on; the model receives the request, the shell and the OS family;
 * the suggestion is Copy/Insert only and Insert never runs it. The model is a stub; no shell is started.
 */

function fixture() {
  const frame = executionFrameFixture(120, 40);
  const app = frame.app;
  const calls: CommandRequest[] = [];
  let reply: Awaited<ReturnType<typeof app['understanding']['suggestCommand']>> = {suggestion: {command: 'find . -type f -size +100M', explanation: 'Files over 100 MB here.'}};
  app['understanding'].suggestCommand = async (request: CommandRequest) => { calls.push(request); return reply; };
  let intent: Awaited<ReturnType<typeof app['understanding']['interpretAsk']>> = undefined;
  const intents: string[] = [];
  app['understanding'].interpretAsk = async (request: {text: string}) => { intents.push(request.text); return intent; };
  app['configuration'] = {...app['configuration'], localUnderstanding: {mode: 'auto', ask: true, folding: false,
    model: {label: 'Qwen3 0.6B', runtime: 'llama.cpp', path: '/m.gguf', owned: true}}};
  const state = createAskState();
  app['askState'] = state;
  const ask = (text: string) => app['resolveAsk'](text, state);
  return {...frame, app, calls, intents, state, ask, setReply: (value: typeof reply) => { reply = value; },
    setIntent: (value: typeof intent) => { intent = value; },
    setMode: (mode: 'auto' | 'always') => { app['configuration'] = {...app['configuration'], localUnderstanding: {...app['configuration'].localUnderstanding, mode}}; },
    enable: () => { app['promptConfiguration'] = {...app['promptConfiguration'], askCommandSuggestions: 'local'}; }};
}

const VAGUE = 'flibbertigibbet the wibble';

test('off (the default): Ask never asks the model for a command', async () => {
  const f = fixture();
  try {
    assert.equal(f.app['promptConfiguration'].askCommandSuggestions, 'off');
    const outcome = await f.ask(VAGUE);
    assert.equal(outcome.kind, 'unclear');
    assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

test('on: only what Ask cannot place reaches the model, with the request, shell and OS family only', async () => {
  const f = fixture();
  try {
    f.enable();
    assert.equal((await f.ask('what shell am i using')).kind, 'answer');
    assert.deepEqual(f.calls, [], 'a request Ask answers itself never reaches the model');
    assert.equal((await f.ask('delete all my files')).kind, 'unsafe');
    assert.deepEqual(f.calls, [], 'a refusal stands; it is never routed around through the model');
    const outcome = await f.ask('convert every png here to webp');
    assert.equal(f.calls.length, 1);
    assert.deepEqual(Object.keys(f.calls[0]!).sort(), ['os', 'shell', 'text'], 'nothing else is sent: no files, environment, history or output');
    assert.equal(f.calls[0]!.text, 'convert every png here to webp');
    assert.ok(outcome.kind === 'answer' && outcome.block);
    assert.equal(outcome.block.literal, 'find . -type f -size +100M');
    assert.equal(outcome.block.run, undefined, 'never runnable from Ask');
    assert.equal(outcome.block.risk, 'read', 'labelled by NMSh');
    assert.match(outcome.block.note ?? '', /^NMSh's check: reads only\. Your local model \(Qwen3 0\.6B\) says: “Files over 100 MB here\.”/u);
  } finally { f.dispose(); }
});

test('Insert puts the suggestion in the composer, unsent; Copy never runs it either', async () => {
  const f = fixture();
  try {
    f.enable();
    const outcome = await f.ask(VAGUE);
    assert.ok(outcome.kind === 'answer' && outcome.block);
    // CaptureSession throws on submit or write: reaching the end means nothing ran.
    await f.app['handleAskEvent']({kind: 'insert', block: outcome.block});
    assert.equal(f.app['editor'].text, 'find . -type f -size +100M');
    assert.equal(f.app['askState'], undefined, 'Ask is parked; /ask reopens it');
  } finally { f.dispose(); }
});

test('no suggestion: a declined request keeps Ask\'s own answer; an unavailable model says why', async () => {
  const f = fixture();
  try {
    f.enable();
    f.setReply({suggestion: null});
    assert.equal((await f.ask(VAGUE)).kind, 'unclear', 'the model declined: nothing invented');
    f.setReply({unavailable: 'Command suggestions use your local model, and local understanding is Off. Turn it on in /llm.'});
    const outcome = await f.ask(VAGUE);
    assert.ok(outcome.kind === 'answer');
    assert.match(outcome.text, /local understanding is Off/u);
    assert.equal(outcome.block, undefined);
    assert.ok(outcome.next?.length, 'what Ask can help with is still offered');
  } finally { f.dispose(); }
});

test('a closed Ask never asks the model', async () => {
  const f = fixture();
  try {
    f.enable();
    f.app['askState'] = undefined;
    await f.ask(VAGUE);
    assert.deepEqual(f.calls, []);
  } finally { f.dispose(); }
});

/**
 * QA F04 (v0.22 physical QA, A12): with the QA model (Qwen3 0.6B) running, `/btw convert every png here to webp` showed
 * "Files · <folder>" instead of a suggestion. Reproduced with that model: Ask's own resolver called the request unclear,
 * so the intent model read it, picked files.list ({"capability":"files.list","confidence":0.99999}), and NMSh answered
 * its canonical "list files". The suggestion step only runs for what Ask cannot place, so it never ran. "rename all
 * .jpeg files to .jpg" became "Install which shell?" the same way. A shell task (changing files, or finding them by size
 * or age) is something Ask itself does not do: it says so, never hands the request to the intent model, and with
 * suggestions on asks the person's model for one command instead.
 */
const SHELL_TASKS = ['convert every png here to webp', 'resize all jpgs in this folder to 800px', 'rename all .jpeg files to .jpg',
  'find files bigger than 100mb', 'show me the biggest folders here', 'count lines of typescript in src', 'which files changed in the last day',
  'turn these heic photos into jpgs', 'find duplicate files here'];

for (const mode of ['auto', 'always'] as const) {
  test(`F04 (${mode}): a shell task reaches command suggestions, whatever capability the intent model picks`, async () => {
    const f = fixture();
    try {
      f.enable();
      f.setMode(mode);
      // What the QA model answered for the QA request.
      f.setIntent({capability: 'files.list', confidence: 0.99999, arguments: {}});
      for (const text of SHELL_TASKS) {
        const before = f.calls.length;
        const outcome = await f.ask(text);
        assert.ok(outcome.kind === 'answer' && outcome.block, `${text}: ${outcome.kind} ${'capability' in outcome ? outcome.capability : ''}`);
        assert.equal(outcome.block.literal, 'find . -type f -size +100M', text);
        assert.equal(outcome.block.run, undefined, 'never runnable from Ask');
        assert.equal(f.calls.length, before + 1, `${text}: the local model was asked for a command once`);
        assert.equal(f.calls.at(-1)!.text, text);
      }
      assert.deepEqual(f.intents, [], 'a shell task is never re-read by the intent model');
    } finally { f.dispose(); }
  });
}

test('F04: with suggestions Off, a shell task says Ask does not run it and where suggestions are; no model is asked', async () => {
  const f = fixture();
  try {
    f.setIntent({capability: 'files.list', confidence: 0.99999, arguments: {}});
    for (const text of SHELL_TASKS) {
      const outcome = await f.ask(text);
      assert.equal(outcome.kind, 'unsupported', text);
      assert.ok(outcome.kind === 'unsupported');
      assert.match(outcome.text, /Ask doesn't run shell tasks/u, text);
      assert.match(outcome.text, /Command suggestions/u, `${text}: says where suggestions are turned on`);
    }
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.intents, []);
  } finally { f.dispose(); }
});

test('F04: what Ask does itself is unchanged: archives, listing, finding by name, refusals', async () => {
  const f = fixture();
  try {
    f.enable();
    f.setIntent({capability: 'files.list', confidence: 0.99999, arguments: {}});
    const archive = await f.ask('compress the logs folder into a tarball');
    assert.ok(archive.kind === 'answer' && archive.block?.argv[0] === 'tar', 'the archive recipe still answers');
    const list = await f.ask('list files');
    assert.ok(list.kind !== 'unsupported' && 'capability' in list && list.capability === 'file.browse');
    const named = await f.ask('find files named package.json');
    assert.ok('capability' in named && named.capability === 'file.find', `find by name: ${named.kind}`);
    // NMSh's own things share these verbs: a branch, a pane, a session or a setting is never a shell task.
    for (const text of ['rename this branch to release', 'merge main into this branch', 'split the pane', 'turn off the input dividers',
      'show me the newest session', 'convert my theme to light', 'what files are in this folder']) {
      const outcome = await f.ask(text);
      assert.ok(!(outcome.kind === 'unsupported' && outcome.shellTask), `${text}: not a shell task`);
    }
    for (const mode of ['auto', 'always'] as const) {
      f.setMode(mode);
      assert.equal((await f.ask('delete all my files')).kind, 'unsafe', `${mode}: a refusal stands, whatever the intent model says`);
      assert.equal((await f.ask('rename all my files to delete them')).kind, 'unsafe', `${mode}: a destructive shell task is refused, not suggested`);
    }
    assert.deepEqual(f.calls.map(call => call.text).filter(text => !/^(?:split the pane|convert my theme to light)$/u.test(text)), [],
      'none of these reach command suggestions (except what Ask itself says it cannot do)');
  } finally { f.dispose(); }
});

test('F04: a declined suggestion says the model had no command, and Ask\'s own answer follows', async () => {
  const f = fixture();
  try {
    f.enable();
    f.setReply({suggestion: null});
    const task = await f.ask('convert every png here to webp');
    assert.equal(task.kind, 'unsupported');
    assert.ok(task.kind === 'unsupported');
    assert.match(task.text, /^Your local model \(Qwen3 0\.6B\) suggested no command for this\./u);
    const vague = await f.ask(VAGUE);
    assert.ok(vague.kind === 'unclear');
    assert.match(vague.text, /^Your local model \(Qwen3 0\.6B\) suggested no command for this\./u);
    assert.ok(vague.categories.length, 'what Ask can help with is still offered');
  } finally { f.dispose(); }
});
