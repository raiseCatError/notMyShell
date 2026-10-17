import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {createQuickSetup, sectionIndex, setupKey, type SetupState} from '../src/setup/SetupCat.js';
import {STARTING_POINT_COPY, STARTING_POINT_MOODS, STARTING_POINTS, startingPointDraft} from '../src/setup/startup/startingPoints.js';
import {skyMix, SKY_HOLD_MS} from '../src/setup/startup/sky.js';
import {exportSettings, NEVER_EXPORTED, planImport} from '../src/configuration/portability.js';
import type {Key} from '../src/terminal/keys.js';

/** The starting-point selector's state machine: one quick state, one draft, explicit review and Apply. */
const configured = (): PromptConfiguration => normalizePromptConfiguration({onboardingComplete: true, introSeen: true, nmsh: {palette: 'ocean'},
  shellBackend: 'fish', history: 'atuin', navigation: 'zoxide', presentation: {reducedMotion: true}, transcriptPresentation: 'normal'});
const press = (state: SetupState, key: Key | string, now = 10_000) =>
  setupKey(state, typeof key === 'string' ? (key.length === 1 ? {kind: 'text', value: key} : {kind: key} as Key) : key, now);

test('four choices in order', () => {
  assert.deepEqual([...STARTING_POINTS], ['recommended', 'minimal', 'customize', 'existing']);
  assert.deepEqual(STARTING_POINTS.map(id => STARTING_POINT_COPY[id].title), ['NMSh Recommended', 'Minimal Terminal', 'Customize Everything', 'Keep Existing']);
  assert.deepEqual(STARTING_POINTS.map(id => STARTING_POINT_COPY[id].key), ['1', '2', '3', '4']);
  assert.deepEqual(STARTING_POINTS.map(id => STARTING_POINT_MOODS[id]), ['aurora', 'calm', 'spectrum', 'out']);
  const state = createQuickSetup(normalizePromptConfiguration(undefined), 1000);
  assert.equal(state.quick?.choice, 0);
  assert.equal(state.quick?.review, false);
  assert.equal(state.quick?.layout, 'twoLine');
  assert.equal(state.quick?.previousChoice, 0);
  assert.equal(state.quick?.changedAt, Number.NEGATIVE_INFINITY, 'opening is not a change: no cross-fade, no tail flick');
  assert.equal(state.quick?.sky.started, 1000);
});

test('↑↓ wrap and 1–4 jump, stamping changedAt and previousChoice', () => {
  const state = createQuickSetup(configured(), 1000);
  press(state, 'down', 2000);
  assert.deepEqual([state.quick?.choice, state.quick?.previousChoice, state.quick?.changedAt], [1, 0, 2000]);
  press(state, 'down', 2100); press(state, 'down', 2200);
  assert.equal(state.quick?.choice, 3);
  press(state, 'down', 2300);
  assert.deepEqual([state.quick?.choice, state.quick?.previousChoice], [0, 3], '↓ wraps');
  press(state, 'up', 2400);
  assert.deepEqual([state.quick?.choice, state.quick?.previousChoice, state.quick?.changedAt], [3, 0, 2400], '↑ wraps');
  press(state, '2', 2500);
  assert.deepEqual([state.quick?.choice, state.quick?.previousChoice, state.quick?.changedAt], [1, 3, 2500]);
  press(state, '2', 2600);
  assert.equal(state.quick?.changedAt, 2500, 'jumping to the highlighted choice changes nothing');
  press(state, '4', 2700); assert.equal(state.quick?.choice, 3);
  press(state, '1', 2800); assert.equal(state.quick?.choice, 0);
  press(state, '5', 2900); assert.equal(state.quick?.choice, 0);
});

test('a change mid-fade starts the sky from the blend on screen', () => {
  const state = createQuickSetup(configured(), 0);
  press(state, 'down', 1000);
  press(state, 'down', 1300);
  const expected = skyMix({now: 1300, started: 0, mood: 'calm', previousMood: 'aurora', changedAt: 1000, reduced: false});
  assert.deepEqual(state.quick?.sky.from, expected);
  assert.ok(state.quick!.sky.from.aurora > 0 && state.quick!.sky.from.calm > 0, 'the old fade had not finished');
});

test('highlight changes only the draft', () => {
  const saved = configured();
  const before = structuredClone(saved);
  const state = createQuickSetup(saved, 0);
  // Recommended: the canonical presentation; shell, tools, integrations and accessibility are retained.
  assert.equal(state.draft.nmsh.palette, 'lavender');
  assert.equal(state.draft.transcriptPresentation, 'chat');
  assert.equal(state.draft.cursor.effect, 'none');
  for (const draft of [state.draft]) {
    assert.equal(draft.shellBackend, 'fish'); assert.equal(draft.history, 'atuin'); assert.equal(draft.navigation, 'zoxide');
    assert.equal(draft.presentation.reducedMotion, true);
  }
  press(state, '2');
  assert.equal(state.draft.nmsh.style, 'minimal');
  assert.equal(state.draft.composerPosition, 'flow');
  assert.equal(state.draft.welcome, 'none');
  assert.equal(state.draft.shellBackend, 'fish');
  assert.equal(state.draft.presentation.reducedMotion, true);
  press(state, '3');
  assert.deepEqual(state.draft, saved, 'Customize starts from the saved configuration');
  press(state, '4');
  assert.deepEqual(state.draft, saved, 'Keep Existing on a configured install changes nothing');
  assert.deepEqual(saved, before, 'the saved configuration is never touched');
  assert.deepEqual(state.saved, before);
  assert.deepEqual(startingPointDraft('customize', saved, {layout: 'twoLine'}), saved);
});

