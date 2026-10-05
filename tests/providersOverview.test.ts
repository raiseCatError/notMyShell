import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {familyFacts, PROVIDER_FAMILIES, providerFamily, selectProvider} from '../src/providers/families.js';
import {createProvidersOverview, OVERVIEW_ROWS, overviewItems, providersOverviewKey, renderProvidersOverview, providerStateText} from '../src/providers/ProvidersOverview.js';
import {stripAnsi} from '../src/util/text.js';
import type {ProviderStatus} from '../src/providers/providers.js';

const config = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const facts = (statuses: Map<string, ProviderStatus>, installed = new Set<string>(), configuration = config()) => ({configuration, statuses, installedByNmsh: installed,
  understanding: {active: 'Built-in', detail: ['Mode: Off']}, shell: {current: 'zsh', defaultShell: 'zsh'}});

test('/providers overview lists every family inline; modern status words; selected vs active fallback', () => {
  const statuses = new Map<string, ProviderStatus>([['deja', {state: 'installed', binary: '/opt/homebrew/bin/deja', version: '1.2'}], ['atuin', {state: 'missing'}]]);
  const state = createProvidersOverview('suggestions');
  state.detecting = false;
  const text = stripAnsi(renderProvidersOverview(state, facts(statuses, new Set(['deja'])), 160).join('\n'));
  for (const family of PROVIDER_FAMILIES) assert.match(text, new RegExp(family.title, 'u'));
  assert.match(text, /▾ Suggestions\s+NMSh Native\s+● Active/u, 'the family is expanded in the same panel');
  assert.match(text, /Deja\s+Available · 1\.2/u);
  assert.match(text, /NMSh Native\s+● Active/u);
  assert.doesNotMatch(text, /\[active\]|\[preferred\]/u, 'no bracket badges');
  assert.match(text, /Local understanding\s+Built-in/u);
  assert.match(text, /Shell\s+zsh \(this session\)/u);
  assert.equal(providerStateText('external', {state: 'installed'}, false), 'Installed · found on this system');
  const withMissing = config();
  withMissing.history = 'atuin';
  const history = familyFacts(providerFamily('history')!, withMissing, statuses);
  assert.equal(history.preferred, 'atuin');
  assert.equal(history.active, 'native', 'a missing preferred provider falls back');
  assert.equal(withMissing.history, 'atuin', 'fallback never rewrites the saved preference');
  const fallback = createProvidersOverview('history');
  fallback.detecting = false;
  const shown = stripAnsi(renderProvidersOverview(fallback, facts(statuses, new Set(), withMissing), 160).join('\n'));
  assert.match(shown, /History\s+NMSh Native\s+Selected Atuin · fallback → NMSh Native/u);
  assert.match(shown, /Atuin\s+✓ Selected · fallback → NMSh Native/u);
});

test('/providers keys: inline expand, select at once, inline install confirm defaulting No, Esc collapses first', () => {
  const statuses = new Map<string, ProviderStatus>([['fzf', {state: 'installed', binary: '/x/fzf'}], ['television', {state: 'missing'}]]);
  const f = {configuration: config(), statuses};
  const state = createProvidersOverview();
  state.selected = OVERVIEW_ROWS.indexOf('picker');
  assert.equal(providersOverviewKey(state, {kind: 'enter'}, f), undefined);
  assert.equal(state.expanded, 'picker');
  const items = overviewItems(state);
  state.selected = items.findIndex(item => item.kind === 'provider' && item.id === 'fzf');
  assert.deepEqual(providersOverviewKey(state, {kind: 'enter'}, f), {kind: 'select', family: 'picker', id: 'fzf'});
  state.selected = items.findIndex(item => item.kind === 'provider' && item.id === 'television');
  providersOverviewKey(state, {kind: 'enter'}, f);
  assert.deepEqual(state.confirm, {family: 'picker', id: 'television', yes: false}, 'inline confirmation starts on No');
  assert.equal(providersOverviewKey(state, {kind: 'enter'}, f), undefined, 'Enter on No installs nothing');
  assert.deepEqual(providersOverviewKey(state, {kind: 'text', value: 'r'}, f), {kind: 'detect'});
  assert.equal(providersOverviewKey(state, {kind: 'escape'}, f), undefined, 'Esc collapses the family first');
  assert.equal(state.expanded, undefined);
  assert.deepEqual(providersOverviewKey(state, {kind: 'escape'}, f), {kind: 'close'});
  const next = selectProvider(config(), 'suggestions', 'deja')!;
  assert.equal(next.suggestions, 'deja');
  assert.equal(selectProvider(config(), 'suggestions', 'not-a-provider'), undefined);
});

test('app: /picker focuses Picker inline; selecting fzf is immediately Active; /history hands off to fzf at the composer side', async () => {
  const app = new TerminalApp();
  Object.defineProperty(app, 'render', {value: () => {}});
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 140, rows: 40})});
  try {
    app['startupPending'] = false;
    app['editor'].insert('/picker');
    await app['submit']();
    const overview = app['providersOverview']!;
    assert.equal(overview.expanded, 'picker', '/picker opens /providers focused on Picker');
    assert.equal(app['providerPanelState'], undefined, 'no nested family panel');
    app['providerStatuses'].set('fzf', {state: 'installed', binary: '/x/fzf'});
    app['selectProviderInline']('picker', 'fzf');
    assert.equal(app['promptConfiguration'].picker, 'fzf');
    const text = stripAnsi(renderProvidersOverview(overview, app['providersOverviewFacts'](), 140).join('\n'));
    assert.match(text, /Picker\s+fzf\s+● Active/u, 'the overview is factual at once');
    assert.equal(app['fzfLayout'](), 'default', 'composer Bottom: fzf query at the bottom');
    app['promptConfiguration'].composerPosition = 'top';
    assert.equal(app['fzfLayout'](), 'reverse', 'composer Top: fzf query at the top');
    app['selectProviderInline']('picker', 'native');
    assert.equal(app['promptConfiguration'].picker, 'native');
    app['providersOverview'] = undefined;
    app['openProvidersOverview']();
    app['providersOverview']!.selected = OVERVIEW_ROWS.indexOf('understanding');
    app['handleKey']({kind: 'enter'});
    assert.ok(app['understandingPanel']);
  } finally { app['stop'](0); app['session'].kill(); }
});
