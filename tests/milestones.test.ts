import test from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {effectCells, applyEffect, EffectState, MAX_PARTICLES} from '../src/motion/effects.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {normalizeTreatmentSettings} from '../src/chroma/treatment.js';
import {installUnavailableReason, providerInstall, clearProviderDetection, type ProviderDescriptor} from '../src/providers/providers.js';
import {WELCOME_PROVIDERS} from '../src/output/WelcomeProviders.js';
import {SUGGESTION_PROVIDERS} from '../src/suggestions/types.js';
import {HISTORY_PROVIDERS} from '../src/shell/historyProviders.js';
import {PICKER_PROVIDERS} from '../src/pickers/Picker.js';
import {NAVIGATION_PROVIDERS} from '../src/shell/DirectoryService.js';
import {createProviderPanel, renderProviderPanel} from '../src/providers/ProviderPanel.js';
import {toolInstall, toolInstallUnavailable, TOOLS} from '../src/tools/catalog.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const region = {kind: 'gap' as const, top: 2, height: 3};

test('confetti: parsed, bounded, multi-colored, Safe-glyph clean, and gone after its duration', () => {
  assert.deepEqual(parseSlashCommand('/effects confetti top'), {kind: 'effects', effect: 'confetti', placement: 'top'});
  const effect = {kind: 'confetti' as const, placement: 'bottom' as const, startedAt: 0, seed: 7};
  const cells = effectCells(effect, region, 80, 400, false);
  assert.ok(cells.length <= MAX_PARTICLES);
  assert.ok(cells.every(cell => cell.row >= region.top && cell.row < region.top + region.height && cell.column < 80));
  assert.ok(new Set(cells.map(cell => cell.hue)).size > 2, 'several confetti colors');
  assert.ok(effectCells(effect, region, 80, 400, true).every(cell => cell.glyph === '*'));
  assert.deepEqual(effectCells(effect, region, 80, 3000, false), []);
  const rows = applyEffect(Array(8).fill(''), effect, region, 40, 400, false, 'truecolor');
  assert.ok(rows.slice(2, 5).every(row => displayWidth(row) === 40));
  const state = new EffectState();
  assert.equal(state.trigger('confetti', 'bottom', 0, 1, normalizeTreatmentSettings({effectsOff: true})), false);
  assert.equal(state.trigger('confetti', 'bottom', 0, 1, normalizeTreatmentSettings({reducedMotion: true})), false);
});

function quietApp() {
  const app = new TerminalApp();
  Object.defineProperty(app, 'dimensions', {value: () => ({columns: 100, rows: 30})});
  Object.defineProperty(app, 'fetchSuggestions', {value: async () => {}});
  app['renderer'].render = (() => {}) as never;
  app['session'].resize = (() => {}) as never;
  app['session'].write = (() => {}) as never;
  return app;
}

test('milestone effects: restrained, opt-out, wait for panels, and never run under Reduced Motion or Effects Off', () => {
  const app = quietApp();
  try {
    app['configuration'].presentation = normalizeTreatmentSettings({autoEffects: false});
    assert.equal(app['milestoneEffect'](), false, 'Milestone effects Off');
    for (const guard of [{effectsOff: true}, {reducedMotion: true}]) {
      app['configuration'].presentation = normalizeTreatmentSettings(guard);
      assert.equal(app['milestoneEffect'](), false);
      assert.equal(app['pendingMilestone'], false, 'suppressed, not deferred');
    }
    app['configuration'].presentation = normalizeTreatmentSettings({});
    app['transcriptPanelState'] = {selectedIndex: 0, draft: structuredClone(app['configuration'].transcript), saved: structuredClone(app['configuration'].transcript)};
    assert.equal(app['milestoneEffect'](), false);
    assert.equal(app['pendingMilestone'], true, 'deferred while a panel owns the screen');
    app['transcriptPanelState'] = undefined;
    app['render']();
    assert.equal(app['effects'].active?.kind, 'confetti', 'shown once the panel closes');
    assert.equal(app['pendingMilestone'], false);
  } finally { app['stop'](0); app['session'].kill(); }
});

