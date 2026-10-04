import test from 'node:test';
import assert from 'node:assert/strict';
import {brewMutationAllowed, parseBrewInfo, parseOutdatedAll} from '../src/packages/homebrew.js';
import {packageIntent, packageQueries, resolvePackage, type BrewFacts} from '../src/ask/packages.js';
import {createAskState, receiveOutcome, askKey} from '../src/ask/AskPanel.js';
import type {AskContext, AskOutcome} from '../src/ask/types.js';

const formula = (name: string, extra: Record<string, unknown> = {}) => ({name, desc: `${name} tool`, homepage: `https://example.org/${name}`, versions: {stable: '2.0'}, installed: [], dependencies: [], outdated: false, ...extra});
const infoJson = (formulae: unknown[], casks: unknown[] = []) => JSON.stringify({formulae, casks});
const context = (brew: BrewFacts) => ({cwd: '/r', home: '/h', brew} as unknown as AskContext);
const ask = (text: string, brew: BrewFacts) => resolvePackage(text, context(brew));
const proposal = (outcome: AskOutcome | undefined) => outcome?.kind === 'proposal' && outcome.action.kind === 'brew' ? outcome.action.argv.join(' ') : undefined;

test('parsers: validated JSON; malformed or hostile entries are ignored (fail closed)', () => {
  const parsed = parseBrewInfo(infoJson([formula('jq', {installed: [{version: '1.7.1'}], dependencies: ['oniguruma'], outdated: true})], [{token: 'iterm2', desc: 'Terminal', version: '3.5', installed: null}]));
  assert.deepEqual(parsed.map(item => [item.name, item.kind, item.installed, item.dependencies, item.outdated]), [['jq', 'formula', ['1.7.1'], ['oniguruma'], true], ['iterm2', 'cask', [], [], false]]);
  assert.deepEqual(parseBrewInfo('not json'), []);
  assert.deepEqual(parseBrewInfo(infoJson([formula('bad; rm -rf /')])), []);
  assert.deepEqual(parseOutdatedAll(JSON.stringify({formulae: [{name: 'rg', installed_versions: ['14.0'], current_version: '15.0'}], casks: [{name: 'zed', installed_versions: ['1'], current_version: '2'}]})),
    [{name: 'rg', installed: '14.0', current: '15.0', kind: 'formula'}, {name: 'zed', installed: '1', current: '2', kind: 'cask'}]);
  assert.deepEqual(parseOutdatedAll('{oops'), []);
});

test('intents: package language is recognized; shells stay with /shell', () => {
  assert.deepEqual(packageIntent('what is outdated'), {kind: 'outdated'});
  assert.deepEqual(packageIntent('show installed brew packages'), {kind: 'list'});
  assert.deepEqual(packageIntent('is ripgrep installed with brew'), {kind: 'installed', name: 'ripgrep'});
  assert.deepEqual(packageIntent('what version of jq do i have'), {kind: 'installed', name: 'jq'});
  assert.deepEqual(packageIntent('search brew for vhs'), {kind: 'search', query: 'vhs'});
  assert.deepEqual(packageIntent('info about jq'), {kind: 'info', name: 'jq'});
  assert.deepEqual(packageIntent('what depends on oniguruma'), {kind: 'uses', name: 'oniguruma'});
  assert.deepEqual(packageIntent('what does jq depend on'), {kind: 'deps', name: 'jq'});
  assert.deepEqual(packageIntent('where is jq installed'), {kind: 'where', name: 'jq'});
  assert.deepEqual(packageIntent('install vhs'), {kind: 'install', name: 'vhs'});
  assert.deepEqual(packageIntent('upgrade ripgrep'), {kind: 'upgrade', name: 'ripgrep'});
  assert.deepEqual(packageIntent('uninstall jq'), {kind: 'uninstall', name: 'jq'});
  assert.equal(packageIntent('install fish'), undefined);
  assert.equal(packageIntent('install vhs; rm -rf ~'), undefined, 'no free-text arguments');
  assert.deepEqual(packageQueries({kind: 'install', name: 'vhs'}), {installed: true, outdated: false, info: ['vhs'], search: ['vhs'], uses: [], prefix: []});
});