test('Minimal toggles Two-line and One-line on the draft', () => {
  const state = createQuickSetup(configured(), 0);
  press(state, 'right');
  assert.equal(state.quick?.layout, 'twoLine', 'only Minimal has a layout control');
  press(state, '2');
  assert.equal(state.draft.composerLayout, 'twoLine');
  press(state, 'right');
  assert.deepEqual([state.quick?.layout, state.draft.composerLayout], ['oneLine', 'oneLine']);
  press(state, 'complete');
  assert.deepEqual([state.quick?.layout, state.draft.composerLayout], ['twoLine', 'twoLine']);
  press(state, 'left');
  assert.equal(state.draft.composerLayout, 'oneLine');
  // Moving away and back keeps the chosen layout.
  press(state, '1'); press(state, '2');
  assert.equal(state.draft.composerLayout, 'oneLine');
});

test('Enter reviews; Esc or ← from review returns to the choices', () => {
  const state = createQuickSetup(configured(), 0);
  press(state, '2');
  assert.equal(press(state, 'enter'), undefined);
  assert.equal(state.quick?.review, true);
  press(state, '4');
  assert.equal(state.quick?.choice, 1, 'the choice is fixed while reviewing');
  press(state, 'right');
  assert.equal(state.quick?.layout, 'twoLine', 'the layout is fixed while reviewing');
  assert.equal(press(state, 'escape'), undefined);
  assert.equal(state.quick?.review, false);
  assert.equal(state.quick?.confirm ?? false, false, 'Esc from review goes back, it does not ask to leave');
  press(state, 'enter');
  press(state, 'left');
  assert.equal(state.quick?.review, false);
});

test('Esc from the choices opens Leave setup? with Stay focused; Leave cancels; Stay returns', () => {
  const state = createQuickSetup(configured(), 0);
  press(state, '2');
  assert.equal(press(state, 'escape'), undefined);
  assert.equal(state.quick?.confirm, true);
  assert.equal(state.quick?.confirmIndex, 0, 'Stay is focused first');
  press(state, 'right'); assert.equal(state.quick?.confirmIndex, 1);
  press(state, 'complete'); assert.equal(state.quick?.confirmIndex, 0);
  press(state, 'left'); assert.equal(state.quick?.confirmIndex, 1);
  press(state, 'focusPrevious'); assert.equal(state.quick?.confirmIndex, 0);
  press(state, 'down'); assert.equal(state.quick?.choice, 1, 'the choices do not move behind the sheet');
  assert.equal(press(state, 'enter'), undefined, 'Stay');
  assert.equal(state.quick?.confirm, false);
  assert.equal(state.quick?.choice, 1);
  press(state, 'escape'); press(state, 'escape');
  assert.equal(state.quick?.confirm, false, 'Esc on the sheet stays');
  press(state, 'interrupt');
  assert.equal(state.quick?.confirm, true, 'Ctrl+C asks too');
  press(state, 'right');
  assert.deepEqual(press(state, 'enter'), {kind: 'cancel'}, 'Leave closes without applying anything');
});

test('A cycles aurora → subtle → off and reports a backdrop result', () => {
  const state = createQuickSetup(configured(), 0);
  const draft = structuredClone(state.draft);
  assert.equal(state.quick?.backdrop, 'aurora');
  assert.deepEqual(press(state, 'A'), {kind: 'backdrop', backdrop: 'subtle'});
  assert.deepEqual(press(state, 'a'), {kind: 'backdrop', backdrop: 'off'});
  press(state, 'enter');
  assert.deepEqual(press(state, 'A'), {kind: 'backdrop', backdrop: 'aurora'}, 'A works while reviewing');
  assert.deepEqual(state.draft, draft, 'the backdrop is not part of the draft');
  press(state, 'escape'); press(state, 'escape');
  assert.equal(press(state, 'A'), undefined, 'not on the Leave setup? sheet');
});

