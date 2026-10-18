import test from 'node:test';
import assert from 'node:assert/strict';
import type {InputRequest} from '../src/session/inputState.js';
import {executionFrameFixture} from './support/executionTimelineFrames.js';

/**
 * #436: typing right after Ctrl+C is type-ahead for the prompt the stop brings back. Under load the session's report
 * of the question Ctrl+C ended can reach the frontend after the stop; it used to mark what was typed after the stop
 * as a reply, and the prompt then discarded it, so the rest of the line ran truncated (`cho Y >> …`, exit 127, seen
 * live at load ~30). A question that began before the stop is the one the stop ended: it changes nothing.
 * Deterministic: the session's late report is replayed in the order the live log recorded. No shell is started.
 */

function fixture() {
  const frame = executionFrameFixture(100, 30);
  const written: string[] = [];
  const submitted: string[] = [];
  Object.defineProperty(frame.session, 'write', {value: (data: string) => { written.push(data); }, configurable: true});
  Object.defineProperty(frame.app, 'submit', {value: async () => { submitted.push(frame.app['editor'].text); frame.app['editor'].clear(); }, configurable: true});
  const state = (request?: InputRequest) => frame.session.emit('inputState', {...(request ? {request} : {}), timing: {waitedMs: 0, waits: 0}});
  const type = (text: string) => { for (const char of text) frame.app['onInput'](char); };
  const transcript = () => (frame.app['output'].transcript().lines as Array<Array<{text?: string} | null>>)
    .map(line => line.map(cell => cell?.text ?? ' ').join('')).join('\n');
  return {...frame, written, submitted, state, type, transcript, text: () => frame.app['editor'].text as string};
}

test('#436: the report of the question Ctrl+C ended, arriving late, never turns type-ahead into a discarded reply', () => {
  const f = fixture();
  try {
    f.begin('read -r reply');
    const asked = Date.now();
    f.state({since: asked, confidence: 'likely', mode: 'line'});
    f.tick(200);
    f.app['onInput']('\u0003');
    f.tick(20);
    f.type('echo Y');
    // The session sampled the read before it saw the interrupt; its report and then the closing one arrive now.
    f.state({since: asked, confidence: 'likely', mode: 'line'});
    f.state();
    f.tick(20);
    f.complete(130);
    assert.equal(f.text(), 'echo Y', 'what was typed after Ctrl+C is still the draft at the prompt');
    assert.doesNotMatch(f.transcript(), /reply was discarded/u);
    f.type(' >> once');
    f.app['onInput']('\r');
    assert.deepEqual(f.submitted, ['echo Y >> once'], 'the whole line runs, once');
    assert.deepEqual(f.written, [], 'nothing reached the interrupted program');
  } finally { f.dispose(); }
});

test('#436: a stale hidden report after Ctrl+C does not route type-ahead to the program; a new question does', () => {
  const f = fixture();
  try {
    f.begin('read -s secret');
    const asked = Date.now();
    f.state({since: asked, confidence: 'confirmed', mode: 'hidden'});
    f.tick(200);
    f.app['onInput']('\u0003');
    f.tick(20);
    f.state({since: asked, confidence: 'confirmed', mode: 'hidden'});
    f.type('ls');
    assert.equal(f.text(), 'ls', 'type-ahead for the prompt stays in the composer');
    assert.deepEqual(f.written, []);
    // A program that survived the interrupt and asks again: that question is new, and keys are its own.
    f.tick(50);
    f.state({since: Date.now(), confidence: 'confirmed', mode: 'hidden'});
    f.type('x');
    assert.deepEqual(f.written, ['x'], 'keys typed for the new question are its own');
    assert.equal(f.text(), 'ls', 'what was typed before it began stays the draft');
  } finally { f.dispose(); }
});
