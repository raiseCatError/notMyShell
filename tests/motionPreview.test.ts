import test from 'node:test';
import assert from 'node:assert/strict';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {renderMotionPreview, PREVIEW_HEIGHT} from '../src/motion/MotionPreview.js';
import {DURATIONS, type MotionGate} from '../src/motion/transitions.js';
import {DEFAULT_PROMPT_CONFIGURATION, type MotionSettings} from '../src/prompt/configuration.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {stripAnsi} from '../src/util/text.js';

const ON: MotionGate = {reducedMotion: false, effectsOff: false, color: true};
const motion = (extra: Partial<MotionSettings> = {}): MotionSettings => ({contextTransitions: 'subtle', commandLaunch: 'sweep', completionHighlight: 'vivid', completionEffect: 'seal', eventFeedback: 'subtle', ...extra});
const plain = (rows: string[]) => rows.map(row => stripAnsi(row));
/** Mid-run frames differ from the settled fixture only by foreground treatment (tint, dim, underline); never a background. */
const settledOf = (row: keyof MotionSettings, settings: MotionSettings, columns = 80) => renderMotionPreview(row, settings, ON, columns, 0, 100_000).rows;
const tinted = (rows: string[], row: keyof MotionSettings = 'commandLaunch', settings: MotionSettings = motion(), columns = 80) => {
  assert.ok(!rows.some(line => /\u001b\[48;/u.test(line)), 'a preview never paints a background');
  return rows.slice(0, 2).join('\n') !== settledOf(row, settings, columns).slice(0, 2).join('\n');
};

test('each Motion row shows its own synthetic fixture', () => {
  const fixtures: Array<[keyof MotionSettings, RegExp]> = [
    ['contextTransitions', /before +~\/project +main +Node 22[\s\S]*after +~\/src +feature\/theme +Node 22/u],
    ['commandLaunch', /npm test/u],
    ['completionHighlight', /git status[\s\S]*Tab completed "tus"/u],
    ['completionEffect', /npm test · 1\.2s[\s\S]*12 passing/u],
    ['eventFeedback', /task finished/u],
  ];
  for (const [row, pattern] of fixtures) {
    const preview = renderMotionPreview(row, motion(), ON, 80, 0, 50);
    assert.match(plain(preview.rows).join('\n'), pattern, row);
    assert.equal(preview.rows.length, PREVIEW_HEIGHT, `${row}: fixed height so the panel does not jump`);
    assert.equal(preview.mode, 'animating', row);
    assert.ok(tinted(preview.rows, row), `${row}: the real effect paints the fixture mid-run`);
  }
});

test('one run, never a loop: the preview settles after the real duration and needs no clock', () => {
  const during = renderMotionPreview('commandLaunch', motion(), ON, 80, 1000, 1000 + DURATIONS.launch / 2);
  const after = renderMotionPreview('commandLaunch', motion(), ON, 80, 1000, 1000 + DURATIONS.launch + 1);
  assert.equal(during.busy, true);
  assert.deepEqual([after.busy, after.mode, tinted(after.rows)], [false, 'settled', false]);
  assert.ok(tinted(during.rows), 'mid-run differs from the settled fixture');
  assert.match(after.caption, /R replays/u);
});

test('changing the value changes the preview mode and paint', () => {
  const at = 1000 + 60;
  const sweep = renderMotionPreview('commandLaunch', motion({commandLaunch: 'sweep'}), ON, 80, 1000, at);
  const pulse = renderMotionPreview('commandLaunch', motion({commandLaunch: 'pulse'}), ON, 80, 1000, at);
  const off = renderMotionPreview('commandLaunch', motion({commandLaunch: 'off'}), ON, 80, 1000, at);
  assert.match(sweep.caption, /light band/u);
  assert.match(pulse.caption, /brightens once/u);
  assert.notDeepEqual(sweep.rows, pulse.rows);
  assert.deepEqual([off.mode, off.busy, tinted(off.rows, 'commandLaunch', motion({commandLaunch: 'off'}))], ['off', false, false]);
  const subtle = renderMotionPreview('completionHighlight', motion({completionHighlight: 'subtle'}), ON, 80, 0, 40);
  const vivid = renderMotionPreview('completionHighlight', motion({completionHighlight: 'vivid'}), ON, 80, 0, 40);
  assert.notDeepEqual(subtle.rows, vivid.rows);
});

test('Effects Off and Reduced Motion suppress the animation and say so; NO_COLOR paints nothing', () => {
  for (const row of ['contextTransitions', 'commandLaunch', 'completionHighlight', 'completionEffect', 'eventFeedback'] as const) {
    const off = renderMotionPreview(row, motion(), {...ON, effectsOff: true}, 80, 0, 50);
    const reduced = renderMotionPreview(row, motion(), {...ON, reducedMotion: true}, 80, 0, 50);
    const mono = renderMotionPreview(row, motion(), {...ON, color: false}, 80, 0, 50);
    assert.deepEqual([off.mode, off.busy, tinted(off.rows, row)], ['effectsOff', false, false], row);
    assert.match(off.caption, /suppressed/u);
    assert.deepEqual([reduced.mode, reduced.busy, tinted(reduced.rows, row)], ['reduced', false, false], row);
    assert.match(reduced.caption, /without animation/u);
    assert.deepEqual([mono.mode, tinted(mono.rows, row)], ['noColor', false], row);
    // The reduced representation is the settled fixture itself.
    assert.deepEqual(plain(reduced.rows).slice(0, 2), plain(renderMotionPreview(row, motion(), ON, 80, 0, 10_000).rows).slice(0, 2));
  }
});

test('narrow widths degrade to the caption at the same height, never past the width', () => {
  for (const columns of [12, 20, 40]) {
    const preview = renderMotionPreview('contextTransitions', motion(), ON, columns, 0, 50);
    assert.equal(preview.rows.length, PREVIEW_HEIGHT);
    for (const row of plain(preview.rows)) assert.ok([...row].length <= columns, `${columns}: ${row}`);
  }
  assert.deepEqual(plain(renderMotionPreview('commandLaunch', motion(), ON, 14, 0, 50).rows).slice(0, 2).map(row => row.trim()), ['', '']);
});

test('the Motion screen shows the preview for the selected row; selecting, changing and R restart it', () => {
  const hub = createAppearanceHub('Zed');
  hub.selected = 5; // Motion
  appearanceHubKey(hub, {kind: 'enter'}, DEFAULT_PROMPT_CONFIGURATION, 100);
  assert.equal(hub.previewStart, 100);
  appearanceHubKey(hub, {kind: 'down'}, DEFAULT_PROMPT_CONFIGURATION, 120); // Rendering → Context transitions
  const config = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), motion: motion()};
  const shown = plain(renderAppearanceHub(hub, config, 100, 'Lavender Native', 'Portable', {gate: ON, now: 150})).join('\n');
  assert.match(shown, /Preview[\s\S]*before +~\/project/u);
  assert.match(shown, /R replay/u);
  appearanceHubKey(hub, {kind: 'down'}, config, 200);
  assert.equal(hub.previewStart, 200);
  assert.match(plain(renderAppearanceHub(hub, config, 100, 'Lavender Native', 'Portable', {gate: ON, now: 250})).join('\n'), /Preview[\s\S]*npm test/u);
  appearanceHubKey(hub, {kind: 'text', value: 'r'} as never, config, 300);
  assert.equal(hub.previewStart, 300);
  appearanceHubKey(hub, {kind: 'right'}, config, 400);
  assert.equal(hub.previewStart, 400);
});

