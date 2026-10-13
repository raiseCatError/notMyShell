import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentInputController, agentKeyAction} from '../src/agents/input/controller.js';
import {CommandEditor} from '../src/input/CommandEditor.js';

test('composer digits/arrows have no transcript action even with a draft', () => {
  for (const key of [{kind: 'text', value: '1'}, {kind: 'up'}, {kind: 'down'}, {kind: 'left'}] as const) assert.equal(agentKeyAction(key, 'COMPOSER'), undefined);
});
test('agent message editor preserves independent text cursor and selection', () => {
  const shell = new CommandEditor(); shell.insert('git stat'); shell.selectLeft();
  const before = {text: shell.text, cursor: shell.cursorIndex, selection: shell.selection};
  const c = new AgentInputController();
  c.dispatch({kind: 'EditMessage', key: {kind: 'text', value: 'inspect parser'}});
  c.dispatch({kind: 'EditMessage', key: {kind: 'selectLeft'}});
  c.dispatch({kind: 'FocusTranscript'}, {shellEmpty: false, count: 2});
  assert.equal(c.owner, 'AGENT_MESSAGE');
  assert.deepEqual({text: shell.text, cursor: shell.cursorIndex, selection: shell.selection}, before);
  assert.equal(c.editor.text, 'inspect parser'); assert.ok(c.editor.selection);
});
test('transcript focus is explicit; arrows/depth/escape dispatch semantic actions', () => {
  const c = new AgentInputController();
  c.dispatch({kind: 'FocusTranscript'}, {shellEmpty: true, count: 3});
  assert.equal(c.owner, 'TRANSCRIPT');
  c.dispatch(agentKeyAction({kind: 'up'}, c.owner)!, {shellEmpty: true, count: 3});
  assert.equal(c.selected, 1);
  c.dispatch(agentKeyAction({kind: 'text', value: '5'}, c.owner)!);
  assert.equal(c.depth, 5);
  c.dispatch(agentKeyAction({kind: 'escape'}, c.owner)!);
  assert.equal(c.owner, 'COMPOSER');
});
test('approval owner never approves typing enter paste scrolling or numeric navigation', () => {
  const c = new AgentInputController(); c.dispatch({kind: 'FocusApproval'});
  for (const key of [{kind: 'text', value: 'A'}, {kind: 'enter'}, {kind: 'paste', value: 'A'}, {kind: 'wheelUp'}, {kind: 'text', value: '1'}] as const) assert.notEqual(agentKeyAction(key, c.owner)?.kind, 'Approve');
  assert.equal(agentKeyAction({kind: 'toggleDetails'}, c.owner)?.kind, 'Approve');
  assert.equal(agentKeyAction({kind: 'interrupt'}, c.owner)?.kind, 'Deny');
  assert.equal(agentKeyAction({kind: 'enter'}, 'CHOICE')?.kind, 'Choose');
});
