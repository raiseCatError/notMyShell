/**
 * Live validation of NMSh's /model and /effort pickers against a real Claude Code, through NMSh's own managed-session
 * code (AgentSessions → ClaudeSession → the documented control requests) and the picker logic the UI uses.
 *
 * Isolation: `claude` resolves to a wrapper that adds --safe-mode (no plugins, hooks or mods of the account run),
 * --setting-sources '' and --no-session-persistence; the work directory is a fresh temp folder. Only session-scoped
 * controls are exercised (set_model, apply_flag_settings), so no settings are written; the account's settings.json is
 * hashed before and after to prove it. Prints shapes and outcomes only, never account identity values.
 *
 * NMSH_PROBE_CONFIG_DIR=<a logged-in Claude config directory> node --import=tsx scripts/probes/managed-pickers-live.ts
 */
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentSessions} from '../../src/agents/sessions/manager.js';
import {openEffortPicker, openModelPicker} from '../../src/agents/input/pickers.js';
import {applyPickerChoice} from '../../src/agents/input/surface.js';
import {AgentInputController} from '../../src/agents/input/controller.js';
import {currentModel, effortStatus} from '../../src/agents/telemetry.js';
import type {AgentViewState} from '../../src/agents/sessions/AgentViews.js';

const real = process.env.NMSH_PROBE_CLAUDE ?? join(homedir(), '.local/bin/claude');
const configDir = process.env.NMSH_PROBE_CONFIG_DIR;
if (!configDir || !existsSync(join(configDir, 'settings.json'))) throw new Error('Set NMSH_PROBE_CONFIG_DIR to a logged-in Claude config directory');
const hash = () => createHash('sha256').update(readFileSync(join(configDir, 'settings.json'))).digest('hex');
const before = hash();
const root = mkdtempSync(join(tmpdir(), 'nmsh-pickers-'));
const wrapper = join(root, 'claude');
writeFileSync(wrapper, `#!/bin/sh\nexec ${JSON.stringify(real)} "$@" --safe-mode --setting-sources '' --no-session-persistence --max-budget-usd 0.5\n`);
chmodSync(wrapper, 0o755);
const help = spawnSync(real, ['--help'], {encoding: 'utf8', timeout: 10000}).stdout;
const note = (step: string, value: unknown) => console.log(JSON.stringify({step, ...value as object}));
const until = async (what: string, check: () => boolean, ms = 120000) => {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise(resolve => setTimeout(resolve, 100)); }
};

const sessions = new AgentSessions({resolve: name => name === 'claude' ? wrapper : undefined, scan: async () => [], now: () => Date.now(), claudeHelp: help});
let failures = 0;
const check = (name: string, ok: boolean, detail: unknown = {}) => { if (!ok) failures++; note(name, {ok, detail}); };
try {
  const launched = sessions.launch('claude', root, {profile: {name: 'probe', harness: 'claude', configDir, model: 'haiku', effort: 'low'}});
  if (!launched.ok) throw new Error(launched.reason);
  const session = launched.session;
  await until('catalog', () => Boolean(session.telemetry?.catalog));
  const view: AgentViewState = {sessionId: session.id, input: '', expanded: new Set(), scroll: 0, controller: new AgentInputController()};
  const ops = {setModel: (model: string | undefined) => sessions.setModel(session.id, model), setEffort: (level: string | null) => sessions.setEffort(session.id, level), render: () => {}};

  const catalog = openModelPicker(session.telemetry);
  check('model picker opens from the real catalog', catalog.ok, catalog.ok ? {rows: catalog.picker.rows.map(row => `${row.value}${row.current ? '*' : ''}`), status: catalog.picker.status} : catalog);
  check('launch effort is labelled as a launch flag', effortStatus(session.telemetry).state === 'launch', effortStatus(session.telemetry));

  const turn = async (text: string) => {
    const settled = session.events.filter(event => event.kind === 'settled').length;
    sessions.send(session.id, text);
    await until('turn', () => session.events.filter(event => event.kind === 'settled').length > settled);
  };
  await turn('Reply with exactly one word: alpha');
  check('first turn reports the launch model', /haiku/u.test(session.telemetry?.runtime?.model ?? ''), {model: session.telemetry?.runtime?.model});

  // /model → Sonnet through the picker, as Enter does.
  const picker = openModelPicker(session.telemetry);
  const sonnet = picker.ok ? picker.picker.rows.find(row => row.value === 'sonnet') : undefined;
  check('the catalog offers sonnet', Boolean(sonnet));
  if (picker.ok && sonnet) {
    view.controller!.picker = picker.picker; view.controller!.owner = 'PICKER';
    const applied = await applyPickerChoice(view, picker.picker, sonnet, ops);
    check('set_model acknowledged; the picker closes', applied && view.controller!.owner === 'AGENT_MESSAGE', {message: view.message});
    check('the model reads as requested until Claude reports it', currentModel(session.telemetry!)?.source === 'requested', currentModel(session.telemetry!));
  }

  // /effort → high for the requested model's own levels.
  const effort = openEffortPicker(session.telemetry);
  check('effort picker lists the requested model\'s levels', effort.ok, effort.ok ? {rows: effort.picker.rows.map(row => `${row.value ?? 'default'}${row.current ? '*' : ''}`), status: effort.picker.status} : effort);
  const high = effort.ok ? effort.picker.rows.find(row => row.value === 'high') : undefined;
  if (effort.ok && high) {
    const applied = await applyPickerChoice(view, effort.picker, high, ops);
    check('apply_flag_settings acknowledged', applied, {message: view.message});
    check('effort reads as acknowledged, not confirmed', effortStatus(session.telemetry).state === 'acknowledged', effortStatus(session.telemetry));
  }

  await turn('Reply with exactly one word: beta');
  check('the next turn reports the new model', /sonnet/u.test(session.telemetry?.runtime?.model ?? ''), {model: session.telemetry?.runtime?.model});
  check('the model is now reported by Claude, not requested', currentModel(session.telemetry!)?.source === 'provider', currentModel(session.telemetry!));
  const reopened = openModelPicker(session.telemetry);
  check('the picker marks the new model current', reopened.ok && reopened.picker.rows.find(row => row.current)?.value === 'sonnet', reopened.ok ? reopened.picker.status : reopened);

  // A refusal stays visible and claims nothing.
  const refused = await sessions.setModel(session.id, 'not-a-real-model-xyz');
  note('set_model with an unknown model', {result: refused});
  const replies = session.events.filter(event => event.kind === 'assistant').map(event => (event as {text: string}).text.trim().slice(0, 20));
  note('replies', {replies, controls: session.events.filter(event => event.kind === 'control').map(event => (event as {label: string}).label)});
} finally {
  sessions.dispose();
  await new Promise(resolve => setTimeout(resolve, 1500));
  check('account settings.json unchanged', hash() === before);
  rmSync(root, {recursive: true, force: true});
  console.log(JSON.stringify({failures}));
  process.exit(failures ? 1 : 0);
}
