import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {handlePromptPanelKey, promptPanelControls, promptPanelOwnsKey, renderPromptPanel, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {catalogEntries, listedModules, type ModulesContext, type PackListing} from '../src/prompt/ModulesPanel.js';
import {renderStatusStrip} from '../src/status/StatusStrip.js';
import {statusStripModules, moduleShowcaseContext, buildContextLine} from '../src/prompt/prompt.js';
import {routeModule} from '../src/context/surfaceRouter.js';
import {firstPartyPacks} from '../src/context/modules.js';
import {stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';
import type {ContextFacts, ContextFact} from '../src/context/facts.js';

const key = (value: Key) => value;
function state(): PromptPanelState {
  const saved = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  return {onboarding: false, step: 'modules', selectedIndex: 0, draft: structuredClone(saved), saved};
}
const packs = (): PackListing[] => [
  ...firstPartyPacks().map(parsed => ({id: parsed.pack.id, version: parsed.pack.version, name: parsed.pack.name, description: parsed.pack.description, builtIn: true,
    state: 'bundled', license: parsed.pack.license, author: parsed.pack.provenance.author, sha256: parsed.sha256, requires: parsed.pack.requires,
    modules: parsed.pack.modules.map(module => ({id: module.id, label: module.label}))})),
  {id: 'acme.infra', version: '1.0.0', name: 'Acme infra', description: 'Acme context.', builtIn: false, state: 'enabled', license: 'MIT', author: 'Acme',
    sha256: 'a'.repeat(64), requires: ['infra.terraform'], modules: [{id: 'tf', label: 'Acme TF'}]},
];
const text = (s: PromptPanelState, columns = 120, rows = Infinity) => stripAnsi(renderPromptPanel(s, columns, [], [], rows).join('\n'));

test('Modules lists built-ins and modules in use; Catalog groups every module; hidden pack modules stay put while edited', () => {
  const s = state();
  const listed = listedModules(s).map(module => module.id);
  assert.ok(listed.includes('cwd') && listed.includes('nmsh.cloud:aws'));
  assert.ok(!listed.includes('nmsh.system:battery'), 'hidden first-party modules live in Catalog');
  handlePromptPanelKey(key({kind: 'complete'}), s);
  assert.equal(s.modulesTab, 'catalog');
  const shown = text(s);
  for (const header of ['Identity', 'Version control', 'Project', 'Runtimes', 'Cloud', 'Agents', 'System']) assert.match(shown, new RegExp(`\\n${header}\\n`, 'u'));
  const entries = catalogEntries(s).filter(entry => entry.kind === 'module');
  s.selectedIndex = entries.findIndex(entry => entry.kind === 'module' && entry.module.id === 'nmsh.system:battery');
  handlePromptPanelKey(key({kind: 'text', value: ' '}), s);
  assert.equal(s.draft.modules.find(module => module.id === 'nmsh.system:battery')!.visible, true);
  handlePromptPanelKey(key({kind: 'focusPrevious'}), s);
  assert.equal(s.modulesTab, 'modules');
  const index = listedModules(s).findIndex(module => module.id === 'nmsh.system:battery');
  assert.ok(index >= 0, 'turned-on modules join the prompt order');
  s.selectedIndex = index;
  handlePromptPanelKey(key({kind: 'text', value: ' '}), s);
  assert.ok(listedModules(s).some(module => module.id === 'nmsh.system:battery'), 'hiding it does not make the row vanish under the cursor');
});

test('details disclose what a module reads, its history policy and live status; Esc returns', () => {
  const s = state();
  s.context = {status: id => id === 'cloud.aws' ? {state: 'fresh', collectedAt: 1000, evidence: 'AWS_PROFILE, AWS config'} : {state: 'idle'}, now: 6000, packs: packs()};
  s.selectedIndex = listedModules(s).findIndex(module => module.id === 'nmsh.cloud:aws');
  assert.ok(promptPanelOwnsKey(s, key({kind: 'enter'})), 'Enter opens details in the module manager');
  handlePromptPanelKey(key({kind: 'enter'}), s);
  const shown = text(s, 160);
  assert.match(shown, /AWS {2}Cloud · Cloud · bundled/u);
  assert.match(shown, /On commands +aws, sam, cdk/u);
  assert.match(shown, /Reads\n.*AWS_VAULT, AWS_PROFILE/u);
  assert.match(shown, /never the client address|never values|credential presence/u);
  assert.match(shown, /History +may be kept with commands when shown in the Main Prompt \(never: account, expiresAt\)/u);
  assert.match(shown, /AWS profile +fresh · 5s ago · AWS_PROFILE, AWS config/u);
  assert.ok(promptPanelOwnsKey(s, key({kind: 'escape'})));
  handlePromptPanelKey(key({kind: 'escape'}), s);
  assert.equal(s.detail, undefined);
  s.selectedIndex = listedModules(s).findIndex(module => module.id === 'nmsh.agents:claude');
  handlePromptPanelKey(key({kind: 'enter'}), s);
  assert.match(text(s, 160), /History +live only; never kept in command history/u);
  assert.match(text(s, 160), /Claude Code +not reporting yet · B to review the one settings change/u);
  assert.ok(promptPanelControls(s).some(([name]) => name === 'B'));
  handlePromptPanelKey(key({kind: 'text', value: 'b'}), s);
  assert.deepEqual(s.request, {kind: 'claudeBridgeReview'}, 'the frontend prepares the reviewed edit');
});

test('a reviewed change applies only on Enter; Esc keeps everything', () => {
  const s = state();
  s.confirm = {request: {kind: 'claudeBridgeApply'}, title: 'Let Claude Code report to NMSh?', lines: ['~/.claude/settings.json — adds statusLine', '+   "statusLine": {…}']};
  assert.match(text(s), /Let Claude Code report to NMSh\?[\s\S]*\+ +"statusLine"/u);
  handlePromptPanelKey(key({kind: 'escape'}), s);
  assert.equal(s.request, undefined);
  assert.equal(s.message, 'Nothing was changed.');
  s.confirm = {request: {kind: 'claudeBridgeApply'}, title: 'x', lines: []};
  handlePromptPanelKey(key({kind: 'enter'}), s);
  assert.deepEqual(s.request, {kind: 'claudeBridgeApply'});
});

test('Packs tab: recommendations with evidence, bundled and installed packs, explicit enable and removal', () => {
  const s = state();
  s.draft.modules = s.draft.modules.map(module => module.id === 'nmsh.infrastructure:terraform' ? {...module, visible: false} : module);
  const context: ModulesContext = {packs: packs(), recommendations: [{module: 'nmsh.infrastructure:terraform', pack: 'Infrastructure', label: 'Terraform', reasons: ['main.tf in this project']}]};
  s.context = context;
  s.modulesTab = 'packs';
  const shown = text(s);
  assert.match(shown, /Recommended here\n.*○ Terraform +main\.tf in this project/u);
  assert.match(shown, /Bundled with NMSh\n.*Project & runtimes +nmsh\.project 1\.0\.0 · bundled · 6 modules/u);
  assert.match(shown, /Installed\n.*Acme infra +acme\.infra 1\.0\.0 · enabled · 1 modules/u);
  handlePromptPanelKey(key({kind: 'text', value: ' '}), s);
  assert.equal(s.draft.modules.find(module => module.id === 'nmsh.infrastructure:terraform')!.visible, true, 'only an explicit Space turns a recommendation on');
  s.selectedIndex = 1 + packs().length - 1;
  handlePromptPanelKey(key({kind: 'enter'}), s);
  assert.deepEqual(s.detail, {kind: 'pack', id: 'acme.infra'});
  assert.match(text(s, 140), /sha256 a{64}[\s\S]*A Context Pack is data/u);
  handlePromptPanelKey(key({kind: 'text', value: 'e'}), s);
  assert.deepEqual(s.request, {kind: 'packEnabled', id: 'acme.infra', enabled: false});
  s.request = undefined;
  handlePromptPanelKey(key({kind: 'text', value: 'd'}), s);
  assert.match(s.confirm!.title, /Remove Acme infra/u);
  handlePromptPanelKey(key({kind: 'enter'}), s);
  assert.deepEqual(s.request, {kind: 'packRemove', id: 'acme.infra'});
});

test('long lists are windowed around the selection', () => {
  const s = state();
  s.modulesTab = 'catalog';
  s.selectedIndex = 30;
  const shown = text(s, 120, 30);
  assert.ok(shown.split('\n').length <= 32, `${shown.split('\n').length} rows`);
  assert.match(shown, /↑ \d+ more/u);
  assert.match(shown.split('\n').find(row => row.startsWith('›')) ?? '', /\S/u, 'the selection stays visible');
});

test('Status Strip routing: only supported modules may choose it; routed modules render as strip items, not prompt segments', () => {
  const config = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), statusStrip: {enabled: true, clock: true, battery: false},
    modules: [{id: 'gitBranch', visible: true, condition: 'always', surface: 'statusStrip'}, {id: 'nmsh.agents:claude-limits', visible: true, condition: 'always', surface: 'statusStrip'}]});
  assert.equal(config.modules.find(module => module.id === 'gitBranch')!.surface, undefined, 'Git branch cannot present in the strip: no dead choice');
  assert.equal(routeModule(config.modules.find(module => module.id === 'nmsh.agents:claude-limits')!), 'statusStrip');
  const facts = {'agent.claude': {value: {fiveHourPercent: 95, fiveHourResetsAt: Date.UTC(2030, 0, 1)}, source: {capability: 'agent.claude', evidence: 'x'},
    collectedAt: 1, freshness: 'fresh', trust: 'session', sensitivity: 'public', persistence: 'display-only', resolution: 'bounded-async'} as ContextFact<unknown>} as ContextFacts;
  const items = statusStripModules({cwd: '/w', project: 'w', facts, now: Date.UTC(2029, 0, 1)}, config);
  assert.deepEqual(items.map(item => [item.text, item.role]), [['5H 95%', 'failure']]);
  assert.ok(!stripAnsi(buildContextLine({cwd: '/w', project: 'w', facts}, 120, config)).includes('5H'), 'not duplicated in the prompt');
  const strip = stripAnsi(renderStatusStrip(config.statusStrip, {}, 60, new Date(2026, 0, 1, 9, 41), undefined, items.map(item => ({text: item.text, failure: true, priority: 86}))));
  assert.match(strip, /5H 95% · .*09:41/u);
  const narrow = stripAnsi(renderStatusStrip(config.statusStrip, {}, 30, new Date(2026, 0, 1, 9, 41), undefined, [{text: '5H 95%', priority: 86}]));
  assert.match(narrow, /5H 95%/u, 'routed context outlasts the clock on narrow strips');
  assert.deepEqual(statusStripModules({cwd: '/w', project: 'w', facts}, {...config, statusStrip: {...config.statusStrip, enabled: false}}), [], 'strip Off shows and demands nothing');
});

test('the showcase previews every enabled pack module from synthetic facts, deterministically', () => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.modules = config.modules.map(module => module.id === 'nmsh.project:node' ? {...module, visible: true, surface: 'mainPrompt', condition: 'always'} : module);
  const first = buildContextLine(moduleShowcaseContext('/home/cat'), 200, config);
  assert.match(stripAnsi(first), /22\.11\.0/u);
  assert.equal(buildContextLine(moduleShowcaseContext('/home/cat'), 200, config), first);
});
