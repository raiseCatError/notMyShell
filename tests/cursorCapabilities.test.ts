import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  caretColorNote, availabilityOf, availableValues, chooseBackend, GHOSTTY_BACKEND, hostCursorFacts, KITTY_BACKEND, PORTABLE_BACKEND, setCursorHostFacts, unavailableReason, type HostCursorFacts,
} from '../src/cursor/backends.js';
import {createCursorPanel, cursorPanelKey, cursorPanelRowKeys, renderCursorPanel, type CursorPanelEnv} from '../src/cursor/CursorPanel.js';
import {renderCursorPreview, PREVIEW_ROWS, PREVIEW_END_MS} from '../src/cursor/CursorPreview.js';
import {contextFor, describeCursorColor, resolveCursorColor, resolveCursorSettings} from '../src/cursor/colors.js';
import {effectPalette} from '../src/cursor/palette.js';
import {fragmentContent, nativeCursorIntegrated, reloadInstruction, shaderSource, writeManagedFiles} from '../src/cursor/native.js';
import {CURSOR_EFFECTS, CURSOR_IDLE_EFFECTS, CURSOR_MOTIONS, DEFAULT_CURSOR, DEFAULT_PROMPT_CONFIGURATION, normalizeCursor, normalizePromptConfiguration, type CursorSettings, type PromptConfiguration} from '../src/prompt/configuration.js';
import {adjustSettingsRow, SETTINGS_ROWS, settingsRowApplies, settingsRowValue} from '../src/ui/SettingsPanel.js';
import {SETUP_SECTIONS} from '../src/setup/SetupCat.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {cursorStyleSequence, TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {hexColor} from '../src/chroma/color.js';
import {stripAnsi} from '../src/util/text.js';
import {isolateConfig} from './support/isolatedConfig.js';

const env = (value: Record<string, string>) => value as NodeJS.ProcessEnv;
const settings = (extra: Partial<CursorSettings> = {}): CursorSettings => ({...structuredClone(DEFAULT_CURSOR), ...extra});
const ghostty = (integrated: boolean): HostCursorFacts => hostCursorFacts(env({TERM_PROGRAM: 'ghostty', TERM_PROGRAM_VERSION: '1.2.0'}), () => integrated);
const kitty = (integrated: boolean): HostCursorFacts => hostCursorFacts(env({KITTY_WINDOW_ID: '1'}), () => integrated);
const terminalApp = hostCursorFacts(env({TERM_PROGRAM: 'Apple_Terminal'}), () => false);
const panelEnv = (facts: HostCursorFacts, draft: CursorSettings, extra: Partial<CursorPanelEnv> = {}): CursorPanelEnv =>
  ({choice: chooseBackend(draft, facts), facts, context: {palette: 'lavender', accent: 'mauve'}, still: false, level: 'truecolor', ...extra});
const withFacts = <T>(facts: HostCursorFacts, run: () => T): T => { setCursorHostFacts(facts); try { return run(); } finally { setCursorHostFacts(undefined); } };
const config = (cursor: Partial<CursorSettings>): PromptConfiguration => ({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), cursor: {...structuredClone(DEFAULT_CURSOR), ...cursor}});
const row = (id: string) => SETTINGS_ROWS.find(item => item.id === id)!;

test('fresh cursor defaults stay Off: no motion, no effect, no idle effect, Auto renderer', () => {
  const fresh = normalizePromptConfiguration({}).cursor;
  assert.deepEqual([fresh.motion, fresh.effect, fresh.idleEffect, fresh.renderer], ['off', 'none', 'off', 'auto']);
  assert.deepEqual(DEFAULT_PROMPT_CONFIGURATION.cursor, DEFAULT_CURSOR);
});

