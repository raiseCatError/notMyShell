import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSidePanel, sidePanelShown, sidePanelWidth} from '../src/agents/workspace/sidePanel.js';
import {applyTelemetry, emptyTelemetry} from '../src/agents/telemetry.js';
import {parseCatalog, parseContextUsage} from '../src/agents/sessions/claudeStream.js';
import {AgentInputController} from '../src/agents/input/controller.js';
import {handleAgentInput, type AgentSurfaceHost} from '../src/agents/input/surface.js';
import type {AgentSession} from '../src/agents/sessions/model.js';
import type {AgentViewState} from '../src/agents/sessions/AgentViews.js';
import {AgentTranscript} from '../src/agents/transcript/model.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const NOW = 1_000_000;
function session(): AgentSession {
  const t = emptyTelemetry();
  applyTelemetry(t, {kind: 'catalog', catalog: parseCatalog({commands: [], agents: [], models: [{value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high']}]}, 1)!});
  applyTelemetry(t, {kind: 'runtime', runtime: {model: 'claude-sonnet-5-5', permissionMode: 'acceptEdits', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], capabilities: [], at: NOW - 5000}});
  applyTelemetry(t, {kind: 'usage', at: NOW - 4000, usage: {perModel: {'claude-sonnet-5-5': {input: 1, output: 1, cacheRead: 1, cacheWrite: 1, contextWindow: 1_000_000}},
    lastTurn: {input: 6, output: 271, cacheRead: 180_000, cacheWrite: 3146, model: 'claude-sonnet-5-5'}, turns: 3, durationMs: 1, apiMs: 1, costUsd: 0.4123}});
  applyTelemetry(t, {kind: 'todos', at: NOW, todos: [{content: 'Read the parser', status: 'completed'}, {content: 'Fix routing', status: 'in_progress', activeForm: 'Fixing routing'}, {content: 'Add tests', status: 'pending'}]});
  applyTelemetry(t, {kind: 'file', path: '/w/src/commands/slashCommands.ts', action: 'read', at: NOW - 3000});
  applyTelemetry(t, {kind: 'file', path: '/w/src/app/TerminalApp.ts', action: 'edit', added: 12, removed: 3, at: NOW - 2000});
  applyTelemetry(t, {kind: 'task', at: NOW - 9000, task: {id: 'k', description: 'Find callers of isSlashInput', subagent: 'Explore', status: 'running', tokens: 5400}});
  applyTelemetry(t, {kind: 'rateLimit', type: 'five_hour', at: NOW, limit: {status: 'allowed_warning', utilization: 0.82}});
  applyTelemetry(t, {kind: 'rateLimit', type: 'seven_day', at: NOW, limit: {status: 'allowed', utilization: 0.2}});
  return {id: 'a', harness: 'claude', level: 'managed', title: 'Routing', cwd: '/w', startedAt: 0, state: 'working', events: [], attention: false, updatedAt: 0, transcript: new AgentTranscript(), telemetry: t};
}

test('panel: context with its source, model, plan, subagents, files with changes, close limits and estimated cost', () => {
  const text = renderSidePanel(session(), 40, 60, NOW).map(row => stripAnsi(row)).join('\n');
  assert.match(text, /^Context\n.+ 18%\n183k of 1M\nestimate from the last turn · now$/mu, 'an estimate says it is one, with its age');
  assert.match(text, /Model\nSonnet 5\.5\nEffort: model default\nPermissions acceptEdits/u);
  assert.match(text, /Plan 1\/3\n✓ Read the parser\n▸ Fixing routing\n· Add tests/u);
  assert.match(text, /Subagents and tasks\nExplore · Find callers of isSlashInput\n {2}9s · 5\.4k tok/u);
  assert.match(text, /Files 1 changed · 2 touched\nsrc\/app\/TerminalApp\.ts +\+12 -3\nsrc\/commands\/slashCommands\.ts +read/u);
  assert.match(text, /Usage limits\n5-hour 82%/u);
  assert.doesNotMatch(text, /7-day/u, 'a limit far from its cap stays out of the way');
  assert.match(text, /3 turns · ~\$0\.41 estimated/u);
});

test('panel: Claude\'s own breakdown replaces the estimate, with headroom to auto-compact and the largest categories', () => {
  const s = session();
  applyTelemetry(s.telemetry!, {kind: 'context', at: NOW, snapshot: parseContextUsage({categories: [{name: 'System prompt', tokens: 2356, kind: 'used'}, {name: 'Messages', tokens: 120_000, kind: 'used'}, {name: 'Free space', tokens: 800_000, kind: 'free'}],
    totalTokens: 122_356, maxTokens: 1_000_000, percentage: 12, autoCompactThreshold: 967_000, isAutoCompactEnabled: true, memoryFiles: [], mcpTools: [], agents: []}, 'summary')!});
  const text = renderSidePanel(s, 40, 60, NOW).map(row => stripAnsi(row)).join('\n');
  assert.match(text, /12%\n122k of 1M\n845k before auto-compact\nClaude's count · now\nMessages +120k\nSystem prompt +2\.4k/u);
  assert.doesNotMatch(text, /Free space/u);
});

test('panel: nothing reported means words, never 0%; every width fits; Safe glyphs and NO_COLOR stay readable', () => {
  const bare: AgentSession = {...session(), telemetry: emptyTelemetry()};
  const empty = renderSidePanel(bare, 32, 10, NOW).map(row => stripAnsi(row));
  assert.deepEqual(empty.slice(0, 3), ['Context', 'Not reported yet', '/context asks Claude']);
  assert.ok(!empty.join('\n').includes('0%'));
  for (const width of [30, 36, 46]) for (const height of [6, 20, 60]) {
    const rows = renderSidePanel(session(), width, height, NOW);
    assert.equal(rows.length, height);
    assert.ok(rows.every(row => displayWidth(stripAnsi(row)) <= width), `${width}x${height}`);
  }
  const before = process.env.NO_COLOR;
  setIconStyle('safe');
  process.env.NO_COLOR = '1';
  try {
    const rows = renderSidePanel(session(), 40, 60, NOW).join('\n');
    assert.doesNotMatch(rows, /\u001b\[(?:38|48);/u);
    const plain = stripAnsi(rows);
    assert.match(plain, /#+-+ 18%/u);
    assert.match(plain, /\[x\] Read the parser\n\[>\] Fixing routing\n\[ \] Add tests/u);
    assert.doesNotMatch(plain.replace(/ · /gu, ' - '), /[█░✓▸…→×]/u);
  } finally { setIconStyle('nerd'); if (before === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = before; }
});

test('panel placement: on by default from 120 columns, the person\'s choice wins, never below 72; width stays bounded', () => {
  assert.equal(sidePanelShown(undefined, 119), false);
  assert.equal(sidePanelShown(undefined, 120), true);
  assert.equal(sidePanelShown(false, 200), false);
  assert.equal(sidePanelShown(true, 90), true);
  assert.equal(sidePanelShown(true, 60), false);
  assert.deepEqual([80, 120, 200, 400].map(sidePanelWidth), [30, 36, 46, 46]);
});

test('/panel and /context are NMSh commands in the agent composer; nothing is sent to Claude', () => {
  const s = session();
  const v: AgentViewState = {sessionId: 'a', input: '', expanded: new Set(), scroll: 0, controller: new AgentInputController()};
  const sent: string[] = [];
  let refreshed = 0;
  const host: AgentSurfaceHost = {shellEmpty: true, send: (_id, text) => { sent.push(text); return true; }, answer: () => false, cancel: () => {}, copy: () => {}, copyReply: () => {},
    togglePanel: view => { view.panel = !view.panel; return view.panel ? 'Panel shown. /panel hides it.' : 'Panel hidden. /panel shows it.'; }, refreshContext: () => { refreshed++; }};
  const type = (text: string) => { for (const ch of text) handleAgentInput(v, s, {kind: 'text', value: ch} as Key, host); handleAgentInput(v, s, {kind: 'enter'} as Key, host); };
  type('/panel');
  assert.equal(v.panel, true);
  assert.equal(v.message, 'Panel shown. /panel hides it.');
  type('/context');
  assert.equal(refreshed, 1);
  assert.equal(v.panel, true, '/context shows the panel the breakdown appears in');
  type('/contexts please');
  assert.deepEqual(sent, ['/contexts please'], 'anything else still goes to Claude');
});
