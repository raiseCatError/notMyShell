import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {CHROMA_IN_LOOK_ROW, createSetup, parseSetupEntry, renderSetup, SETUP_EQUIVALENTS, SETUP_SECTIONS, sectionIndex, setupChanges, setupKey,
  setupSelectedRow, type SetupState} from '../src/setup/SetupCat.js';
import {SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';
import {applyUiTheme} from '../src/appearance/uiTheme.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {stripAnsi} from '../src/util/text.js';

// Setup Cat's approved order (workspace-ui-decision.md): Look → Prompt → Motion, Chroma chosen in Look only.

const clone = (): PromptConfiguration => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const ids = (section: string, draft = clone()) => {
  const found = SETUP_SECTIONS.find(item => item.id === section)!;
  return [...found.rows, ...(found.dynamicRows?.(draft) ?? [])].map(item => item.row.id);
};
const goTo = (state: SetupState, section: string, row: string) => {
  state.section = sectionIndex(section);
  state.row = 0;
  for (let guard = 0; guard < 80 && setupSelectedRow(state)?.row.id !== row; guard += 1) setupKey(state, {kind: 'down'});
  assert.equal(setupSelectedRow(state)?.row.id, row, `reached ${row}`);
};
const plain = (rows: readonly string[]) => rows.map(stripAnsi).join('\n');

test('Setup order: Start, Terminal, then Look → Prompt → Motion, then Cursor and the rest unchanged', () => {
  assert.deepEqual(SETUP_SECTIONS.map(section => section.id), ['welcome', 'terminal', 'appearance', 'prompt', 'motion', 'cursor', 'editor', 'transcript',
    'history', 'shell', 'sessions', 'ask', 'welcomeScreen', 'idle', 'tools', 'review']);
  assert.deepEqual(SETUP_SECTIONS.slice(2, 5).map(section => section.title), ['Look', 'Prompt', 'Motion']);
  // Tab walks them in that order.
  const state = createSetup(clone());
  state.section = sectionIndex('terminal');
  const titles: string[] = [];
  for (let step = 0; step < 4; step += 1) { setupKey(state, {kind: 'complete'}); titles.push(SETUP_SECTIONS[state.section]!.title); }
  assert.deepEqual(titles, ['Look', 'Prompt', 'Motion', 'Cursor']);
});

test('Look: theme family → variant → accent → theme text → UI chrome, then Chroma with its dependent rows under it', () => {
  const look = ids('appearance');
  const at = (id: string) => { const index = look.indexOf(id); assert.ok(index >= 0, `${id} is in Look`); return index; };
  const order = ['themeFamily', 'themeVariant', 'themeAccent', 'themeText', 'uiChrome', 'uiChromePreset', 'treatmentPreset'];
  for (let index = 1; index < order.length; index += 1) assert.ok(at(order[index - 1]!) < at(order[index]!), `${order[index - 1]} before ${order[index]}`);
  const chroma = at('treatmentPreset');
  const dependents = ['treatmentIntensity', 'treatmentSemantic', 'treatmentScope', 'chromaRules', 'treatmentGeometry', 'treatmentMotion', 'treatmentSpeed', 'treatmentCurve'];
  assert.deepEqual(look.slice(chroma + 1, chroma + 1 + dependents.length), dependents, 'directly under Chroma');
  for (const id of dependents) assert.ok(SETTINGS_ROWS.find(row => row.id === id)!.parent, `${id} is indented under its parent`);
  for (const id of ['reducedMotion', 'effectsOff', 'shimmer', 'autoEffects']) assert.ok(!look.includes(id), `${id} moved to Motion`);
});

test('Chroma has one control in Setup (Look); Prompt shows it read-only and goes there', () => {
  const holders = SETUP_SECTIONS.filter(section => ids(section.id).includes('treatmentPreset')).map(section => section.id);
  assert.deepEqual(holders, ['appearance']);
  const prompt = ids('prompt');
  assert.ok(prompt.includes(CHROMA_IN_LOOK_ROW.row.id));
  assert.ok(!prompt.some(id => id.startsWith('treatment') || id === 'chromaRules'), 'no competing Chroma rows in Prompt');
  // No Settings row is offered twice anywhere in Setup.
  const all = SETUP_SECTIONS.flatMap(section => ids(section.id)).filter(id => SETTINGS_ROWS.some(row => row.id === id));
  assert.deepEqual(all.filter((id, index) => all.indexOf(id) !== index), [], 'each setting has one place');

  const state = createSetup(normalizePromptConfiguration({presentation: {preset: 'aurora'}}), 'prompt');
  goTo(state, 'prompt', CHROMA_IN_LOOK_ROW.row.id);
  const rendered = plain(renderSetup(state, 100, 40));
  assert.match(rendered, /Chroma\s+Aurora · change it in Look ›/u, 'the current Chroma, read-only, with the way to change it');
  const before = structuredClone(state.draft);
  for (const kind of ['left', 'right'] as const) setupKey(state, {kind});
  setupKey(state, {kind: 'text', value: ' '});
  assert.deepEqual(state.draft, before, '←→ and Space never change Chroma from Prompt');
  assert.equal(setupKey(state, {kind: 'enter'}), undefined, 'Enter applies nothing and opens no editor');
  assert.equal(SETUP_SECTIONS[state.section]!.id, 'appearance', 'Enter goes to Look');
  assert.equal(setupSelectedRow(state)?.row.id, 'treatmentPreset', 'on the Chroma row');
  assert.deepEqual(state.draft, before);

  // A Chroma change is reviewed once, as the Chroma setting, not again as the read-only line.
  setupKey(state, {kind: 'right'});
  const chromaChanges = setupChanges(state).filter(change => change.label === 'Chroma');
  assert.equal(chromaChanges.length, 1);
  assert.equal(chromaChanges[0]!.from, 'Aurora');
});

test('Motion: Reduced Motion, Decorative effects, Shimmer and Milestone effects first, then the motion rows', () => {
  const motion = ids('motion');
  assert.deepEqual(motion.slice(0, 5), ['reducedMotion', 'effectsOff', 'shimmer', 'autoEffects', 'motion_rendering']);
  assert.ok(motion.includes('motion_intensity') && motion.includes('motion_speed'), 'animation intensity and speed');
  assert.deepEqual(SETUP_SECTIONS.filter(section => ids(section.id).includes('reducedMotion')).map(section => section.id), ['motion']);
});

test('Every setting stays reachable from Setup after the reorder', () => {
  const reachable = new Set(SETUP_SECTIONS.flatMap(section => ids(section.id)));
  for (const row of SETTINGS_ROWS) {
    if (row.level === 'advanced' && !reachable.has(row.id) && SETUP_EQUIVALENTS[row.id] === undefined) continue;
    const equivalent = SETUP_EQUIVALENTS[row.id];
    assert.ok(reachable.has(row.id) || (equivalent && (reachable.has(equivalent) || equivalent === 'setupToolChoice' || equivalent === 'setupBrowseTools')),
      `${row.id} is reachable`);
  }
});

test('Values persist: an unchanged Setup applies exactly the saved configuration; moved rows still save', () => {
  const saved = normalizePromptConfiguration({nmsh: {palette: 'forest'}, presentation: {preset: 'nebula', reducedMotion: true, effectsOff: false}});
  const untouched = createSetup(saved);
  untouched.section = sectionIndex('review');
  const applied = setupKey(untouched, {kind: 'enter'});
  assert.equal(applied?.kind, 'apply');
  assert.deepEqual(applied?.kind === 'apply' && applied.configuration, normalizePromptConfiguration(saved));
  assert.equal(applied?.kind === 'apply' && applied.changed, false);

  const state = createSetup(saved);
  goTo(state, 'motion', 'reducedMotion');
  setupKey(state, {kind: 'right'});
  goTo(state, 'appearance', 'themeFamily');
  setupKey(state, {kind: 'right'});
  state.section = sectionIndex('review');
  const result = setupKey(state, {kind: 'enter'});
  assert.equal(result?.kind, 'apply');
  if (result?.kind !== 'apply') return;
  assert.equal(result.configuration.presentation.reducedMotion, false, 'Reduced Motion saved from Motion');
  assert.notEqual(result.configuration.nmsh.palette, 'forest', 'the theme saved from Look');
  assert.equal(result.configuration.presentation.preset, 'nebula', 'untouched values kept');
  // And it round-trips through normalization (what the config store does).
  assert.deepEqual(normalizePromptConfiguration(JSON.parse(JSON.stringify(result.configuration))), result.configuration);
});

test('Entry points: /setup look, /setup appearance and /setup chroma open Look; /setup motion opens Motion', () => {
  assert.equal(parseSetupEntry('look'), 'look');
  assert.equal(createSetup(clone(), 'look').section, sectionIndex('appearance'));
  assert.equal(createSetup(clone(), 'appearance').section, sectionIndex('appearance'));
  const chroma = createSetup(clone(), 'chroma');
  assert.equal(chroma.section, sectionIndex('appearance'));
  assert.equal(setupSelectedRow(chroma)?.row.id, 'treatmentPreset');
  assert.equal(createSetup(clone(), 'motion').section, sectionIndex('motion'));
  for (const entry of ['look', 'motion']) assert.deepEqual(parseSlashCommand(`/setup ${entry}`), {kind: 'setup', entry});
});

test('Narrow terminals, Safe glyphs and NO_COLOR: Look, Prompt and Motion fit and keep their controls', () => {
  const previous = process.env.NO_COLOR;
  try {
    for (const mode of ['safe', 'nerd'] as const) {
      setIconStyle(mode);
      for (const noColor of [false, true]) {
        if (noColor) process.env.NO_COLOR = '1'; else delete process.env.NO_COLOR;
        for (const section of ['appearance', 'prompt', 'motion']) {
          const state = createSetup(normalizePromptConfiguration({presentation: {preset: 'aurora'}}));
          state.section = sectionIndex(section);
          for (const [width, height] of [[44, 12], [60, 20], [120, 40]] as const) {
            const rows = renderSetup(state, width, height);
            assert.ok(rows.length <= height, `${section} ${width}x${height}`);
            assert.match(stripAnsi(rows.join('\n')), new RegExp(SETUP_SECTIONS[state.section]!.title), `${section} names its step`);
            if (noColor) assert.ok(!rows.join('').includes('\u001B[38;2'), 'no truecolor under NO_COLOR');
          }
        }
      }
    }
  } finally {
    setIconStyle('auto');
    if (previous === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = previous;
  }
});

test('Previews: Look and Prompt show the Chroma setting; Motion explains Reduced Motion and shows Shimmer; idle examples intact', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  app['render'] = () => {};
  try {
    app['configuration'] = normalizePromptConfiguration({});
    app['startSetup']('look');
    const state = app['setupState']!;
    state.draft = normalizePromptConfiguration({presentation: {preset: 'aurora'}});
    assert.match(plain(app['setupPreview'](state, 100)), /Chroma setting  Aurora  ·  preview shows it/u, 'Look: immediate feedback');
    state.section = sectionIndex('prompt');
    assert.match(plain(app['setupPreview'](state, 100)), /Chroma setting  Aurora/u, 'Prompt: the same, read-only');

    goTo(state, 'motion', 'reducedMotion');
    state.draft = normalizePromptConfiguration({presentation: {reducedMotion: true}});
    assert.match(plain(app['setupPreview'](state, 100)), /Reduced Motion: colors stay, movement stops/u);
    state.draft = normalizePromptConfiguration({presentation: {effectsOff: true}});
    assert.match(plain(app['setupPreview'](state, 100)), /Decorative effects Off: .*stay still/u);
    state.draft = normalizePromptConfiguration({});
    goTo(state, 'motion', 'shimmer');
    assert.match(plain(app['setupPreview'](state, 100)), /Shimmer/u, 'the shimmer sample moved with its row');
    assert.equal(app['setupCursorClock'], undefined, 'no looping preview behind the one-shot shimmer');
    goTo(state, 'motion', 'motion_commandLaunch');
    assert.match(plain(app['setupPreview'](state, 100)), /Preview · /u, 'motion rows keep their real previews');

    // #395's activity-wording example and screen-saver preview are untouched by the reorder.
    goTo(state, 'idle', 'activityStyle');
    assert.match(plain(app['setupPreview'](state, 100)), /Cooking|Running/u);
    goTo(state, 'idle', 'idleMode');
    assert.ok(plain(app['setupPreview'](state, 100)).trim().length > 0);
  } finally {
    if (app['setupCursorClock']) app['setupCursorClock']();
    app['stop'](0); app['session'].kill(); applyUiTheme(undefined); isolation.restore();
  }
});