test('install recipes: curated Homebrew only; Linux never guesses package names; legacy and unknown providers say why', () => {
  const byId = (list: readonly ProviderDescriptor[], id: string) => list.find(provider => provider.id === id)!;
  const fastfetch = byId(WELCOME_PROVIDERS, 'fastfetch');
  assert.deepEqual(providerInstall(fastfetch, 'darwin', true), {label: 'brew install fastfetch', command: 'brew', args: ['install', 'fastfetch']});
  assert.equal(providerInstall(fastfetch, 'linux', true)?.label, 'brew install fastfetch', 'Linuxbrew when present');
  assert.equal(providerInstall(fastfetch, 'linux', false), undefined);
  assert.match(installUnavailableReason(fastfetch, 'linux', false), /does not guess distribution package names/u);
  assert.match(installUnavailableReason(fastfetch, 'darwin', false), /Homebrew is not installed/u);
  assert.equal(providerInstall(byId(WELCOME_PROVIDERS, 'macchina'), 'darwin', true)?.label, 'brew install macchina');
  assert.equal(providerInstall(byId(WELCOME_PROVIDERS, 'neofetch'), 'darwin', true), undefined);
  assert.match(installUnavailableReason(byId(WELCOME_PROVIDERS, 'neofetch')), /archived upstream/u);
  assert.equal(providerInstall(byId(WELCOME_PROVIDERS, 'zigfetch'), 'darwin', true), undefined);
  assert.match(installUnavailableReason(byId(WELCOME_PROVIDERS, 'zigfetch')), /no curated install/u);
  const deja = byId(SUGGESTION_PROVIDERS, 'deja');
  assert.equal(providerInstall(deja, 'darwin', true)?.label, 'brew install Giammarco-Ferranti/deja/deja');
  assert.equal(providerInstall(deja, 'linux', true), undefined);
  assert.match(installUnavailableReason(deja, 'linux', true), /macOS only/u);
  for (const [list, id, formula] of [[HISTORY_PROVIDERS, 'atuin', 'atuin'], [PICKER_PROVIDERS, 'fzf', 'fzf'], [PICKER_PROVIDERS, 'television', 'television'],
    [NAVIGATION_PROVIDERS, 'zoxide', 'zoxide']] as const) {
    assert.deepEqual(providerInstall(byId(list, id), 'darwin', true)?.args, ['install', formula]);
  }
  for (const install of [...WELCOME_PROVIDERS, ...SUGGESTION_PROVIDERS, ...HISTORY_PROVIDERS, ...PICKER_PROVIDERS, ...NAVIGATION_PROVIDERS]
    .map(provider => providerInstall(provider, 'darwin', true)).filter(Boolean)) {
    assert.equal(install!.command, 'brew', 'no curl | sh, no sudo');
    assert.ok(!install!.args.some(arg => /sudo|curl|\||;|&/u.test(arg)));
  }
  const rg = TOOLS.find(tool => tool.id === 'rg')!;
  assert.equal(toolInstall(rg, true, 'linux')?.label, 'brew install ripgrep');
  assert.equal(toolInstall(rg, false, 'linux'), undefined);
  assert.match(toolInstallUnavailable(rg, false, 'linux'), /package manager/u);
});

test('missing provider: the gallery offers the exact command in place; no recipe gives a factual reason', () => {
  const panel = createProviderPanel('navigation', 'Navigation', NAVIGATION_PROVIDERS, 'native');
  panel.selectedIndex = 1;
  panel.statuses = {zoxide: {state: 'missing'}};
  const rows = renderProviderPanel(panel, 140, []).map(stripAnsi);
  const install = providerInstall(NAVIGATION_PROVIDERS[1]!);
  assert.ok(rows.some(row => install ? row.includes(`Enter installs with ${install.label} after you confirm`) : /Install zoxide/u.test(row)));
  const welcome = createProviderPanel('welcome', 'Welcome', WELCOME_PROVIDERS, 'vespyr');
  welcome.selectedIndex = WELCOME_PROVIDERS.findIndex(provider => provider.id === 'zigfetch');
  welcome.statuses = {zigfetch: {state: 'missing'}};
  assert.ok(renderProviderPanel(welcome, 160, []).map(stripAnsi).some(row => row.includes('no curated install for Zigfetch')));
});

test('confirmed install: progress, re-detect, then the provider is selected and saved; failure selects nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-provider-install-'));
  const bin = join(root, 'bin');
  const previous = {PATH: process.env.PATH, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME};
  try {
    rmSync(bin, {recursive: true, force: true});
    const {mkdirSync} = await import('node:fs');
    mkdirSync(bin);
    // A stand-in package manager: "installs" the named formula as an executable next to itself.
    writeFileSync(join(bin, 'brew'), `#!/bin/sh\nif [ "$2" = "nmsh-broken-tool" ]; then echo "formula failed" >&2; exit 1; fi\nprintf '#!/bin/sh\\necho 1.0\\n' > "$(dirname "$0")/$2"\nchmod +x "$(dirname "$0")/$2"\n`);
    chmodSync(join(bin, 'brew'), 0o755);
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    process.env.XDG_CONFIG_HOME = join(root, 'config');
    clearProviderDetection();
    for (const [tool, expectSaved] of [['nmsh-fake-tool', true], ['nmsh-broken-tool', false]] as const) {
      rmSync(join(root, 'config'), {recursive: true, force: true});
      const app = quietApp();
      try {
        const descriptor: ProviderDescriptor<'native' | 'zoxide'> = {id: 'zoxide', family: 'navigation', label: 'Fake zoxide', kind: 'external',
          executable: tool, versionArgs: ['--version'], description: 'test', recipe: {brew: tool}};
        const state = createProviderPanel('navigation', 'Navigation', [NAVIGATION_PROVIDERS[0]!, descriptor], 'native');
        state.selectedIndex = 1;
        state.statuses = {zoxide: {state: 'missing'}};
        app['providerPanelState'] = state as never;
        await app['handleProviderPanelKey']({kind: 'enter'}, state as never);
        assert.equal(state.step, 'installConfirm', 'Enter on a missing provider offers the install');
        await app['handleProviderPanelKey']({kind: 'enter'}, state as never);
        if (expectSaved) {
          assert.equal(app['providerPanelState'], undefined, 'panel closed after selecting');
          assert.equal(app['configuration'].navigation, 'zoxide', 'selected after a verified install');
          assert.equal(JSON.parse(readFileSync(join(root, 'config', 'nmsh', 'config.json'), 'utf8')).navigation, 'zoxide');
        } else {
          assert.equal(state.step, 'list');
          assert.match(state.message ?? '', /was not installed/u);
          assert.equal(app['configuration'].navigation, 'native', 'nothing selected after a failed install');
        }
      } finally { app['stop'](0); app['session'].kill(); }
    }
  } finally {
    process.env.PATH = previous.PATH;
    if (previous.XDG_CONFIG_HOME === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous.XDG_CONFIG_HOME;
    clearProviderDetection();
    rmSync(root, {recursive: true, force: true});
  }
});
