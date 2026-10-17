import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_CURSOR, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {keepExistingDraft, keepExistingPlan} from '../src/setup/environment/keepExisting.js';
import type {EnvironmentEvidence, ProviderEvidence, ToolEvidence} from '../src/setup/environment/detect.js';
import {createQuickSetup, setStartupEvidence, setupKey, type SetupState} from '../src/setup/SetupCat.js';
import type {Key} from '../src/terminal/keys.js';

/** Keep Existing: one honest plan from read-only evidence, and a draft that keeps what the person has. */
const fresh = (): PromptConfiguration => normalizePromptConfiguration({introSeen: true});
const configured = (): PromptConfiguration => normalizePromptConfiguration({onboardingComplete: true, introSeen: true, nmsh: {palette: 'ocean'},
  transcriptPresentation: 'chat', welcome: 'vespyr', themeBridge: {enabled: true}});

const evidence = (over: Partial<EnvironmentEvidence> = {}): EnvironmentEvidence =>
  ({shell: {id: 'zsh', path: '/bin/zsh', label: 'zsh 5.9'}, host: 'Ghostty', files: ['~/.zshrc'], prompts: [], custom: [], tools: [], notes: [], ...over});
const provider = (id: ProviderEvidence['id'], state: ProviderEvidence['state'], over: Partial<ProviderEvidence> = {}): ProviderEvidence => {
  const started = state === 'active' || state === 'broken';
  const label = {starship: 'Starship', powerlevel10k: 'Powerlevel10k', ohMyPosh: 'Oh My Posh'}[id];
  return {id, label, state, started, runnable: state !== 'broken', configExists: true,
    configPath: {starship: '/h/.config/starship.toml', powerlevel10k: '/h/.p10k.zsh', ohMyPosh: '/h/night.omp.json'}[id],
    ...(id === 'powerlevel10k' ? {themePath: '/h/powerlevel10k/powerlevel10k.zsh-theme'} : {}),
    ...(id === 'starship' ? {version: 'starship 1.21.1'} : {}), ...(started ? {startedBy: '~/.zshrc'} : {}), ...over};
};
const tool = (id: ToolEvidence['id'], state: ToolEvidence['state']): ToolEvidence =>
  ({id, label: id === 'zoxide' ? 'zoxide' : 'Atuin', role: id === 'zoxide' ? 'Navigation' : 'History', state, ...(state === 'active' || state === 'broken' ? {startedBy: '~/.zshrc'} : {})});

test('exactly one active prompt is kept with its config path, without a question', () => {
  const plan = keepExistingPlan(evidence({prompts: [provider('starship', 'active'), provider('powerlevel10k', 'configured', {runnable: true})]}), fresh());
  assert.equal(plan.question, undefined);
  assert.equal(plan.kept?.id, 'starship');
  assert.equal(plan.noop, false);
  assert.ok(plan.found.some(item => item.mark === 'ok' && /Starship/u.test(item.what) && /started by your ~\/\.zshrc/u.test(item.why)));
  assert.ok(plan.found.some(item => item.mark === 'warn' && item.what === 'Powerlevel10k' && /not started/u.test(item.why)));
  assert.ok(plan.found.some(item => item.what === 'zsh 5.9'));
  assert.ok(plan.found.some(item => item.what === 'Ghostty'));
  const draft = keepExistingDraft(fresh(), evidence({prompts: [provider('starship', 'active')]}), 0, false);
  assert.equal(draft.provider, 'starship');
  assert.equal(draft.starship.configPath, '/h/.config/starship.toml');
});

test('several active prompts ask which one; only one ever runs', () => {
  const found = evidence({prompts: [provider('starship', 'active'), provider('powerlevel10k', 'active')]});
  const plan = keepExistingPlan(found, fresh());
  assert.equal(plan.question?.kind, 'several');
  assert.deepEqual(plan.question?.options.map(option => option.answer), ['starship', 'powerlevel10k']);
  assert.match(plan.question?.note ?? '', /One prompt runs at a time/u);
  assert.equal(keepExistingDraft(fresh(), found, 0, false).provider, 'starship');
  const p10k = keepExistingDraft(fresh(), found, 1, false);
  assert.equal(p10k.provider, 'powerlevel10k');
  assert.deepEqual(p10k.powerlevel10k, {themePath: '/h/powerlevel10k/powerlevel10k.zsh-theme', configPath: '/h/.p10k.zsh'});
  assert.equal(keepExistingDraft(fresh(), found, 99, false).provider, 'starship', 'an out-of-range answer falls back to the first');
});

