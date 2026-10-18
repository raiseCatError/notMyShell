import test from 'node:test';
import assert from 'node:assert/strict';
import {pushEvent, type AgentSession} from '../src/agents/sessions/model.js';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {renderSemanticAgentView} from '../src/agents/transcript/view.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {applyPickerChoice, handleAgentInput, pickerCommand, type AgentSurfaceHost} from '../src/agents/input/surface.js';
import {openEffortPicker, openModelPicker, pickerArgument, visibleRows, type PickerRow, type PickerState} from '../src/agents/input/pickers.js';
import {parseCatalog} from '../src/agents/sessions/claudeStream.js';
import {applyTelemetry, effortStatus, emptyTelemetry, type AgentTelemetry} from '../src/agents/telemetry.js';
import type {AgentViewState} from '../src/agents/sessions/AgentViews.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

/* The model catalog exactly as Claude Code 2.1.295 published it in the recorded control probe. */
const CATALOG = parseCatalog({commands: [], agents: [], models: [
  {value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Opus 5.5 · Most capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']},
  {value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Fast and capable', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max']},
  {value: 'claude-haiku-4-5-20251001', resolvedModel: 'claude-haiku-4-5-20251001', displayName: 'Haiku 4.5', description: 'Fastest; no effort levels'},
]}, 1)!;

function telemetry(model = 'claude-opus-5-5'): AgentTelemetry {
  const t = emptyTelemetry();
  applyTelemetry(t, {kind: 'catalog', catalog: CATALOG});
  applyTelemetry(t, {kind: 'runtime', runtime: {model, tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], capabilities: [], at: 2}});
  return t;
}
function session(extra: Partial<AgentSession> = {}): AgentSession {
  const s: AgentSession = {id: 'a', harness: 'claude', level: 'managed', title: 'Picker', cwd: '/w', startedAt: 0, state: 'waiting', events: [], attention: false, updatedAt: 0,
    transcript: new AgentTranscript(), telemetry: telemetry(), ...extra};
  pushEvent(s, {kind: 'user', text: 'hello'});
  return s;
}
function view(input = ''): AgentViewState { return {sessionId: 'a', input, expanded: new Set(), scroll: 0, controller: new AgentInputController()}; }
const key = (kind: string, value = ''): Key => ({kind, value} as unknown as Key);
const type = (v: AgentViewState, s: AgentSession, host: AgentSurfaceHost, text: string) => { for (const ch of text) handleAgentInput(v, s, key('text', ch), host); };

test('/model and /effort are NMSh commands only in their exact forms; a leading space sends text to Claude verbatim', () => {
  assert.deepEqual(pickerCommand('/model'), {kind: 'model', argument: ''});
  assert.deepEqual(pickerCommand('/model sonnet'), {kind: 'model', argument: 'sonnet'});
  assert.deepEqual(pickerCommand('/effort high '), {kind: 'effort', argument: 'high'});
  for (const text of [' /model', '/models', '/model a b', '/effortless', 'model', '/model\nsonnet']) assert.equal(pickerCommand(text), undefined, JSON.stringify(text));
});

test('model picker: rows are the provider catalog; the running model is current and reported, a request is pending', () => {
  const t = telemetry('claude-sonnet-5-5');
  const opened = openModelPicker(t);
  assert.ok(opened.ok);
  assert.deepEqual(opened.picker.rows.map(row => [row.value, row.label, Boolean(row.current), Boolean(row.isDefault)]),
    [['default', 'Default (recommended)', false, true], ['sonnet', 'Sonnet 5.5', true, false], ['claude-haiku-4-5-20251001', 'Haiku 4.5', false, false]]);
  assert.equal(opened.picker.selected, 1, 'the cursor starts on the current model');
  assert.equal(opened.picker.status, 'Running Sonnet 5.5 · reported by Claude');
  applyTelemetry(t, {kind: 'requested', field: 'model', value: 'claude-haiku-4-5-20251001', at: 5});
  const pending = openModelPicker(t);
  assert.ok(pending.ok);
  assert.match(pending.picker.status, /Haiku 4\.5 requested · Claude confirms it/u);
  assert.equal(openModelPicker(emptyTelemetry()).ok, false, 'no catalog: the picker says why instead of guessing');
  assert.equal(pickerArgument(opened.picker, 'Sonnet 5.5')?.value, 'sonnet');
  assert.equal(pickerArgument(opened.picker, 'son'), undefined, 'an argument applies only on an exact match');
});

