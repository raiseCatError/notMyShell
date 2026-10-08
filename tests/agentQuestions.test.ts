import test from 'node:test';
import assert from 'node:assert/strict';
import {claudeEvents} from '../src/agents/sessions/claudeAdapter.js';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {handleAgentInput} from '../src/agents/input/surface.js';
import {AgentInputController} from '../src/agents/input/controller.js';

const questions = [{question: 'Which color?', header: 'Color', options: [{label: 'Red', description: 'red'}, {label: 'Blue', description: 'blue'}], multiSelect: false}];
test('AskUserQuestion is a typed choice, never an approval', () => {
  const result = claudeEvents(JSON.stringify({type: 'control_request', request_id: 'q', request: {subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: {questions}, requires_user_interaction: true}}));
  assert.equal(result.events[0]?.kind, 'choice');
  assert.ok(!result.events.some(e => e.kind === 'approval'));
});
test('choice keyboard selection answers the specific question request without permission approval', () => {
  const session: AgentSession = {id: 'a', harness: 'claude', level: 'managed', title: 'a', state: 'working', startedAt: 0, updatedAt: 0, attention: false, events: []};
  pushEvent(session, {kind: 'choice', requestId: 'q', questions});
  const view = {sessionId: 'a', input: '', expanded: new Set<string>(), scroll: 0, controller: new AgentInputController()};
  let answered: unknown; let approvals = 0;
  const host = {shellEmpty: true, send: () => true, answer: () => {approvals++; return true;}, cancel: () => {}, copy: () => {}, copyReply: () => {}, choose: (_: string, id: string, answers: Record<string, string>) => {answered = {id, answers}; return true;}};
  handleAgentInput(view, session, {kind: 'focusPrevious'}, host);
  assert.equal(view.controller.owner, 'CHOICE');
  handleAgentInput(view, session, {kind: 'down'}, host);
  handleAgentInput(view, session, {kind: 'enter'}, host);
  assert.deepEqual(answered, {id: 'q', answers: {'Which color?': 'Blue'}});
  assert.equal(approvals, 0);
});

test('permission normalization retains complete requested input for deliberate human review', () => {
  const command = 'printf ' + 'long'.repeat(100);
  const event = claudeEvents(JSON.stringify({type: 'control_request', request_id: 'r', request: {subtype: 'can_use_tool', tool_name: 'Bash', input: {command}}})).events[0] as any;
  assert.equal(event.input.command, command);
});