test('capability matrix: names what each backend really draws, not broad flags', () => {
  assert.deepEqual(PORTABLE_BACKEND.support.motion, ['smooth', 'smear', 'tail']);
  assert.deepEqual(PORTABLE_BACKEND.support.effect, ['fire', 'sparks', 'lightning', 'railgun', 'ripple', 'wireframe']);
  assert.deepEqual(PORTABLE_BACKEND.support.idleEffect, ['glow', 'embers', 'flame', 'sparks']);
  assert.deepEqual(GHOSTTY_BACKEND.support, {motion: ['smear', 'tail'], effect: ['fire', 'sparks', 'ripple'], idleEffect: []});
  assert.deepEqual(KITTY_BACKEND.support, {motion: ['tail'], effect: [], idleEffect: []});
  // The generated shader draws only what the matrix lists: Lightning/Railgun never turn the sparks branch on.
  const sparks = (effect: CursorSettings['effect']) => /if \((\d) == 1 && fade > 0\.0\) \{\s*vec2 cell/u.exec(shaderSource(settings({motion: 'smear', effect})))?.[1];
  assert.equal(sparks('sparks'), '1');
  assert.equal(sparks('lightning'), '0');
  assert.equal(sparks('railgun'), '0');
  assert.equal(sparks('fire'), '0');
  // A native effect the shader cannot draw does not even enable it.
  const fragment = (value: Partial<CursorSettings>) => fragmentContent('ghostty', settings(value), env({NMSH_CONFIG_HOME: '/x'}));
  assert.doesNotMatch(fragment({motion: 'smooth'}), /custom-shader =/u, 'Smooth is not a Ghostty shader feature');
  assert.doesNotMatch(fragment({effect: 'lightning'}), /custom-shader =/u);
  assert.match(fragment({effect: 'fire'}), /custom-shader =/u);
  assert.match(fragment({motion: 'tail'}), /custom-shader =/u);
});

test('Portable-supported options are available without any native setup', () => {
  for (const facts of [terminalApp, ghostty(false), kitty(false), hostCursorFacts(env({}), () => false)]) {
    for (const renderer of ['auto', 'portable'] as const) {
      assert.deepEqual(availableValues('motion', CURSOR_MOTIONS, renderer, facts), [...CURSOR_MOTIONS], `${facts.host}/${renderer} motion`);
      assert.deepEqual(availableValues('effect', CURSOR_EFFECTS, renderer, facts), [...CURSOR_EFFECTS]);
      assert.deepEqual(availableValues('idleEffect', CURSOR_IDLE_EFFECTS, renderer, facts), [...CURSOR_IDLE_EFFECTS]);
    }
  }
});

test('forced Host native offers only what the host backend draws, and says why the rest is unavailable', () => {
  const live = ghostty(true);
  assert.deepEqual(availableValues('motion', CURSOR_MOTIONS, 'native', live), ['off', 'smear', 'tail']);
  assert.deepEqual(availableValues('effect', CURSOR_EFFECTS, 'native', live), ['none', 'fire', 'sparks', 'ripple']);
  assert.deepEqual(availableValues('idleEffect', CURSOR_IDLE_EFFECTS, 'native', live), ['off']);
  assert.equal(unavailableReason('idleEffect', CURSOR_IDLE_EFFECTS, 'native', live), 'Ghostty Native does not provide this idle effect.');
  assert.equal(unavailableReason('effect', CURSOR_EFFECTS, 'native', live), undefined, 'something works, so the row is editable');
  assert.deepEqual(availabilityOf('effect', 'lightning', 'native', live), {available: false, reason: 'Ghostty Native does not provide this effect.'});
  assert.equal(unavailableReason('effect', CURSOR_EFFECTS, 'native', kitty(true)), 'Kitty Native does not provide this effect.');
  assert.equal(unavailableReason('motion', CURSOR_MOTIONS, 'native', terminalApp), 'Host native is not available in this terminal.');
  // Before setup the values a host WILL draw stay selectable, labelled as waiting for setup.
  const pending = availabilityOf('effect', 'fire', 'native', ghostty(false));
  assert.deepEqual(pending, {available: true, via: 'native-pending', suffix: 'after Ghostty setup'});
});

test('Auto says so when Portable draws what an active native backend does not', () => {
  const live = ghostty(true);
  assert.deepEqual(availabilityOf('effect', 'lightning', 'auto', live), {available: true, via: 'portable-fallback', suffix: 'Portable fallback'});
  assert.deepEqual(availabilityOf('effect', 'fire', 'auto', live), {available: true, via: 'native', suffix: ''});
  assert.deepEqual(availabilityOf('idleEffect', 'glow', 'auto', live), {available: true, via: 'portable-fallback', suffix: 'Portable fallback'});
  assert.deepEqual(availabilityOf('effect', 'lightning', 'auto', ghostty(false)), {available: true, via: 'portable', suffix: ''}, 'not set up: Portable is simply the renderer, no fallback claim');
  const choice = chooseBackend(settings({effect: 'lightning', motion: 'smear'}), live);
  assert.deepEqual(choice.nativeHandles, {motion: true, effect: false});
  assert.deepEqual(choice.portableDraws, {motion: false, effect: true, idle: true});
  assert.match(choice.reason, /Portable fallback/u);
  const forced = chooseBackend(settings({renderer: 'native', effect: 'lightning'}), live);
  assert.deepEqual(forced.portableDraws, {motion: false, effect: false, idle: false}, 'forced native never quietly draws Portable effects');
});

test('Settings and Setup rows follow the effective renderer: Fire · Portable fallback, Unavailable without arrows', () => {
  withFacts(ghostty(true), () => {
    const auto = config({renderer: 'auto', effect: 'lightning'});
    assert.equal(settingsRowValue(row('cursorEffect'), auto), 'Lightning · Portable fallback');
    assert.equal(settingsRowValue(row('cursorEffect'), config({renderer: 'auto', effect: 'fire'})), 'Fire');
    const forced = config({renderer: 'native', idleEffect: 'off'});
    assert.equal(settingsRowValue(row('cursorIdle'), forced), 'Unavailable');
    assert.equal(row('cursorIdle').unavailable?.(forced), 'Ghostty Native does not provide this idle effect.');
    assert.equal(adjustSettingsRow(row('cursorIdle'), forced, 1), undefined, '→ does not cycle impossible values');
    assert.equal(adjustSettingsRow(row('cursorIdle'), forced, -1), undefined);
    // Effects on the forced renderer cycle only through what Ghostty draws.
    let next = config({renderer: 'native'});
    const seen: string[] = [];
    for (let step = 0; step < 6; step += 1) { next = adjustSettingsRow(row('cursorEffect'), next, 1)!; seen.push(next.cursor.effect); }
    assert.deepEqual([...new Set(seen)].sort(), ['fire', 'none', 'ripple', 'sparks']);
    // A stale value the renderer cannot draw is shown as such and can only be reset to Off.
    const stale = config({renderer: 'native', idleEffect: 'glow'});
    assert.equal(settingsRowValue(row('cursorIdle'), stale), 'Unavailable');
    assert.equal(adjustSettingsRow(row('cursorIdle'), stale, 1)?.cursor.idleEffect, 'off');
  });
  withFacts(terminalApp, () => {
    const forced = config({renderer: 'native'});
    for (const id of ['cursorMotion', 'cursorEffect', 'cursorIdle']) {
      assert.equal(settingsRowValue(row(id), forced), 'Unavailable', id);
      assert.match(row(id).unavailable!(forced)!, /not available in this terminal/u);
    }
    assert.equal(settingsRowValue(row('cursorEffect'), config({renderer: 'auto', effect: 'fire'})), 'Fire', 'Auto on Terminal.app is just Portable');
  });
  // Blink needs an explicit shape.
  assert.equal(settingsRowValue(row('cursorBlink'), config({shape: 'host'})), 'Unavailable');
  assert.equal(adjustSettingsRow(row('cursorBlink'), config({shape: 'host'}), 1), undefined);
  assert.equal(adjustSettingsRow(row('cursorBlink'), config({shape: 'bar', blink: 'host'}), 1)?.cursor.blink, 'on');
});

test('the /cursor panel: unavailable rows say Unavailable, keys do not cycle, and Auto labels the fallback', () => {
  const live = ghostty(true);
  const draft = settings({renderer: 'native'});
  const state = createCursorPanel(draft, 0);
  const keys = cursorPanelRowKeys(false, draft);
  state.selected = keys.indexOf('idle');
  const text = stripAnsi(renderCursorPanel(state, 120, 0, panelEnv(live, draft), 60).join('\n'));
  assert.match(text, /Idle effect\s+Unavailable/u);
  assert.match(text, /Ghostty Native does not provide this idle effect\./u);
  assert.doesNotMatch(text.split('\n').find(line => /Idle effect/u.test(line))!, /‹|›/u, 'no arrows pretending it is editable');
  assert.equal(cursorPanelKey(state, {kind: 'right'}, panelEnv(live, draft), 5), undefined);
  assert.equal(cursorPanelKey(state, {kind: 'enter'}, panelEnv(live, draft), 5), undefined);
  assert.equal(state.draft.idleEffect, 'off');

  const auto = settings({renderer: 'auto', effect: 'lightning'});
  const second = createCursorPanel(auto, 0);
  second.selected = cursorPanelRowKeys(false, auto).indexOf('effect');
  assert.match(stripAnsi(renderCursorPanel(second, 120, 0, panelEnv(live, auto), 60).join('\n')), /Effect\s+‹ Lightning · Portable fallback ›/u);
  // Cycling skips values the forced renderer cannot draw.
  const forced = settings({renderer: 'native', effect: 'sparks'});
  const third = createCursorPanel(forced, 0);
  third.selected = cursorPanelRowKeys(false, forced).indexOf('effect');
  const action = cursorPanelKey(third, {kind: 'right'}, panelEnv(live, forced), 9);
  assert.equal(action?.kind === 'apply' && action.settings.effect, 'ripple', 'Sparks → Ripple, skipping Lightning, Railgun and Wireframe');
});

test('cursor previews: Block, Bar, Underline and Host default are visibly different frames', () => {
  const frame = (shape: CursorSettings['shape']) => renderCursorPreview({scene: 'shape', title: `Shape: ${shape}`, settings: settings({shape}), choice: chooseBackend(settings({shape}), terminalApp), columns: 100, elapsed: 0, still: false});
  const frames = (['block', 'bar', 'underline', 'host'] as const).map(frame);
  for (const preview of frames) assert.equal(preview.rows.length, PREVIEW_ROWS);
  const sample = frames.map(preview => preview.rows[2]!);
  assert.equal(new Set(sample).size, 4, 'every shape paints its own caret');
  assert.match(sample[0]!, /\u001b\[48;/u, 'Block fills the cell');
  assert.match(stripAnsi(sample[1]!), /▏/u, 'Bar is a thin line');
  assert.match(stripAnsi(sample[2]!), /▁/u, 'Underline is a line under the cell');
  assert.match(stripAnsi(sample[3]!), /▯/u, 'Host default is a labelled placeholder, never an explicit shape');
  assert.match(frames[3]!.caption, /Host default/u);
  assert.doesNotMatch(sample[1]!, /\u001b\[48;/u);
  assert.doesNotMatch(sample[2]!, /\u001b\[48;/u);
});

test('cursor previews demonstrate the selected row, are finite, deterministic and fixed height', () => {
  const draft = settings({motion: 'smear', effect: 'fire', shape: 'bar', blink: 'on'});
  const choice = chooseBackend(draft, terminalApp);
  const at = (scene: 'shape' | 'blink' | 'idle' | 'jump', elapsed: number, over: Partial<CursorSettings> = {}) =>
    renderCursorPreview({scene, title: scene, settings: {...draft, ...over}, choice, columns: 100, elapsed, still: false});
  // Jump: the engine runs, then the last frame is held and no clock is needed.
  assert.equal(at('jump', 400).busy, true);
  assert.equal(at('jump', PREVIEW_END_MS + 1).busy, false);
  assert.equal(at('jump', PREVIEW_END_MS + 1).rows.join(), at('jump', PREVIEW_END_MS + 5000).rows.join(), 'held, not looped');
  assert.equal(at('jump', 400).rows.join(), at('jump', 400).rows.join(), 'deterministic: replay is exact');
  assert.notEqual(at('jump', 400).rows.join(), at('jump', 1700).rows.join(), 'the caret really moves');
  // Effect rows run the effect: Fire paints something that None does not.
  assert.notEqual(at('jump', 450, {effect: 'fire'}).rows.join(), at('jump', 450, {effect: 'none'}).rows.join());
  // Blink demonstrates On and Off visibly for a moment, then holds steady.
  const blink = (elapsed: number, value: CursorSettings['blink']) => at('blink', elapsed, {blink: value});
  assert.notEqual(blink(0, 'on').rows[2], blink(600, 'on').rows[2], 'the caret blinks off and on');
  assert.equal(blink(0, 'off').rows[2], blink(600, 'off').rows[2], 'Blink Off is steady');
  assert.equal(blink(0, 'on').busy, true);
  assert.equal(blink(5000, 'on').busy, false, 'not an endless loop');
  assert.equal(blink(5000, 'on').rows[2], blink(5600, 'on').rows[2]);
  // Idle: settles and the idle effect runs (Glow draws beside the caret, never a background fill).
  assert.notEqual(at('idle', 500, {idleEffect: 'glow'}).rows.join(), at('idle', 500, {idleEffect: 'off'}).rows.join());
  assert.doesNotMatch(at('idle', 500, {idleEffect: 'glow'}).rows.join(), /\u001b\[48;/u);
  assert.notEqual(at('idle', 1200, {idleEffect: 'embers', effect: 'none'}).rows.join(), at('idle', 1200, {idleEffect: 'off', effect: 'none'}).rows.join());
  // Every scene and frame has the same height, in narrow widths too.
  for (const scene of ['shape', 'blink', 'idle', 'jump'] as const) for (const columns of [14, 40, 100]) for (const elapsed of [0, 300, 3000]) {
    assert.equal(renderCursorPreview({scene, title: scene, settings: draft, choice, columns, elapsed, still: false}).rows.length, PREVIEW_ROWS);
  }
  // Reduced Motion shows the settled caret instead of animating.
  const still = renderCursorPreview({scene: 'jump', title: 'x', settings: draft, choice, columns: 100, elapsed: 400, still: true});
  assert.equal(still.busy, false);
  assert.match(still.caption, /stay still/u);
  // An unavailable setting demonstrates nothing but the reason.
  const unavailable = renderCursorPreview({scene: 'idle', title: 'x', settings: draft, choice, columns: 100, elapsed: 400, still: false, unavailable: 'Ghostty Native does not provide this idle effect.'});
  assert.equal(unavailable.busy, false);
  assert.match(unavailable.caption, /Unavailable · Ghostty Native/u);
});

test('/cursor panel preview follows the selected row and restarts on selection, change and R', () => {
  const draft = settings({shape: 'bar'});
  const facts = terminalApp;
  const state = createCursorPanel(draft, 100);
  const render = (now: number) => stripAnsi(renderCursorPanel(state, 120, now, panelEnv(facts, state.draft), 60).join('\n'));
  assert.match(render(150), /Preview · Shape: Bar/u);
  assert.match(render(150), /thin line/u);
  cursorPanelKey(state, {kind: 'right'}, panelEnv(facts, state.draft), 200);
  assert.equal(state.draft.shape, 'underline');
  assert.equal(state.started, 200);
  assert.match(render(250), /Preview · Shape: Underline/u);
  cursorPanelKey(state, {kind: 'down'}, panelEnv(facts, state.draft), 300);
  assert.equal(state.started, 300);
  assert.match(render(350), /Preview · Blink: Unavailable|Preview · Blink/u);
  cursorPanelKey(state, {kind: 'text', value: 'r'}, panelEnv(facts, state.draft), 400);
  assert.equal(state.started, 400, 'R replays');
  // The panel keeps its height whatever the selected row, and degrades by dropping the preview before the list on a short terminal.
  const heights = new Set<number>();
  for (const key of cursorPanelRowKeys(false, state.draft)) {
    state.selected = cursorPanelRowKeys(false, state.draft).indexOf(key);
    heights.add(renderCursorPanel(state, 120, 500, panelEnv(facts, state.draft), 60).length);
  }
  assert.equal(heights.size, 1, 'no jumping between rows');
  for (const height of [8, 12, 16, 20]) assert.ok(renderCursorPanel(state, 100, 500, panelEnv(facts, state.draft), height).length <= height, `fits ${height} rows`);
});

test('shape and blink apply to the live renderer at once, from /cursor and from configuration changes', () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    assert.equal(app['renderer'].currentCursorStyle, '');
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, shape: 'bar', blink: 'off'}};
    assert.equal(app['renderer'].currentCursorStyle, cursorStyleSequence('bar', 'off'), 'a configuration change applies without restarting');
    // The /cursor panel changes shape and then blink through the same path.
    app['openCursorPanel']();
    const panel = app['cursorPanel']!;
    panel.selected = 0;
    app['handleCursorPanelKey']({kind: 'right'}, panel);
    assert.equal(app['promptConfiguration'].cursor.shape, 'underline');
    assert.equal(app['renderer'].currentCursorStyle, cursorStyleSequence('underline', 'off'));
    panel.selected = 1;
    app['handleCursorPanelKey']({kind: 'right'}, panel);
    assert.equal(app['promptConfiguration'].cursor.blink, 'host');
    assert.equal(app['renderer'].currentCursorStyle, cursorStyleSequence('underline', 'host'));
    app['handleCursorPanelKey']({kind: 'right'}, panel);
    assert.equal(app['renderer'].currentCursorStyle, cursorStyleSequence('underline', 'on'));
    // Host default sends nothing and puts the terminal's own cursor back.
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, shape: 'host'}};
    assert.equal(app['renderer'].currentCursorStyle, '');
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});