test('install: exact command, Yes/No starting on No; formula vs cask asks; installed or elsewhere is said', () => {
  const vhs = parseBrewInfo(infoJson([formula('vhs', {desc: 'Your CLI home video recorder'})]));
  const outcome = ask('install vhs', {available: true, installed: {formulae: [], casks: []}, info: {vhs}, search: {}, identity: {vhs: {owner: 'unknown'}}});
  assert.equal(proposal(outcome), 'brew install vhs');
  const state = createAskState();
  receiveOutcome(state, outcome!);
  assert.equal(state.confirm, 'no', 'installs start on No');
  assert.equal(askKey(state, {kind: 'enter'}), undefined, 'Enter on No runs nothing');
  const both = parseBrewInfo(infoJson([formula('docker')], [{token: 'docker', desc: 'Docker Desktop', version: '4'}]));
  const choice = ask('install docker', {available: true, installed: {formulae: [], casks: []}, info: {docker: both}, search: {}, identity: {}});
  assert.equal(choice?.kind, 'choose');
  assert.deepEqual(choice?.kind === 'choose' && choice.options.map(option => proposal(option.outcome)), ['brew install docker', 'brew install --cask docker']);
  assert.match((ask('install jq', {available: true, installed: {formulae: ['jq'], casks: []}, info: {jq: parseBrewInfo(infoJson([formula('jq', {installed: [{version: '1.7'}]})]))}, identity: {}}) as {text: string}).text, /already installed/u);
  assert.match((ask('install rg', {available: true, installed: {formulae: [], casks: []}, info: {rg: []}, search: {}, identity: {rg: {path: '/usr/bin/rg', owner: 'unknown'}}}) as {text: string}).text, /already on PATH at \/usr\/bin\/rg \(not from Homebrew\)/u);
});

test('upgrade/uninstall: only Homebrew-owned; outdated shown; dependents named; allowlist', () => {
  const owned = {formulae: ['ripgrep'], casks: []};
  const outdatedInfo = parseBrewInfo(infoJson([formula('ripgrep', {installed: [{version: '14.0'}], versions: {stable: '15.0'}, outdated: true})]));
  assert.equal(proposal(ask('upgrade ripgrep', {available: true, installed: owned, info: {ripgrep: outdatedInfo}, identity: {}})), 'brew upgrade ripgrep');
  const elsewhere = ask('upgrade foo', {available: true, installed: {formulae: [], casks: []}, info: {foo: []}, identity: {foo: {path: '/usr/local/bin/foo', owner: 'unknown'}}});
  assert.match((elsewhere as {text: string}).text, /wasn't installed by Homebrew, so NMSh can't safely upgrade it/u);
  const uninstall = ask('uninstall ripgrep', {available: true, installed: owned, info: {ripgrep: outdatedInfo}, uses: {ripgrep: ['fzf-tab']}, identity: {}});
  assert.equal(proposal(uninstall), 'brew uninstall ripgrep');
  assert.match((uninstall as {text: string}).text, /depend on it: fzf-tab/u);
  const outdated = ask('what is outdated', {available: true, installed: owned, outdated: [{name: 'ripgrep', installed: '14.0', current: '15.0', kind: 'formula'}], identity: {}});
  assert.match((outdated as {text: string}).text, /1 Homebrew package has an update available:\n {2}ripgrep {2}14\.0 → 15\.0/u);
  assert.ok(brewMutationAllowed(['brew', 'install', '--cask', 'zed']));
  for (const argv of [['brew', 'install', '--HEAD', 'x'], ['brew', 'tap', 'x/y'], ['brew', 'install', 'a', 'b'], ['brew', 'uninstall', '--force', 'x'], ['sh', '-c', 'x']]) assert.ok(!brewMutationAllowed(argv), argv.join(' '));
  assert.match((ask('what is outdated', {available: false}) as {text: string}).text, /Homebrew is not installed here/u);
});