test('the preview never touches the real composer, transcript, transitions or shell', () => {
  const app = new TerminalApp();
  const submitted: string[] = [];
  const original = app['session'].submit.bind(app['session']);
  app['session'].submit = command => { submitted.push(command); };
  try {
    app['onInput']('echo draft');
    const before = {text: app['editor'].text, rows: app['output'].wrapped(80).length};
    app['appearanceHub'] = createAppearanceHub('Zed');
    app['appearanceHub']!.view = 'motion';
    app['appearanceHub']!.previewStart = Date.now();
    for (const key of ['\u001b[B', 'r', '\u001b[B', '\u001b[A']) { app['onInput'](key); app['settingsPanelRows'](80); }
    assert.deepEqual({text: app['editor'].text, rows: app['output'].wrapped(80).length}, before);
    assert.deepEqual(submitted, []);
    assert.equal(app['transitions'].busy, false, 'the real transition state is untouched');
  } finally {
    app['session'].submit = original;
    app['stop'](0);
    app['session'].kill();
  }
});

test('the Motion screen degrades on short terminals: intro, then preview, give way; list and controls stay', () => {
  const hub = createAppearanceHub('Zed');
  hub.view = 'motion';
  hub.previewStart = 0;
  const config = {...structuredClone(DEFAULT_PROMPT_CONFIGURATION), motion: motion()};
  const render = (height: number | undefined) => renderAppearanceHub(hub, config, 100, 'Lavender Native', 'Portable', {gate: ON, now: 50}, height);
  const full = render(undefined);
  assert.ok(full.length > 12);
  for (const height of [30, 20, 16, 14, 12, 10]) {
    const rows = render(height);
    assert.ok(rows.length <= Math.max(height, 10), `fits ${height}: ${rows.length}`);
    const text = plain(rows).join('\n');
    assert.match(text, /Context transitions/u, `${height}: the list stays`);
    assert.match(text, /Esc back/u, `${height}: the controls stay`);
  }
  assert.match(plain(render(30)).join('\n'), /Preview/u, 'room for everything: the preview shows');
  assert.doesNotMatch(plain(render(12)).join('\n'), /Preview/u, 'a short terminal gives up the preview first');
  assert.equal(render(40).length, full.length, 'with room, the panel is the same size on every row');
});