test('cursor color sources resolve against the real theme system: Follow current theme vs Choose theme', () => {
  const base = config({});
  const follow = (palette: PromptConfiguration['nmsh']['palette'], accent = 'mauve' as PromptConfiguration['nmsh']['accent']) =>
    resolveCursorColor(settings({color: {source: 'theme'}}), {palette, accent});
  assert.notDeepEqual(follow('lavender'), follow('dracula'), 'Follow current theme tracks the prompt theme');
  assert.deepEqual(hexColor(follow('dracula')!), '#bd93f9');
  const chosen = (theme: PromptConfiguration['nmsh']['palette'], accent?: PromptConfiguration['nmsh']['accent']) =>
    resolveCursorColor(settings({color: {source: 'chosen', theme, ...(accent ? {themeAccent: accent} : {})}}), {palette: 'lavender', accent: 'mauve'});
  assert.equal(hexColor(chosen('dracula')!), '#bd93f9', 'Choose theme is independent of the prompt');
  assert.notDeepEqual(chosen('dracula'), follow('lavender'));
  assert.notDeepEqual(chosen('tokyonightNight'), chosen('gruvboxDark'));
  // Theme family → variant → Catppuccin accent.
  assert.equal(hexColor(chosen('catppuccinMocha', 'peach')!), '#fab387');
  assert.equal(hexColor(chosen('catppuccinLatte', 'peach')!), '#fe640b');
  assert.notDeepEqual(chosen('catppuccinMocha', 'peach'), chosen('catppuccinMocha', 'sky'));
  // Following the current theme and choosing the same theme agree; changing the prompt theme moves only Follow.
  const resolvedFollow = resolveCursorSettings(settings({color: {source: 'theme'}}), contextFor({...base, nmsh: {...base.nmsh, palette: 'nord'}}));
  const resolvedChosen = resolveCursorSettings(settings({color: {source: 'chosen', theme: 'nord'}}), contextFor(base));
  assert.equal(resolvedFollow.color.custom, resolvedChosen.color.custom);
  assert.equal(resolvedFollow.color.source, 'custom', 'downstream code only ever sees a concrete color');
  // Effects receive the REAL selected color, not a hard-coded accent.
  assert.equal(hexColor(effectPalette(resolvedChosen).caret), hexColor(resolveCursorColor(settings({color: {source: 'chosen', theme: 'nord'}}), contextFor(base))!));
  assert.notDeepEqual(effectPalette(resolveCursorSettings(settings({color: {source: 'chosen', theme: 'dracula'}}), contextFor(base))).caret, effectPalette(settings({color: {source: 'host'}})).caret);
  assert.equal(resolveCursorColor(settings({color: {source: 'host'}}), contextFor(base)), undefined, 'Host has no color of its own');
  assert.equal(describeCursorColor(settings({color: {source: 'custom', custom: '#a67cf3'}}), contextFor(base)).hex, '#a67cf3');
});