test('no active prompt asks Composer only (first, the default) or NMSh Minimal; configured providers are offered by name', () => {
  const custom = evidence({custom: [{kind: 'assignment', label: 'A custom zsh PROMPT', where: '~/.zshrc'}]});
  const plan = keepExistingPlan(custom, fresh());
  assert.equal(plan.question?.kind, 'none');
  assert.equal(plan.question?.options[0]?.answer, 'none');
  assert.equal(plan.question?.options[0]?.label, 'Composer only');
  assert.equal(plan.question?.options.at(-1)?.answer, 'minimal');
  assert.match(plan.question?.title ?? '', /custom prompts/u);
  assert.ok(plan.found.some(item => item.mark === 'warn' && item.what === 'A custom zsh PROMPT'));
  assert.equal(keepExistingDraft(fresh(), custom, 0, false).provider, 'none');
  const minimal = keepExistingDraft(fresh(), custom, plan.question!.options.length - 1, false);
  assert.equal(minimal.provider, 'nmsh');
  assert.equal(minimal.nmsh.style, 'minimal');
  // A configured-but-not-started provider that can run is offered by name; one that cannot is only reported.
  const configuredStarship = evidence({prompts: [provider('starship', 'configured', {runnable: true}), provider('ohMyPosh', 'configured', {runnable: false})]});
  const offered = keepExistingPlan(configuredStarship, fresh());
  assert.deepEqual(offered.question?.options.map(option => option.answer), ['none', 'starship', 'minimal']);
  assert.match(offered.question?.options[1]?.detail ?? '', /not started/u);
  assert.equal(keepExistingDraft(fresh(), configuredStarship, 1, false).provider, 'starship');
});

test('a started prompt that cannot run is reported as broken and never offered', () => {
  const broken = evidence({prompts: [provider('starship', 'broken')]});
  const plan = keepExistingPlan(broken, fresh());
  assert.equal(plan.question?.kind, 'none');
  assert.ok(!plan.question?.options.some(option => option.answer === 'starship'));
  assert.ok(plan.found.some(item => item.mark === 'warn' && /not installed/u.test(item.why)));
  assert.match(plan.question?.title ?? '', /Starship/u);
});

test('the fresh-install draft keeps what the person has and adds nothing loud', () => {
  const saved = fresh();
  const found = evidence({shell: {id: 'fish', path: '/opt/homebrew/bin/fish', label: 'fish 3.7.1'}, prompts: [provider('starship', 'active')],
    tools: [tool('zoxide', 'active'), tool('atuin', 'installed')]});
  const draft = keepExistingDraft(saved, found, 0, false);
  assert.equal(draft.shellBackend, 'fish');
  assert.equal(draft.provider, 'starship');
  assert.equal(draft.navigation, 'zoxide', 'an active zoxide becomes the Navigation provider');
  assert.equal(draft.history, 'native', 'an installed-only Atuin is not started for you');
  assert.deepEqual([draft.uiChrome.source, draft.uiChrome.preset], ['custom', 'grayscale']);
  assert.equal(draft.syntax.colors, 'grayscale');
  assert.equal(draft.presentation.preset, 'off');
  assert.equal(draft.presentation.effectsOff, true);
  assert.equal(draft.presentation.shimmer, 'off');
  assert.equal(draft.idleVisuals.timeout, 0);
  assert.equal(draft.motion.rendering, 'clean');
  assert.equal(draft.motion.commandLaunch, 'off');
  assert.deepEqual(draft.cursor, DEFAULT_CURSOR, 'the host cursor, no managed shader');
  assert.equal(draft.welcome, 'none');
  assert.equal(draft.transcriptPresentation, 'normal');
  assert.equal(draft.composerPosition, 'flow');
  assert.equal(draft.composerLayout, 'twoLine');
  assert.equal(draft.terminalTitle, 'off');
  assert.deepEqual(draft.themeBridge, saved.themeBridge, 'Theme Bridge stays as it was');
  assert.equal(draft.presentation.reducedMotion, saved.presentation.reducedMotion);
  assert.deepEqual(normalizePromptConfiguration(draft), draft);
  // An unsupported shell keeps NMSh's own default.
  assert.equal(keepExistingDraft(saved, evidence({shell: {label: 'nu'}}), 0, false).shellBackend, saved.shellBackend);
});