test('effort picker: only the running model\'s levels, with provenance; a model without levels has none to pick', () => {
  const t = telemetry('claude-opus-5-5');
  const opened = openEffortPicker(t, 'low');
  assert.ok(opened.ok);
  assert.deepEqual(opened.picker.rows.map(row => row.value), [null, 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(opened.picker.rows.find(row => row.current)?.value, 'low');
  assert.equal(opened.picker.status, 'Effort: low · from Claude settings');
  assert.match(opened.picker.timing, /next turn, for this session only; Claude's settings files are not changed/u);
  assert.deepEqual(effortStatus(t), {state: 'default', words: 'model default (level not reported)'}, 'nothing configured: unreported, never invented');
  applyTelemetry(t, {kind: 'requested', field: 'effort', value: 'high', at: 9});
  assert.equal(effortStatus(t, 'low').words, 'high · acknowledged by Claude', 'an acknowledged request outranks settings');
  applyTelemetry(t, {kind: 'requested', field: 'effort', value: 'max', at: 10, evidence: 'launch flag'});
  assert.equal(effortStatus(t).state, 'launch');
  const haiku = openEffortPicker(telemetry('claude-haiku-4-5-20251001'));
  assert.deepEqual(haiku, {ok: false, reason: 'Haiku 4.5 has no effort levels to choose from.'});
  assert.equal(effortStatus(telemetry('claude-haiku-4-5-20251001'), 'high').state, 'unavailable');
  const unknownModel = emptyTelemetry();
  applyTelemetry(unknownModel, {kind: 'catalog', catalog: CATALOG});
  assert.equal(openEffortPicker(unknownModel).ok, false, 'the running model is unknown: its levels are too');
});

test('keyboard: /model opens the picker; it owns the keys, filters as you type, Esc backs out in steps, Enter applies the selection', () => {
  const s = session();
  const v = view();
  const applied: PickerRow[] = [];
  const sent: string[] = [];
  const host: AgentSurfaceHost = {shellEmpty: true, send: (_id, text) => { sent.push(text); return true; }, answer: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {},
    openPicker: (target, kind) => kind === 'model' ? openModelPicker(target.telemetry) : openEffortPicker(target.telemetry),
    applyPicker: (_target, _picker, row) => { applied.push(row); }};
  type(v, s, host, '/model');
  handleAgentInput(v, s, key('enter'), host);
  const c = v.controller!;
  assert.equal(c.owner, 'PICKER');
  assert.equal(v.input, '', 'the command left the draft');
  assert.deepEqual(sent, [], 'nothing was sent to Claude');
  type(v, s, host, 'hai');
  assert.deepEqual(visibleRows(c.picker!).map(row => row.label), ['Haiku 4.5']);
  handleAgentInput(v, s, key('escape'), host);
  assert.equal(c.owner, 'PICKER', 'the first Esc clears the filter');
  assert.equal(c.picker!.query, '');
  handleAgentInput(v, s, key('down'), host);
  handleAgentInput(v, s, key('down'), host);
  handleAgentInput(v, s, key('down'), host);
  handleAgentInput(v, s, key('enter'), host);
  assert.deepEqual(applied.map(row => row.value), ['claude-haiku-4-5-20251001'], 'the selection stops at the last row');
  handleAgentInput(v, s, key('escape'), host);
  assert.equal(c.owner, 'AGENT_MESSAGE');
  assert.equal(c.picker, undefined);
  // Ordinary text and a verbatim leading-space command still go to Claude.
  type(v, s, host, ' /model');
  handleAgentInput(v, s, key('enter'), host);
  assert.deepEqual(sent, [' /model']);
  // Observed targets never open a picker; a host without the control channel explains.
  const unsupported: AgentSurfaceHost = {...host, openPicker: () => ({ok: false, reason: '/effort needs a running managed Claude target with a live control channel.'})};
  type(v, s, unsupported, '/effort');
  handleAgentInput(v, s, key('enter'), unsupported);
  assert.equal(c.owner, 'AGENT_MESSAGE');
  assert.match(v.message ?? '', /live control channel/u);
});

test('/model sonnet applies directly on an exact match; an unknown name opens the picker with a note', () => {
  const s = session();
  const v = view();
  const applied: Array<string | null> = [];
  const host: AgentSurfaceHost = {shellEmpty: true, send: () => true, answer: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {},
    openPicker: target => openModelPicker(target.telemetry), applyPicker: (_t, _p, row) => { applied.push(row.value); }};
  type(v, s, host, '/model sonnet');
  handleAgentInput(v, s, key('enter'), host);
  assert.deepEqual(applied, ['sonnet']);
  assert.notEqual(v.controller!.owner, 'PICKER');
  type(v, s, host, '/model gpt-9');
  handleAgentInput(v, s, key('enter'), host);
  assert.equal(v.controller!.owner, 'PICKER');
  assert.match(v.controller!.picker!.message ?? '', /No model named "gpt-9"/u);
});

test('apply: success closes the picker with the provider\'s acknowledgement and timing; refusal keeps it open with the reason', async () => {
  const v = view();
  const c = v.controller!;
  const opened = openModelPicker(telemetry());
  assert.ok(opened.ok);
  c.picker = opened.picker; c.owner = 'PICKER';
  const row = opened.picker.rows[1]!;
  const refused = await applyPickerChoice(v, opened.picker, row, {setModel: async () => ({ok: false, reason: 'The provider did not answer in time'}), setEffort: async () => ({ok: true, value: undefined}), render: () => {}});
  assert.equal(refused, false);
  assert.equal(c.owner, 'PICKER');
  assert.equal(opened.picker.message, 'Not changed: The provider did not answer in time');
  assert.equal(opened.picker.busy, false);
  const ok = await applyPickerChoice(v, opened.picker, row, {setModel: async model => ({ok: model === 'sonnet', value: undefined} as {ok: true; value: undefined}), setEffort: async () => ({ok: true, value: undefined}), render: () => {}});
  assert.equal(ok, true);
  assert.equal(c.owner, 'AGENT_MESSAGE');
  assert.match(v.message ?? '', /^Model → Sonnet 5\.5\. Claude acknowledged; it applies from the next model call and is confirmed when Claude reports it\.$/u);
});

test('rendering: the picker takes the composer\'s place at every width, in Safe glyphs and NO_COLOR, with words for every mark', () => {
  const s = session();
  const v = view();
  const opened = openEffortPicker(s.telemetry, 'medium');
  assert.ok(opened.ok);
  v.controller!.picker = opened.picker; v.controller!.owner = 'PICKER';
  for (const columns of [30, 50, 80, 140]) {
    for (const height of [10, 24]) {
      const rows = renderSemanticAgentView(s, v, columns, height);
      const text = rows.map(row => stripAnsi(row));
      assert.equal(rows.length, height, `${columns}x${height}`);
      assert.ok(text.every(row => displayWidth(row) <= columns), `${columns}x${height} fits`);
      assert.ok(text.some(row => row.startsWith('Effort ·')), `${columns}x${height} title`);
      assert.ok(text.some(row => /medium {2}\(current\)/u.test(row)), `${columns}x${height} current in words`);
      assert.match(text.at(-1)!, /Enter/u, 'controls stay visible');
    }
  }
  const before = process.env.NO_COLOR;
  setIconStyle('safe');
  process.env.NO_COLOR = '1';
  try {
    const rows = renderSemanticAgentView(s, v, 60, 16);
    const joined = rows.join('\n');
    assert.doesNotMatch(joined, /\u001b\[(?:38|48);/u, 'no color under NO_COLOR');
    assert.match(stripAnsi(joined), /^> medium {2}\(current\)$/mu, 'selection reads as ">" in Safe glyphs');
    assert.match(stripAnsi(joined), /Up\/Down choose/u);
    assert.doesNotMatch(stripAnsi(joined), /[›▏◆↑↓]/u);
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('header: model and effort with provenance; requested changes read as requested; effort never invented', () => {
  const s = session();
  const top = (rows: string[]) => stripAnsi(rows.find(row => stripAnsi(row).includes('Picker')) ?? '');
  const header = () => top(renderSemanticAgentView(s, view(), 100, 12));
  assert.match(header(), /Opus 5\.5$/u, 'no effort known: none shown');
  assert.match(top(renderSemanticAgentView(s, view(), 100, 12, {settingsEffort: 'low'})), /Opus 5\.5 · low effort$/u);
  applyTelemetry(s.telemetry!, {kind: 'requested', field: 'model', value: 'sonnet', at: 10});
  applyTelemetry(s.telemetry!, {kind: 'requested', field: 'effort', value: 'high', at: 10});
  assert.match(header(), /Sonnet 5\.5 \(requested\) · high effort$/u);
  applyTelemetry(s.telemetry!, {kind: 'runtime', runtime: {model: 'claude-sonnet-5-5', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], capabilities: [], at: 20}});
  assert.match(header(), /Sonnet 5\.5 · high effort$/u, 'once Claude reports the model it is no longer "requested"');
});

void ({} as PickerState);
