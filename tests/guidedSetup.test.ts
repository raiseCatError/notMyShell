import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuickSetup, createSetup, guidedPreviewWidth, renderSetup, setupKey, SETUP_SECTIONS, type SetupState} from '../src/setup/SetupCat.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {stripAnsi} from '../src/util/text.js';

/** The guided setup in the selector's visual language: the same sky, segments and keycaps around every existing row. */
function withColor<T>(level: 'truecolor' | 'none', run: () => T): T {
  const saved = {color: process.env.NMSH_COLOR, none: process.env.NO_COLOR};
  if (level === 'none') { process.env.NO_COLOR = '1'; delete process.env.NMSH_COLOR; }
  else { process.env.NMSH_COLOR = 'truecolor'; delete process.env.NO_COLOR; }
  try { return run(); } finally {
    if (saved.color === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = saved.color;
    if (saved.none === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved.none;
  }
}
const fresh = () => normalizePromptConfiguration({introSeen: true});
const key = (state: SetupState, value: string) => setupKey(state, value.length === 1 ? {kind: 'text', value} : {kind: value} as never, 1000);
/** Customize from the selector, then `steps` Tabs into the guided setup. */
function customize(steps = 0): SetupState {
  const state = createQuickSetup(fresh(), 0);
  state.onboarding = true;
  key(state, '3'); key(state, 'enter');
  for (let i = 0; i < steps; i++) key(state, 'complete');
  return state;
}
const accentBackground = () => `48;2;${UI_COLORS.accent.red};${UI_COLORS.accent.green};${UI_COLORS.accent.blue}`;

test('a fixed frame: the rule, the route with the current step as a segment, Step N of M, keycaps on the last row', () => withColor('truecolor', () => {
  const state = customize(2);
  assert.equal(SETUP_SECTIONS[state.section]!.id, 'appearance');
  const rows = renderSetup(state, 125, 35, 12_000);
  const plain = rows.map(stripAnsi);
  assert.equal(rows.length, 35, 'the whole screen, whatever the panel position');
  assert.match(plain[0]!, /^▔+$/u, 'one quiet rule at the top, no sky');
  assert.ok(!rows.slice(0, 3).some(row => /\u001b\[48;2;[\d;]+m▀/u.test(row)), 'no ribbon');
  assert.match(plain[1]!, /Start › Terminal \S? ?Look ?\S? Prompt › Motion/u);
  assert.ok(/\u001b\[48;2;[\d;]+m[^\u001b]*Look/u.test(rows[1]!), 'the current step sits on the accent');
  assert.match(plain[3]!, /Look\s+theme, text and chrome\s+Step 3 of 16/u);
  const theme = rows.find(row => /Theme\b/u.test(stripAnsi(row)) && stripAnsi(row).includes('‹'))!;
  assert.match(stripAnsi(theme), /Theme.*‹ NMSh ›/u, 'the selected row: a segment, then ‹ value ›');
  assert.ok(theme.includes(accentBackground()));
  const footer = plain.at(-1)!;
  for (const action of ['select', 'change', 'next step', 'back to start']) assert.ok(footer.includes(action), `footer: ${action}`);
  assert.doesNotMatch(plain.join('\n'), /Setup Cat {2}·|presets: \/setup quick/u);
}));

test('no jumping: rows start on the same line on every step, and nothing above them moves as values change', () => withColor('truecolor', () => {
  // The selected row (the first one on opening a step) is the segment below the route.
  const firstRow = (steps: number) => renderSetup(customize(steps), 100, 30, 12_000).findIndex((row, index) => index > 1 && row.includes(accentBackground()));
  const starts = [0, 1, 2, 5, 6, 8].map(firstRow);
  assert.ok(starts.every(start => start === starts[0]), `rows start at ${starts}`);
  const state = customize(2);
  const before = renderSetup(state, 100, 30, 12_000);
  key(state, 'down'); key(state, 'down'); key(state, 'down'); key(state, 'down'); key(state, 'down'); key(state, 'down'); key(state, 'down'); key(state, 'down');
  key(state, 'right'); // Chroma on: more rows appear under it.
  const after = renderSetup(state, 100, 30, 12_000);
  assert.deepEqual(after.slice(0, 5).map(stripAnsi).map(row => row.replace(/Step \d+ of \d+/u, '')), before.slice(0, 5).map(stripAnsi).map(row => row.replace(/Step \d+ of \d+/u, '')), 'the head is fixed');
  assert.equal(after.length, before.length);
  assert.match(stripAnsi(after.at(-1)!), /next step/u, 'the keys stay on the last row');
}));

test('long steps scroll within their region and keep the selected row in view', () => withColor('truecolor', () => {
  const state = customize(2);
  const count = 30;
  for (let i = 0; i < count; i++) key(state, 'down');
  const rows = renderSetup(state, 90, 18, 12_000);
  assert.equal(rows.length, 18);
  assert.ok(rows.some(row => row.includes(accentBackground()) && /‹|Open/u.test(stripAnsi(row))), 'the selected row is visible');
  assert.match(stripAnsi(rows[1]!), /Look/u, 'the route stays put');
  assert.ok(rows.some(row => /↑ \d+ more/u.test(stripAnsi(row))), 'what scrolled away is counted');
  for (let i = 0; i < count; i++) key(state, 'up');
  const top = renderSetup(state, 90, 18, 12_000);
  assert.ok(top.some(row => /Theme\b/u.test(stripAnsi(row)) && stripAnsi(row).includes('‹')), 'back at the top');
}));

test('every existing row, value and note is still there, in order', () => withColor('truecolor', () => {
  const state = customize(2);
  const plain = renderSetup(state, 125, 35, 12_000).map(stripAnsi).join('\n');
  assert.match(plain, /Theme[^\n]*‹ NMSh ›[\s\S]*Variant\s+Lavender Native[\s\S]*UI chrome\s+Follow theme[\s\S]*Chroma\s+Off/u);
  key(state, 'down');
  const next = renderSetup(state, 125, 35, 12_000).map(stripAnsi).join('\n');
  assert.match(next, /Variant[^\n]*‹ Lavender Native ›/u, 'the segment follows the selection');
  key(state, 'enter');
  assert.ok(state.chooser, 'the chooser still opens');
  assert.match(renderSetup(state, 125, 35, 12_000).map(stripAnsi).join('\n'), /● /u, 'and lists every choice');
}));

test('two columns when wide: the live preview sits beside the rows; below them when narrower', () => withColor('truecolor', () => {
  const state = customize(2);
  assert.ok(guidedPreviewWidth(state, 125) < 125 && guidedPreviewWidth(state, 125) >= 40, 'the app renders the preview for the right column');
  assert.equal(guidedPreviewWidth(state, 90), 90, 'one column below 96, as in the selector');
  state.context.preview = ['  PREVIEW-ONE', '  PREVIEW-TWO'];
  const wide = renderSetup(state, 125, 35, 12_000).map(stripAnsi);
  const label = wide.findIndex(row => row.includes('Live preview'));
  assert.ok(label >= 0);
  assert.match(wide[label]!, /Theme|Variant/u, 'beside the rows');
  assert.ok(wide.some(row => /Variant|UI text/u.test(row) && row.includes('PREVIEW-ONE')));
  const narrow = renderSetup(state, 90, 34, 12_000).map(stripAnsi);
  const below = narrow.findIndex(row => row.includes('Live preview'));
  assert.ok(below > narrow.findIndex(row => /Chroma\s+Off/u.test(row)), 'below the rows');
  assert.ok(narrow.some(row => row.trim() === 'PREVIEW-ONE'));
}));

test('compact sizes: no ribbon, the current step always visible in the route, the footer keeps its essentials', () => withColor('truecolor', () => {
  for (const [columns, rows] of [[61, 21], [44, 14], [80, 24]] as const) {
    for (let section = 0; section < SETUP_SECTIONS.length; section++) {
      const state = customize(section);
      const frame = renderSetup(state, columns, rows, 12_000);
      const plain = frame.map(stripAnsi);
      assert.ok(frame.length <= rows, `${columns}×${rows} ${section}: height`);
      assert.ok(plain.every(row => row.length <= columns), `${columns}×${rows} ${section}: width`);
      const short = SETUP_SECTIONS[section]!.title.replace(/ &.*$/u, '').replace(/^Optional (\w)/u, (_, first: string) => first.toUpperCase());
      const route = plain.findIndex(row => row.includes(short));
      assert.ok(route >= 0 && route <= 1, `${columns}×${rows}: no ribbon when short, and ${short} visible in the route (${route})`);
      assert.match(plain.at(-1)!, /⏎/u, `${columns}×${rows} ${section}: the footer keeps Enter`);
      assert.match(plain.at(-1)!, /esc/u, `${columns}×${rows} ${section}: and esc`);
      if (columns >= 44 && section < SETUP_SECTIONS.length - 1) assert.match(plain.at(-1)!, /Tab/u, `${columns}×${rows} ${section}: and the next step`);
    }
  }
}));

test('/setup itself: esc cancels (or skips on a first run); Start says what this is', () => withColor('truecolor', () => {
  const state = createSetup(fresh());
  const plain = renderSetup(state, 110, 30, 12_000).map(stripAnsi);
  assert.match(plain.at(-1)!, /cancel/u);
  assert.match(plain.join('\n'), /Setup Cat walks through NMSh settings/u);
  state.onboarding = true;
  assert.match(renderSetup(state, 110, 30, 12_000).map(stripAnsi).at(-1)!, /skip for now/u);
}));

test('NO_COLOR and Safe glyphs: no color at all, the current step and row in reverse video, ASCII marks', () => {
  const icons = process.env.NMSH_ICONS;
  process.env.NMSH_ICONS = 'safe';
  try {
    withColor('none', () => {
      const state = customize(2);
      const rows = renderSetup(state, 110, 30, 12_000);
      assert.ok(rows.every(row => !/\u001b\[(?:38|48);/u.test(row)), 'no color escapes');
      assert.ok(rows.some(row => row.includes('\u001b[7m') && stripAnsi(row).includes('Look')), 'the current step in reverse video');
      const plain = rows.map(stripAnsi);
      assert.match(plain.join('\n'), /Start > Terminal/u);
      assert.match(plain.join('\n'), /< NMSh >/u);
      // The chrome is ASCII (row values such as "Open ›" are the rows' own text).
      for (const row of [plain[0]!, plain.find(row => row.includes('Terminal'))!, plain.at(-1)!, plain.find(row => row.includes('< NMSh >'))!]) assert.doesNotMatch(row, /[▔›‹⏎─]/u, row);
    });
  } finally { if (icons === undefined) delete process.env.NMSH_ICONS; else process.env.NMSH_ICONS = icons; }
});