test('a configured install is a no-op unless re-detected, and re-detection changes only what was detected', () => {
  const saved = configured();
  const found = evidence({shell: {id: 'fish', path: '/usr/bin/fish', label: 'fish 3.7'}, prompts: [provider('starship', 'active')], tools: [tool('atuin', 'active')]});
  const plan = keepExistingPlan(found, saved);
  assert.equal(plan.noop, true);
  assert.equal(plan.question, undefined);
  assert.deepEqual(keepExistingDraft(saved, found, 0, false), saved);
  assert.equal(keepExistingPlan(found, saved, true).noop, false);
  const redetected = keepExistingDraft(saved, found, 0, true);
  assert.equal(redetected.provider, 'starship');
  assert.equal(redetected.shellBackend, 'fish');
  assert.equal(redetected.history, 'atuin');
  assert.equal(redetected.nmsh.palette, 'ocean', 'saved NMSh preferences are preserved exactly');
  assert.equal(redetected.transcriptPresentation, 'chat');
  assert.equal(redetected.welcome, 'vespyr');
  assert.deepEqual(redetected.themeBridge, saved.themeBridge);
  assert.deepEqual(redetected.uiChrome, saved.uiChrome);
});

const press = (state: SetupState, key: Key | string) =>
  setupKey(state, typeof key === 'string' ? (key.length === 1 ? {kind: 'text', value: key} : {kind: key} as Key) : key, 5000);

test('selector: Keep Existing waits for evidence, answers its question with ↑↓, and applies the answer', () => {
  const state = createQuickSetup(fresh(), 0);
  press(state, '4');
  press(state, 'enter');
  assert.equal(state.quick?.review, true);
  assert.equal(press(state, 'enter'), undefined, 'a first run cannot apply Keep Existing before the evidence is in');
  setStartupEvidence(state, evidence({custom: [{kind: 'assignment', label: 'A custom zsh PROMPT', where: '~/.zshrc'}]}));
  assert.equal(state.draft.provider, 'none', 'Composer only is the default answer');
  press(state, 'down');
  assert.equal(state.quick?.keep?.answer, 1);
  assert.equal(state.draft.provider, 'nmsh', 'NMSh Minimal');
  press(state, 'down');
  assert.equal(state.quick?.keep?.answer, 1, 'the answer stays within the options');
  press(state, 'up');
  assert.equal(state.quick?.keep?.answer, 0);
  const applied = press(state, 'enter');
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') {
    assert.equal(applied.startingPoint, 'existing');
    assert.equal(applied.configuration.provider, 'none');
    assert.equal(applied.configuration.uiChrome.preset, 'grayscale');
  }
});

test('selector: R re-detects Keep Existing on a configured install only', () => {
  const state = createQuickSetup(configured(), 0);
  setStartupEvidence(state, evidence({prompts: [provider('starship', 'active')]}));
  press(state, '4');
  assert.deepEqual(state.draft, state.saved, 'a configured install keeps everything');
  press(state, 'enter');
  assert.deepEqual(press(state, 'R'), {kind: 'redetect'});
  assert.equal(state.quick?.keep?.redetect, true);
  assert.equal(state.draft.provider, 'starship');
  const freshState = createQuickSetup(fresh(), 0);
  setStartupEvidence(freshState, evidence());
  press(freshState, '4'); press(freshState, 'enter');
  assert.equal(press(freshState, 'r'), undefined, 'a first run already uses the detection');
  const other = createQuickSetup(configured(), 0);
  press(other, 'enter');
  assert.equal(press(other, 'r'), undefined, 'R belongs to Keep Existing');
});