test('Customize opens the guided setup from saved and Esc returns', () => {
  const saved = configured();
  const state = createQuickSetup(saved, 0);
  press(state, '3');
  assert.deepEqual(press(state, 'enter'), {kind: 'manual'});
  assert.equal(state.quick?.manual, true);
  assert.deepEqual(state.draft, saved);
  assert.equal(state.section, 0);
  press(state, 'down');
  assert.equal(state.row, 1, 'the guided setup owns the keys');
  assert.equal(press(state, 'escape'), undefined);
  assert.equal(state.quick?.manual, false, 'no edits: straight back to the choices');
  assert.equal(state.quick?.choice, 2);
  assert.deepEqual(state.draft, saved);
  // With an edit it asks first, then returns to the choices.
  press(state, 'enter');
  state.draft = {...state.draft, welcome: 'none'};
  press(state, 'escape');
  assert.equal(state.confirmDiscard, true);
  press(state, 'enter');
  assert.equal(state.quick?.manual, false);
  assert.deepEqual(state.draft, saved, 'nothing unfinished applies');
  // Applying from the guided setup records Customize as the starting point.
  press(state, 'enter');
  state.draft = {...state.draft, welcome: 'none'};
  state.section = sectionIndex('review');
  const applied = press(state, 'enter');
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') {
    assert.equal(applied.startingPoint, 'customize');
    assert.equal(applied.configuration.startingPoint, 'customize');
    assert.equal(applied.configuration.welcome, 'none');
  }
});

test('Apply carries onboardingComplete, startingPoint and the draft', () => {
  const fresh = createQuickSetup(normalizePromptConfiguration({introSeen: true}), 0);
  press(fresh, 'enter');
  const recommended = press(fresh, 'enter');
  assert.equal(recommended?.kind, 'apply');
  if (recommended?.kind === 'apply') {
    assert.equal(recommended.startingPoint, 'recommended');
    const {startingPoint, onboardingComplete, glyphChoiceComplete, toolsSetupComplete, ...rest} = recommended.configuration;
    assert.deepEqual([startingPoint, onboardingComplete, glyphChoiceComplete, toolsSetupComplete], ['recommended', true, true, true]);
    const {startingPoint: _s, onboardingComplete: _o, glyphChoiceComplete: _g, toolsSetupComplete: _t, ...draft} = fresh.draft;
    assert.deepEqual(rest, draft, 'exactly the reviewed draft');
    assert.equal(recommended.tools, 'keep');
    assert.equal(recommended.changed, true);
  }
  const minimal = createQuickSetup(configured(), 0);
  press(minimal, '2'); press(minimal, 'right'); press(minimal, 'enter');
  const applied = press(minimal, 'enter');
  assert.equal(applied?.kind, 'apply');
  if (applied?.kind === 'apply') {
    assert.equal(applied.startingPoint, 'minimal');
    assert.equal(applied.configuration.composerLayout, 'oneLine');
  }
  const saved = configured();
  const keep = createQuickSetup(saved, 0);
  press(keep, '4'); press(keep, 'enter');
  const kept = press(keep, 'enter');
  assert.equal(kept?.kind, 'apply');
  if (kept?.kind === 'apply') {
    assert.equal(kept.startingPoint, 'existing');
    assert.deepEqual({...kept.configuration, startingPoint: undefined}, {...saved, startingPoint: undefined}, 'a configured install keeps everything');
  }
});

test('startingPoint is a label: normalized, never exported, never used to recompute settings', () => {
  assert.equal(normalizePromptConfiguration({startingPoint: 'minimal'}).startingPoint, 'minimal');
  assert.equal(normalizePromptConfiguration({startingPoint: 'bogus'}).startingPoint, undefined);
  assert.equal(normalizePromptConfiguration(undefined).startingPoint, undefined);
  const labelled = normalizePromptConfiguration({onboardingComplete: true, startingPoint: 'minimal', transcriptPresentation: 'chat', welcome: 'vespyr'});
  assert.equal(labelled.transcriptPresentation, 'chat', 'the label never rewrites the effective configuration');
  assert.equal(labelled.welcome, 'vespyr');
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(labelled))), labelled);
  assert.ok((NEVER_EXPORTED as readonly string[]).includes('startingPoint'));
  assert.ok(!JSON.stringify(exportSettings(labelled)).includes('startingPoint'));
  const imported = planImport(normalizePromptConfiguration({onboardingComplete: true, startingPoint: 'existing'}), exportSettings(labelled));
  assert.equal(imported.next.startingPoint, 'existing', 'an import keeps this machine\'s label');
  void DEFAULT_PROMPT_CONFIGURATION;
});

test('reopening highlights the current starting point with its own layout', () => {
  const saved = normalizePromptConfiguration({onboardingComplete: true, startingPoint: 'minimal', composerLayout: 'oneLine'});
  const state = createQuickSetup(saved, 0);
  assert.equal(state.quick?.choice, 1);
  assert.equal(state.quick?.previousChoice, 1);
  assert.equal(state.quick?.layout, 'oneLine');
  assert.equal(state.draft.composerLayout, 'oneLine');
  assert.equal(createQuickSetup(normalizePromptConfiguration({onboardingComplete: true, startingPoint: 'existing'}), 0).quick?.choice, 3);
});

test('after 60 s without a key the sky resumes from where it held', () => {
  const state = createQuickSetup(configured(), 0);
  press(state, 'down', 1000);
  const started = state.quick!.sky.started, changedAt = state.quick!.changedAt;
  press(state, 'right', 1000 + SKY_HOLD_MS + 30_000);
  assert.equal(state.quick!.sky.started, started + 30_000);
  assert.equal(state.quick!.changedAt, changedAt + 30_000, 'the held time is skipped, not replayed');
  assert.equal(state.quick!.sky.activeAt, 1000 + SKY_HOLD_MS + 30_000);
});
