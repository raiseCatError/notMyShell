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
  app['understanding'].interpretAsk = async () => undefined;
  app['configuration'] = {...app['configuration'], localUnderstanding: {mode: 'auto', ask: true, folding: false,
    model: {label: 'Qwen3 0.6B', runtime: 'llama.cpp', path: '/m.gguf', owned: true}}};
  const state = createAskState();
  app['askState'] = state;
  const ask = (text: string) => app['resolveAsk'](text, state);
  return {...frame, app, calls, state, ask, setReply: (value: typeof reply) => { reply = value; },
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
    assert.match(outcome.block.note ?? '', /Suggested by your local model \(Qwen3 0\.6B\)/u);
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