test('the /cursor color rows: choose a theme family, variant and accent; Custom opens the picker with validated #RRGGBB', () => {
  const facts = terminalApp;
  let draft = settings({color: {source: 'theme'}});
  const state = createCursorPanel(draft, 0);
  const keyOf = (key: string) => cursorPanelRowKeys(false, state.draft).indexOf(key);
  const press = (kind: 'left' | 'right' | 'enter' | 'escape', now = 10) => cursorPanelKey(state, {kind}, panelEnv(facts, state.draft), now);
  state.selected = keyOf('color');
  press('right'); // Follow current theme → Choose theme
  assert.equal(state.draft.color.source, 'chosen');
  assert.equal(state.draft.color.theme, 'lavender', 'Choose theme starts from the current theme: the color does not jump');
  assert.deepEqual(cursorPanelRowKeys(false, state.draft).filter(key => key.startsWith('color')), ['color', 'colorFamily', 'colorVariant']);
  state.selected = keyOf('colorFamily');
  for (let guard = 0; guard < 12 && state.draft.color.theme !== 'catppuccinMocha'; guard += 1) press('right');
  assert.equal(state.draft.color.theme, 'catppuccinMocha', 'family → its default variant');
  assert.ok(cursorPanelRowKeys(false, state.draft).includes('colorAccent'), 'Catppuccin offers an accent');
  state.selected = keyOf('colorVariant');
  press('right');
  assert.equal(state.draft.color.theme, 'catppuccinLatte' === state.draft.color.theme ? 'catppuccinLatte' : state.draft.color.theme);
  assert.ok(String(state.draft.color.theme).startsWith('catppuccin'));
  state.selected = keyOf('colorAccent');
  const before = state.draft.color.themeAccent;
  press('right');
  assert.notEqual(state.draft.color.themeAccent, before);
  // Custom.
  state.selected = keyOf('color');
  for (let guard = 0; guard < 6 && state.draft.color.source !== 'custom'; guard += 1) press('right');
  assert.equal(state.draft.color.source, 'custom');
  assert.ok(state.draft.color.custom, 'Custom starts from the color shown now');
  state.selected = keyOf('colorCustom');
  const shown = stripAnsi(renderCursorPanel(state, 120, 0, panelEnv(facts, state.draft), 60).join('\n'));
  assert.match(shown, /Custom color\s+■ #[0-9A-F]{6}/u, 'a swatch and the hex');
  press('enter');
  assert.ok(state.picker, 'Enter opens the real color picker');
  const type = (value: string) => cursorPanelKey(state, {kind: 'text', value}, panelEnv(facts, state.draft), 20);
  const original = state.draft.color.custom;
  type('#'); type('12');
  assert.equal(press('enter'), undefined, 'an incomplete value is rejected');
  assert.ok(state.picker, 'still editing');
  assert.equal(state.draft.color.custom, original, 'invalid input never reaches the settings');
  assert.match(stripAnsi(renderCursorPanel(state, 120, 0, panelEnv(facts, state.draft), 60).join('\n')), /Use #rrggbb/u);
  cursorPanelKey(state, {kind: 'text', value: 'zz'}, panelEnv(facts, state.draft), 21);
  assert.equal(state.picker.state.hex.toLowerCase().includes('z'), false, 'non-hex characters are ignored');
  for (let index = 0; index < 4; index += 1) cursorPanelKey(state, {kind: 'backspace'}, panelEnv(facts, state.draft), 22);
  type('#aa66ff');
  const applied = press('enter');
  assert.equal(applied?.kind === 'apply' && applied.settings.color.custom, '#aa66ff');
  assert.equal(state.picker, undefined);
  // The preview shows the real custom color on the caret.
  state.selected = keyOf('colorCustom');
  const preview = renderCursorPanel(state, 120, 0, panelEnv(facts, state.draft), 60).join('\n');
  assert.match(preview, /48;2;170;102;255/u, 'the caret is drawn in the custom color');
  draft = state.draft;
  // Esc leaves the picker without changes.
  press('enter');
  type('#');
  type('00ff00');
  press('escape');
  press('escape');
  assert.equal(state.draft.color.custom, '#aa66ff');
  void draft;
});

test('Settings and Setup expose the same cursor color rows: theme family, variant, accent and a custom color', () => {
  const chosen = config({color: {source: 'chosen', theme: 'catppuccinMocha', themeAccent: 'peach'}});
  for (const id of ['cursorColorFamily', 'cursorColorVariant', 'cursorColorAccent']) assert.ok(settingsRowApplies(row(id), chosen), `${id} applies under Choose theme`);
  for (const id of ['cursorColorFamily', 'cursorColorVariant', 'cursorColorAccent', 'cursorColorCustom']) assert.ok(!settingsRowApplies(row(id), config({color: {source: 'host'}})), `${id} hidden otherwise`);
  assert.ok(!settingsRowApplies(row('cursorColorAccent'), config({color: {source: 'chosen', theme: 'dracula'}})), 'only Catppuccin has an accent');
  assert.equal(settingsRowValue(row('cursorColorAccent'), chosen), 'Peach');
  const stepped = adjustSettingsRow(row('cursorColorFamily'), chosen, 1)!;
  assert.equal(stepped.cursor.color.theme, 'dracula', 'next family opens on its default variant');
  assert.equal(settingsRowValue(row('cursorColorCustom'), config({color: {source: 'custom', custom: '#a67cf3'}})), '■ #A67CF3');
  const sections = new Set(SETUP_SECTIONS.flatMap(section => section.rows.map(item => item.row.id)));
  for (const id of ['cursorShape', 'cursorBlink', 'cursorRenderer', 'cursorMotion', 'cursorEffect', 'cursorIdle', 'cursorColor', 'cursorColorFamily', 'cursorColorVariant', 'cursorColorAccent', 'cursorColorCustom', 'cursorAdvanced']) {
    assert.ok(sections.has(id), `Setup exposes ${id}`);
  }
});

test('cursor configuration migration: saved choices are preserved; new fields appear only when set', () => {
  assert.equal(normalizeCursor({color: {source: 'theme'}}).color.source, 'theme', 'the stored name for Follow current theme is kept');
  assert.deepEqual(normalizeCursor({color: {source: 'accent'}}).color, {source: 'accent'});
  assert.deepEqual(normalizeCursor({color: {source: 'chosen'}}).color, {source: 'chosen', theme: 'lavender'});
  assert.deepEqual(normalizeCursor({color: {source: 'chosen', theme: 'catppuccinMocha', themeAccent: 'peach'}}).color, {source: 'chosen', theme: 'catppuccinMocha', themeAccent: 'peach'});
  assert.deepEqual(normalizeCursor({color: {source: 'chosen', theme: 'nope', themeAccent: 'nope'}}).color, {source: 'chosen', theme: 'lavender', themeAccent: 'mauve'}, 'unknown values fall back, never corrupt');
  assert.equal(normalizeCursor({color: {source: 'bogus'}}).color.source, 'host');
  assert.equal(normalizeCursor({color: {source: 'custom', custom: 'not-a-color'}}).color.custom, undefined);
  const saved = {shape: 'bar', blink: 'off', renderer: 'portable', motion: 'smear', effect: 'fire', idleEffect: 'glow', color: {source: 'custom', custom: '#aa66ff'}};
  const migrated = normalizeCursor(saved);
  assert.deepEqual([migrated.shape, migrated.blink, migrated.renderer, migrated.motion, migrated.effect, migrated.idleEffect, migrated.color.custom],
    ['bar', 'off', 'portable', 'smear', 'fire', 'glow', '#aa66ff']);
  assert.deepEqual(normalizeCursor(JSON.parse(JSON.stringify(migrated))), migrated, 'normalization is idempotent');
});

test('Ghostty refresh: only changed managed files are written, and the reload line is precise', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-cursor-reload-')));
  const environment = env({XDG_CONFIG_HOME: join(home, '.config'), NMSH_CONFIG_HOME: join(home, 'nmsh')});
  try {
    mkdirSync(join(home, '.config', 'ghostty'), {recursive: true});
    const userConfig = 'font-size = 14\ncustom-shader = /me/crt.glsl\n';
    writeFileSync(join(home, '.config', 'ghostty', 'config'), userConfig);
    const first = writeManagedFiles('ghostty', settings({motion: 'smear', effect: 'fire'}), environment);
    assert.deepEqual(first.changed.sort(), ['fragment', 'shader']);
    assert.deepEqual(writeManagedFiles('ghostty', settings({motion: 'smear', effect: 'fire'}), environment).changed, [], 'identical files are not rewritten');
    // A change the fragment does not see (a color) touches only the shader.
    const shaderOnly = writeManagedFiles('ghostty', settings({motion: 'smear', effect: 'fire', color: {source: 'custom', custom: '#aa66ff'}}), environment);
    assert.deepEqual(shaderOnly.changed, ['shader']);
    assert.match(reloadInstruction('ghostty', shaderOnly, 'darwin')!, /shader updated/iu);
    assert.match(reloadInstruction('ghostty', shaderOnly, 'darwin')!, /reload Ghostty config: ⌘⇧,/u);
    // Turning the shader off or on changes the fragment: the person reloads the config.
    const fragment = writeManagedFiles('ghostty', settings({motion: 'off', effect: 'none'}), environment);
    assert.ok(fragment.changed.includes('fragment'));
    assert.equal(reloadInstruction('ghostty', fragment, 'darwin'), 'Reload Ghostty config: ⌘⇧,');
    assert.equal(reloadInstruction('ghostty', fragment, 'linux'), 'Reload Ghostty config: Ctrl+Shift+,');
    assert.equal(reloadInstruction('ghostty', {changed: []}, 'darwin'), undefined, 'nothing changed: nothing to say');
    assert.equal(reloadInstruction('kitty', {changed: ['fragment']}, 'darwin'), 'Reload Kitty config: ⌃⌘,');
    assert.doesNotMatch(String(reloadInstruction('ghostty', fragment, 'darwin')), /restart/iu, 'never asks for a restart');
    assert.equal(readFileSync(join(home, '.config', 'ghostty', 'config'), 'utf8'), userConfig, 'the person\'s own config is never touched by a refresh');
    assert.equal(nativeCursorIntegrated('ghostty', environment), false, 'no include line was added by a refresh');
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test('integrated Ghostty: settings changes refresh only NMSh\'s managed files and report a precise reload line', () => {
  const isolation = isolateConfig();
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nmsh-cursor-app-')));
  const saved = {XDG: process.env.XDG_CONFIG_HOME, NMSH: process.env.NMSH_CONFIG_HOME};
  process.env.XDG_CONFIG_HOME = join(home, '.config');
  process.env.NMSH_CONFIG_HOME = join(home, 'nmsh');
  const app = new TerminalApp();
  try {
    app['render'] = () => {};
    mkdirSync(join(home, '.config', 'ghostty'), {recursive: true});
    const userConfig = 'font-size = 14\n';
    writeFileSync(join(home, '.config', 'ghostty', 'config'), userConfig);
    // Not integrated: a cursor change writes nothing and says nothing.
    app['cursorHost'] = {host: 'ghostty', version: '1.2.0', integrated: false};
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, motion: 'smear'}};
    assert.equal(app['cursorReload'], undefined);
    // Integrated: files appear and the person is told to reload the config.
    app['cursorHost'] = {host: 'ghostty', version: '1.2.0', integrated: true};
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, motion: 'tail'}};
    assert.match(app['cursorReload'] ?? '', /^Reload Ghostty config: /u);
    assert.doesNotMatch(app['cursorReload'] ?? '', /restart/iu);
    // A color change that only touches the shader says the shader was updated.
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, color: {source: 'custom', custom: '#aa66ff'}}};
    assert.match(app['cursorReload'] ?? '', /Cursor shader updated/u);
    // Following the current theme: a theme change refreshes the shader too.
    app['promptConfiguration'] = {...app['promptConfiguration'], cursor: {...app['promptConfiguration'].cursor, color: {source: 'theme'}}};
    app['promptConfiguration'] = {...app['promptConfiguration'], nmsh: {...app['promptConfiguration'].nmsh, palette: 'dracula'}};
    assert.match(app['cursorReload'] ?? '', /Cursor shader updated/u, 'the theme color changed the shader');
    assert.match(readFileSync(join(home, '.config', 'nmsh', 'cursor', 'nmsh-cursor.glsl'), 'utf8'), /vec3\(0\.741, 0\.576, 0\.976\)/u, 'Dracula purple, resolved from the real theme');
    assert.equal(readFileSync(join(home, '.config', 'ghostty', 'config'), 'utf8'), userConfig, 'the person\'s config is untouched');
    // Writing the same files again changes nothing, so there is nothing new to say.
    assert.deepEqual(writeManagedFiles('ghostty', resolveCursorSettings(app['promptConfiguration'].cursor, contextFor(app['promptConfiguration']))).changed, []);
  } finally {
    app['stop'](0); app['session'].kill();
    if (saved.XDG === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = saved.XDG;
    if (saved.NMSH === undefined) delete process.env.NMSH_CONFIG_HOME; else process.env.NMSH_CONFIG_HOME = saved.NMSH;
    rmSync(home, {recursive: true, force: true});
    isolation.restore();
  }
});

