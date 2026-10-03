import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {familyFacts, PROVIDER_FAMILIES, providerFamily, selectProvider} from '../src/providers/families.js';
import {createProvidersOverview, OVERVIEW_ROWS, providersOverviewKey, renderProvidersOverview, providerStateText} from '../src/providers/ProvidersOverview.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {stripAnsi} from '../src/util/text.js';
import type {ProviderStatus} from '../src/providers/providers.js';

const config = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const facts = (statuses: Map<string, ProviderStatus>, installed = new Set<string>(), configuration = config()) => ({configuration, statuses, installedByNmsh: installed,
  understanding: {active: 'Built-in', detail: ['Mode: Off']}, shell: {current: 'zsh', defaultShell: 'zsh'}});

test('/providers overview lists every family, active vs selected, factual install state, fallback', () => {
  const statuses = new Map<string, ProviderStatus>([['deja', {state: 'installed', binary: '/opt/homebrew/bin/deja', version: '1.2'}], ['atuin', {state: 'missing'}]]);
  const state = createProvidersOverview();
  state.detecting = false;
  state.selected = OVERVIEW_ROWS.indexOf('suggestions');
  const text = stripAnsi(renderProvidersOverview(state, facts(statuses, new Set(['deja'])), 160).join('\n'));
  for (const family of PROVIDER_FAMILIES) assert.match(text, new RegExp(family.title, 'u'));
  assert.match(text, /Local understanding\s+Built-in/u);
  assert.match(text, /Shell\s+zsh \(this session\)/u);
  assert.match(text, /Deja\s+Installed 1\.2 · installed by NMSh/u, 'NMSh-installed vs found is factual');
  assert.match(text, /\[active\] is in use, › is the selected row/u);
  assert.equal(providerStateText('external', {state: 'installed'}, false), 'Installed · found on this system');
  const withMissing = config();
  withMissing.history = 'atuin';
  const history = familyFacts(providerFamily('history')!, withMissing, statuses);
  assert.equal(history.preferred, 'atuin');
  assert.equal(history.active, 'native', 'a missing preferred provider falls back');
  assert.match(history.notice!, /Atuin unavailable · using/u);
  assert.equal(withMissing.history, 'atuin', 'fallback never rewrites the saved preference');
  assert.equal(familyFacts(providerFamily('history')!, withMissing, new Map()).active, 'atuin', 'while detection runs, the preference stands');
});

test('/providers keys: select, open, detect again, close; switching uses the one configuration', () => {
  const state = createProvidersOverview();
  assert.equal(providersOverviewKey(state, {kind: 'down'}), undefined);
  assert.deepEqual(providersOverviewKey(state, {kind: 'enter'}), {kind: 'open', row: OVERVIEW_ROWS[1]});
  assert.deepEqual(providersOverviewKey(state, {kind: 'text', value: 'r'}), {kind: 'detect'});
  assert.deepEqual(providersOverviewKey(state, {kind: 'escape'}), {kind: 'close'});
  const next = selectProvider(config(), 'suggestions', 'deja')!;
  assert.equal(next.suggestions, 'deja');
  assert.equal(selectProvider(config(), 'suggestions', 'not-a-provider'), undefined);
  const row = SETTINGS_ROWS.find(item => item.id === 'suggestions');
  assert.equal(row?.control, 'child', 'Settings opens the same family panel');
});

test('app: /providers opens the overview; Enter on a family opens its existing panel; Local understanding opens its setup', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 140, rows: 40})});
  try {
    app['startupPending'] = false;
    app['editor'].insert('/providers');
    await app['submit']();
    assert.ok(app['providersOverview']);
    app['providersOverview'].selected = OVERVIEW_ROWS.indexOf('suggestions');
    app['handleKey']({kind: 'enter'});
    assert.equal(app['providerPanelState']?.family, 'suggestions');
    app['providerPanelState'] = undefined;
    app['openProvidersOverview']();
    app['providersOverview'].selected = OVERVIEW_ROWS.indexOf('understanding');
    app['handleKey']({kind: 'enter'});
    assert.ok(app['understandingPanel']);
  } finally { app['stop'](0); app['session'].kill(); }
});
