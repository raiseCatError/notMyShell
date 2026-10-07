import test from 'node:test';
import assert from 'node:assert/strict';
import {ModsController, modsKeyAction} from '../src/agents/mods/controller.js';
import {claudeInventory} from '../src/agents/mods/claudeDiscovery.js';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {handleAgentInput} from '../src/agents/input/surface.js';
import {renderSemanticAgentView} from '../src/agents/transcript/view.js';
import {ClaudeSession} from '../src/agents/sessions/claudeAdapter.js';

const target = (): AgentSession => ({id: 'a', harness: 'claude', level: 'managed', title: 'a', state: 'working', startedAt: 0, updatedAt: 0, attention: false, events: []});
test('Enter opens searched mod details without dropping the filter', () => {
  const c = new ModsController(); c.setInventory(claudeInventory([{id: 'alpha', scope: 'user'}, {id: 'beta', scope: 'user'}], '/p'));
  c.dispatch({kind: 'Search'}); c.dispatch({kind: 'TypeSearch', text: 'beta'});
  const action = modsKeyAction({kind: 'enter'}, c.owner); assert.ok(action); c.dispatch(action);
  assert.equal(c.owner, 'PANEL'); assert.equal(c.rows[0]!.id, 'beta'); assert.equal(c.details, true);
});
test('settlement invalidates approvals and questions', () => {
  const t = target(); pushEvent(t, {kind: 'approval', requestId: 'old', tool: 'Edit'});
  pushEvent(t, {kind: 'settled', ok: false}); assert.equal(t.pendingApproval, undefined);
});
test('presentation cache remains bounded for hostile near-limit inputs', () => {
  const t = target();
  for (let i = 0; i < 300; i++) pushEvent(t, {kind: 'tool', id: `${i}`, name: 'Edit', status: 'started', input: {content: 'x'.repeat(100000)}});
  assert.ok(Buffer.byteLength(JSON.stringify(t.events)) < 1024 * 1024);
});
test('full semantic source reconstruction includes approval input, choice options and answers', () => {
  const t = new AgentTranscript();
  try {
    const full = 'long'.repeat(2000);
    t.append({kind: 'approval', requestId: 'r', tool: 'Bash', input: {command: full}});
    t.append({kind: 'choice', requestId: 'q', questions: [{question: 'Q', header: '', options: [{label: 'a', description: full}, {label: 'b', description: ''}], multiSelect: false}]});
    t.append({kind: 'choiceAnswered', requestId: 'q', answers: {Q: full}});
    for (let i = 0; i < 3; i++) assert.ok(JSON.stringify(t.load(i)).includes(full));
  } finally {t.dispose();}
});
test('choice reentry cannot reuse another requests draft or toggles; long UI retains controls', () => {
  const t = target(); const c = new AgentInputController();
  const view = {sessionId: 'a', input: '', expanded: new Set<string>(), scroll: 0, controller: c};
  const host = {shellEmpty: true, send: () => true, answer: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {}};
  c.choiceEditor.insert('old answer'); c.choiceToggled.add('old option');
  pushEvent(t, {kind: 'choice', requestId: 'new', questions: [{question: 'Long question '.repeat(100), header: 'Q', options: [{label: 'a'.repeat(1000), description: 'description '.repeat(100)}, {label: 'b', description: ''}], multiSelect: true}]});
  handleAgentInput(view, t, {kind: 'focusPrevious'}, host);
  assert.equal(c.choiceEditor.text, ''); assert.equal(c.choiceToggled.size, 0);
  const rendered = renderSemanticAgentView(t, view, 30, 20).join('\n');
  assert.match(rendered, /Enter answer/u); assert.match(rendered, /Other:/u);
});

function blockedAdapter() {
  const events: unknown[] = [];
  const adapter = new ClaudeSession({executable: 'fixture', cwd: '/tmp', onEvent: e => events.push(e)}, '');
  const internals = adapter as any;
  internals.child = {stdin: {write: () => false, end: () => {}}, kill: () => {}};
  internals.initialized = true; internals.writable = false;
  return {adapter, internals, events};
}

test('saturated writes reject messages and retain unsubmitted permission requests', () => {
  const {adapter, internals} = blockedAdapter();
  internals.queue = Array(128).fill('queued\n');
  assert.equal(adapter.send('must remain in draft'), false);
  internals.pending.set('r', {input: {command: 'printf harmless'}});
  assert.equal(adapter.answer('r', true), false);
  assert.ok(internals.pending.has('r'));
});

test('rejected initialization cannot accept stranded future messages', () => {
  const {adapter, internals} = blockedAdapter();
  internals.initialized = false; internals.initializeId = 'init';
  internals.read(JSON.stringify({type: 'control_response', response: {subtype: 'error', request_id: 'init'}}) + '\n');
  assert.equal(adapter.send('stranded'), false);
});

test('rejected question response retains the final answer for deliberate retry', () => {
  const t = target(); const c = new AgentInputController();
  const view = {sessionId: 'a', input: '', expanded: new Set<string>(), scroll: 0, controller: c};
  const host = {shellEmpty: true, send: () => true, answer: () => false, choose: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {}};
  pushEvent(t, {kind: 'choice', requestId: 'q', questions: [{question: 'Q', header: 'Q', options: [{label: 'a', description: ''}, {label: 'b', description: ''}], multiSelect: false}]});
  handleAgentInput(view, t, {kind: 'focusPrevious'}, host); c.choiceEditor.insert('custom answer');
  handleAgentInput(view, t, {kind: 'enter'}, host);
  assert.equal(c.owner, 'CHOICE'); assert.equal(c.choiceQuestion, 0); assert.equal(c.choiceEditor.text, 'custom answer');
});

test('observed targets never open a hidden agent-message draft', () => {
  const t = {...target(), level: 'observed' as const}; const c = new AgentInputController();
  const view = {sessionId: 'a', input: '', expanded: new Set<string>(), scroll: 0, controller: c};
  const host = {shellEmpty: true, send: () => {throw new Error('observed send');}, answer: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {}};
  handleAgentInput(view, t, {kind: 'text', value: 'hidden draft'}, host);
  assert.equal(view.input, ''); assert.equal(c.editor.text, '');
  assert.equal(handleAgentInput(view, t, {kind: 'escape'}, host), true);
});