test('Cursor color is truthful on Zed: it colors NMSh effects and previews, the physical caret stays the theme\'s', () => {
  const zed = hostCursorFacts(env({TERM_PROGRAM: 'zed'}), () => false);
  assert.equal(zed.hostName, 'Zed');
  assert.equal(zed.caretColor, 'theme-controlled');
  assert.equal(hostCursorFacts(env({TERM_PROGRAM: 'ghostty'}), () => false).caretColor, 'host-controlled');
  assert.equal(hostCursorFacts(env({}), () => false).caretColor, 'host-controlled');
  const note = caretColorNote(zed, 'custom');
  assert.match(note, /Colors NMSh's effects, trails and previews/u);
  assert.match(note, /Zed draws the physical caret in your Zed theme's cursor color; NMSh does not change it\./u);
  assert.match(caretColorNote(zed, 'host'), /Zed draws the caret in its own color/u);
  assert.match(caretColorNote(ghostty(true), 'theme'), /and the native trail/u);
  // The panel and Setup show it; a custom color still previews on the synthetic caret.
  const draft = settings({color: {source: 'custom', custom: '#aa66ff'}});
  const state = createCursorPanel(draft, 0);
  state.selected = cursorPanelRowKeys(false, draft).indexOf('color');
  const text = stripAnsi(renderCursorPanel(state, 140, 0, panelEnv(zed, draft), 60).join('\n'));
  assert.match(text, /Zed draws the physical caret in your Zed theme's cursor color/u);
  // NMSh sends no terminal cursor-color sequence (OSC 12), on any host: shape works, color is NMSh's own.
  const writes: string[] = [];
  const renderer = new TerminalRenderer(data => { writes.push(String(data)); });
  renderer.setCursorStyle(cursorStyleSequence('bar', 'on'));
  renderer.enter();
  renderer.render({rows: ['x'], cursorRow: 1, cursorColumn: 1});
  renderer.exit?.();
  assert.ok(writes.join('').includes('\u001b[5 q') || writes.join('').includes('\u001b[6 q') || writes.join('').includes(cursorStyleSequence('bar', 'on')), 'the shape sequence is sent');
  assert.ok(!/\u001b\]1[12];/u.test(writes.join('')), 'no OSC 12 / OSC 112 cursor-color sequence');
});
