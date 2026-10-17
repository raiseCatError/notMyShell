import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {createQuickSetup, GUIDED_STEPS, renderSetup, setStartupEvidence, setupKey, type SetupState} from '../src/setup/SetupCat.js';
import {startupLayout} from '../src/setup/startup/view.js';
import {CAT_BODY} from '../src/idle/catSprite.js';
import type {EnvironmentEvidence} from '../src/setup/environment/detect.js';
import type {Key} from '../src/terminal/keys.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

/** The Horizon selector as rows: tiers, the segment, the horizon, the sheet, color and glyph fallbacks, the cached ground. */
function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  try { return run(); } finally { for (const [key, value] of Object.entries(saved)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
const TRUECOLOR = {NMSH_COLOR: 'truecolor', NO_COLOR: undefined, NMSH_ICONS: 'nerd', NMSH_REDUCED_MOTION: undefined, NMSH_DETERMINISTIC: undefined};
const fresh = (): PromptConfiguration => normalizePromptConfiguration({introSeen: true});
const selector = (config = fresh(), firstRun = true): SetupState => { const state = createQuickSetup(config, 0); state.onboarding = firstRun || undefined; return state; };
const press = (state: SetupState, key: Key | string, now = 1000) =>
  setupKey(state, typeof key === 'string' ? (key.length === 1 ? {kind: 'text', value: key} : {kind: key} as Key) : key, now);
const plain = (rows: readonly string[]) => rows.map(stripAnsi).join('\n');
const evidence = (): EnvironmentEvidence => ({home: '/Users/you', shell: {id: 'zsh', path: '/bin/zsh', label: 'zsh 5.9'}, host: 'Ghostty', files: ['~/.zshrc'],
  prompts: [{id: 'starship', label: 'Starship', state: 'active', started: true, runnable: true, version: 'starship 1.21.1', configPath: '/Users/you/.config/starship.toml', configExists: true, startedBy: '~/.zshrc'}],
  custom: [], tools: [{id: 'zoxide', label: 'zoxide', role: 'Navigation', state: 'active', startedBy: '~/.zshrc'}], notes: []});
const rgb = (value: number) => `${(value >> 16) & 255};${(value >> 8) & 255};${value & 255}`;

test('all four choices at every tier, inside bounds', () => withEnv(TRUECOLOR, () => {
  for (const [columns, height] of [[200, 50], [130, 38], [96, 30], [80, 24], [60, 20], [40, 14], [16, 6]] as const) {
    for (const choice of ['1', '2', '3', '4']) {
      const state = selector();
      press(state, choice, -5000);
      const rows = renderSetup(state, columns, height, 10_000);
      assert.equal(rows.length, height, `${columns}x${height}`);
      for (const row of rows) assert.ok(displayWidth(row) <= columns, `${columns}x${height}: ${JSON.stringify(stripAnsi(row))}`);
      const text = plain(rows);
      const titles = columns < 40 || height < 14 ? ['Recommended', 'Minimal', 'Customize', 'Keep Existing'] : ['NMSh Recommended', 'Minimal Terminal', 'Customize Everything', 'Keep Existing'];
      for (const title of titles) assert.ok(text.includes(title), `${columns}x${height} choice ${choice}: ${title}\n${text}`);
    }
  }
  assert.deepEqual(startupLayout(130, 38), {skyHeight: 16, twoColumn: true, tier: 'full', margin: 6});
  assert.deepEqual(startupLayout(80, 24), {skyHeight: 6, twoColumn: false, tier: 'accordion', margin: 3});
  assert.equal(startupLayout(80, 19).skyHeight, 0, 'no sky under 20 rows');
  assert.equal(startupLayout(39, 30).tier, 'tiny');
  assert.equal(startupLayout(60, 13).tier, 'tiny');
}));

test('the highlighted choice is a powerline segment: the notch, the accent fill in dark ink, the end wedge', () => withEnv(TRUECOLOR, () => {
  const state = selector();
  press(state, '2', -5000);
  const rows = renderSetup(state, 130, 38, 10_000);
  const row = rows.find(line => stripAnsi(line).includes('2  Minimal Terminal'))!;
  assert.ok(row, plain(rows));
  const visible = stripAnsi(row);
  assert.ok(visible.includes(''), 'the independent-segment notch');
  assert.ok(visible.includes(''), 'the end wedge');
  assert.ok(visible.indexOf('') < visible.indexOf('2  Minimal') && visible.indexOf('') > visible.indexOf('Minimal Terminal'));
  assert.ok(row.includes(`48;2;${UI_COLORS.accent.red};${UI_COLORS.accent.green};${UI_COLORS.accent.blue}m`), 'on the accent fill');
}));

test('the horizon is its own ▔ row below the sky band, and the band never jumps with the highlight', () => withEnv(TRUECOLOR, () => {
  const sky = startupLayout(130, 38).skyHeight;
  for (const choice of ['1', '2', '3', '4']) {
    const state = selector();
    press(state, choice, -5000);
    const rows = renderSetup(state, 130, 38, 10_000);
    assert.equal(stripAnsi(rows[sky]!), '▔'.repeat(130), `choice ${choice}: the first ground row is the horizon`);
    assert.ok(rows.slice(0, sky).every(row => !row.includes('▔')), 'the horizon is never painted into the band');
  }
}));

test('Vespyr stands on the horizon at the left margin, only with room for it', () => withEnv(TRUECOLOR, () => {
  const body = `38;2;${rgb(CAT_BODY)}m`;
  const wide = renderSetup(selector(), 130, 38, 10_000);
  const sky = startupLayout(130, 38).skyHeight;
  assert.ok(wide[sky - 1]!.includes(body), 'its feet are on the band\'s bottom row');
  assert.ok(stripAnsi(wide[sky - 1]!).slice(0, 6).trim() === '' || !wide[sky - 1]!.startsWith(body), 'it stands at the margin, not the edge');
  assert.ok(!renderSetup(selector(), 50, 30, 10_000).some(row => row.includes(body)), 'under 56 columns there is no Vespyr');
  assert.ok(!renderSetup(selector(), 80, 21, 10_000).some(row => row.includes(body)), 'a sky under five rows has no Vespyr');
  // With Aurora off it stands on the hairline, with no background around it.
  const off = selector();
  press(off, 'A'); press(off, 'A');
  const rows = renderSetup(off, 130, 38, 10_000);
  assert.ok(rows[sky - 1]!.includes(body));
  assert.ok(rows.slice(0, sky - 4).every(row => !/\u001b\[48;/u.test(row)), 'no sky above it');
}));

test('Keep Existing shows read-only evidence, says when it is still looking, and draws the detected prompt in neutral chrome', () => withEnv(TRUECOLOR, () => {
  const state = selector();
  press(state, '4', -5000);
  let text = plain(renderSetup(state, 130, 38, 10_000));
  assert.match(text, /read-only · nothing is changed/u);
  assert.match(text, /Looking at your shell/u);
  setStartupEvidence(state, evidence());
  text = plain(renderSetup(state, 130, 38, 10_000));
  assert.match(text, /zsh 5\.9/u);
  assert.match(text, /Starship 1\.21\.1\s+started by your ~\/\.zshrc/u);
  assert.match(text, /Ghostty\s+your theme, font and cursor/u);
  state.context.startup!.sample = '\u001b[1;36m~/src\u001b[0m on \u001b[1;35mmain\u001b[0m';
  text = plain(renderSetup(state, 130, 38, 10_000));
  assert.match(text, /~\/src on main/u);
  assert.match(text, /your prompt, as NMSh will draw it/u);
  press(state, 'enter');
  text = plain(renderSetup(state, 130, 38, 10_000));
  assert.match(text, /Keep your terminal as it is\?/u);
  assert.match(text, /Stays exactly/u);
  assert.match(text, /Keep my setup/u);
}));

test('the Leave setup? sheet dims the ground and leaves the sky byte-identical', () => withEnv(TRUECOLOR, () => {
  const state = selector();
  const before = renderSetup(state, 130, 38, 10_000);
  press(state, 'escape');
  const after = renderSetup(state, 130, 38, 10_000);
  const sky = startupLayout(130, 38).skyHeight;
  assert.deepEqual(after.slice(0, sky + 1), before.slice(0, sky + 1), 'the sky and its horizon are untouched');
  const sheet = after.slice(-4).map(stripAnsi).join('\n');
  assert.match(sheet, /Leave setup\?/u);
  assert.match(sheet, /Stay/u);
  assert.match(sheet, /Leave/u);
  assert.match(sheet, /Nothing changes/u);
  assert.ok(after.slice(sky + 1, -4).filter(row => stripAnsi(row).trim()).every(row => row.includes('\u001b[2m')), 'the ground behind recedes');
  // Stay is focused first: it carries the accent.
  const accent = `48;2;${UI_COLORS.accent.red};${UI_COLORS.accent.green};${UI_COLORS.accent.blue}m`;
  const buttons = after.at(-3)!;
  assert.ok(buttons.indexOf(accent) < buttons.indexOf('Stay') && buttons.indexOf('Stay') < buttons.lastIndexOf('Leave'));
}));

test('NO_COLOR: reverse video for the selection, no color escapes at all, a plain rule for the horizon', () => withEnv({...TRUECOLOR, NMSH_COLOR: undefined, NO_COLOR: '1'}, () => {
  for (const setup of [(_s: SetupState) => {}, (s: SetupState) => { press(s, 'enter'); }, (s: SetupState) => { press(s, 'escape'); }, (s: SetupState) => { press(s, '4', -5000); setStartupEvidence(s, evidence()); press(s, 'enter'); }]) {
    const state = selector();
    setup(state);
    const rows = renderSetup(state, 130, 38, 10_000);
    for (const row of rows) assert.doesNotMatch(row, /\u001b\[(?:38|48);/u);
    assert.ok(rows.some(row => row.includes('\u001b[7m')), 'the selection is reverse video');
    assert.equal(rows[startupLayout(130, 38).skyHeight], '─'.repeat(130));
  }
}));

test('16 colors: no sky, reverse video for the selection, a plain rule', () => withEnv({...TRUECOLOR, NMSH_COLOR: '16'}, () => {
  const rows = renderSetup(selector(), 130, 38, 10_000);
  const sky = startupLayout(130, 38).skyHeight;
  assert.equal(rows[sky], '─'.repeat(130));
  assert.ok(rows.some(row => row.includes('\u001b[7m') && stripAnsi(row).includes('1  NMSh Recommended')));
  assert.ok(rows.slice(0, sky - 4).every(row => !/\u001b\[(?:4[0-7]|10[0-7])m/u.test(row)), 'no sky');
}));

test('Safe glyphs: ASCII segment ends and rules', () => withEnv({...TRUECOLOR, NMSH_ICONS: 'safe'}, () => {
  const rows = renderSetup(selector(), 130, 38, 10_000);
  const text = plain(rows);
  assert.doesNotMatch(text, /[─▔◆◇]/u);
  const row = rows.map(stripAnsi).find(line => line.includes('1  NMSh Recommended'))!;
  assert.match(row, /<\s1 {2}NMSh Recommended\s+>/u);
  assert.equal(stripAnsi(rows[startupLayout(130, 38).skyHeight]!), '-'.repeat(130));
}));

test('ground rows are reused from cache across frames until the state or the size changes', () => withEnv(TRUECOLOR, () => {
  const state = selector();
  const first = renderSetup(state, 130, 38, 10_000);
  const cached = state.context.startup!.ground!;
  const later = renderSetup(state, 130, 38, 10_400);
  assert.equal(state.context.startup!.ground, cached, 'the same ground for a new sky frame');
  assert.deepEqual(later.slice(17), first.slice(17));
  assert.notDeepEqual(later.slice(0, 16), first.slice(0, 16), 'the sky moved');
  press(state, 'down', 10_500);
  renderSetup(state, 130, 38, 10_600);
  assert.notEqual(state.context.startup!.ground, cached, 'a new highlight draws a new ground');
  const highlight = state.context.startup!.ground!;
  renderSetup(state, 120, 38, 10_700);
  assert.notEqual(state.context.startup!.ground, highlight, 'a new size draws a new ground');
}));

test('review rows come from the actual draft, and the welcome promise is honest', () => withEnv(TRUECOLOR, () => {
  const minimal = selector();
  press(minimal, '2', -5000); press(minimal, 'right'); press(minimal, 'enter');
  let text = plain(renderSetup(minimal, 130, 38, 10_000));
  assert.match(text, /Start with Minimal Terminal\?/u);
  assert.match(text, /Prompt\s+Minimal · one line/u);
  assert.match(text, /Motion\s+Off · no effects/u);
  assert.match(text, /Welcome\s+None/u);
  const first = selector();
  press(first, 'enter');
  text = plain(renderSetup(first, 130, 38, 10_000));
  assert.match(text, /Welcome\s+Vespyr, plus a first-run hello/u);
  assert.match(text, /Cursor\s+Your terminal's caret · effects Off/u);
  const reopened = selector(normalizePromptConfiguration({onboardingComplete: true}), false);
  press(reopened, 'enter');
  text = plain(renderSetup(reopened, 130, 38, 10_000));
  assert.match(text, /Welcome\s+Vespyr greets each new session/u, 'reopening never promises the first-run welcome');
  assert.match(text, /replaces NMSh's current look and feel/u);
}));

test('reopened: Your starting point, with the current one labelled', () => withEnv(TRUECOLOR, () => {
  const state = selector(normalizePromptConfiguration({onboardingComplete: true, startingPoint: 'minimal'}), false);
  const text = plain(renderSetup(state, 130, 38, 10_000));
  assert.match(text, /Your starting point/u);
  assert.doesNotMatch(text, /Welcome to notMyShell/u);
  assert.match(text, /Minimal Terminal · current/u);
  assert.match(plain(renderSetup(selector(), 130, 38, 10_000)), /Welcome to notMyShell/u);
}));

test('Customize shows the guided setup\'s own steps as tiles', () => withEnv(TRUECOLOR, () => {
  assert.deepEqual([...GUIDED_STEPS], ['Terminal', 'Look', 'Prompt', 'Motion', 'Cursor', 'Editor', 'Transcript', 'History', 'Shell', 'Sessions', 'Ask', 'Welcome', 'Idle', 'Tools']);
  const state = selector();
  press(state, '3', -5000);
  const text = plain(renderSetup(state, 130, 38, 10_000));
  for (const step of GUIDED_STEPS) assert.ok(text.includes(step), step);
}));

test('narrow footers keep continue and leave; a failed save shows in place', () => withEnv(TRUECOLOR, () => {
  const text = plain(renderSetup(selector(), 61, 21, 10_000));
  assert.match(text, /⏎\s+continue/u);
  assert.match(text, /esc\s+leave/u);
  for (const [columns, height] of [[130, 38], [80, 24], [30, 10]] as const) {
    const state = selector();
    press(state, 'enter');
    state.message = 'Could not save. Your draft is kept; retry Apply or Esc to cancel.';
    assert.match(plain(renderSetup(state, columns, height, 10_000)), /Could not save/u, `${columns}x${height}`);
  }
}));
