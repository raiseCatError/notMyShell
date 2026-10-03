import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, NATIVE_PALETTE_IDS, normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextLine, moduleShowcaseContext, nativePromptSnapshot, renderedModules, themeChromaStops, themePreviewContext, vibrantRoleColors,
  NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';
import {PROMPT_STYLES, type PromptStyle} from '../src/prompt/styles.js';
import {appearanceRows, chromaRows, handlePromptPanelKey, styleRows, type PromptPanelState} from '../src/prompt/PromptPanel.js';
import {renderHistoricalContext} from '../src/output/OutputBuffer.js';
import {applyVibrance, contrastRatio, toOklch} from '../src/chroma/color.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const PRIVATE_USE = /[-]/u;
const withStyle = (style: PromptStyle, extra: Partial<PromptConfiguration['nmsh']> = {}): PromptConfiguration => {
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  config.nmsh = {...config.nmsh, style, ...extra};
  return config;
};
const showcase = (config: PromptConfiguration) => {
  const copy = structuredClone(config);
  copy.modules = copy.modules.map(module => ({...module, visible: true}));
  return copy;
};
const BG = /\u001B\[48;2;(\d+);(\d+);(\d+)m/gu;
const backgrounds = (ansi: string) => [...ansi.matchAll(BG)].map(match => ({red: +match[1]!, green: +match[2]!, blue: +match[3]!}));

test('migration: an old config keeps Powerline storage untouched and seeds other styles from the legacy gap/spacing', () => {
  const legacy = {nmsh: {style: 'outline', gapEnabled: true, startStyle: 'flat', connector: 'rounded', endStyle: 'wedge'}, gap: 2, spacing: 2};
  const config = normalizePromptConfiguration(legacy);
  assert.equal(config.nmsh.vibrance, 'standard', 'existing appearance maps to Standard');
  assert.deepEqual([config.nmsh.startStyle, config.nmsh.connector, config.nmsh.endStyle, config.gap, config.spacing], ['flat', 'rounded', 'wedge', 2, 2]);
  assert.deepEqual(config.nmsh.styleProfiles.outline, {cap: 'rounded', layout: 'separated', gap: 2, padding: 2});
  assert.deepEqual(config.nmsh.styleProfiles.soft.gap, 2);
  assert.equal(config.nmsh.styleProfiles.minimal.spacing, 3, 'Minimal kept its legacy gap + 1 spacing');
  // An upgraded Outline prompt renders exactly as the legacy shared-geometry render.
  const legacyRender = buildContextLine(themePreviewContext(), 120, {...config, nmsh: {...config.nmsh, styleProfiles: normalizePromptConfiguration({gap: 2, spacing: 2}).nmsh.styleProfiles}});
  assert.equal(buildContextLine(themePreviewContext(), 120, config), legacyRender);
  const defaults = normalizePromptConfiguration({});
  assert.deepEqual(defaults.nmsh.styleProfiles, DEFAULT_PROMPT_CONFIGURATION.nmsh.styleProfiles);
});

test('style profiles are independent: editing one style never changes another, and switching back restores it', () => {
  const state: PromptPanelState = {onboarding: false, step: 'appearance', selectedIndex: 0, draft: withStyle('soft'), saved: withStyle('soft')};
  const softGap = appearanceRows(state.draft).findIndex(row => row.id === 'soft.gap');
  state.selectedIndex = softGap;
  handlePromptPanelKey({kind: 'right'} as Key, state);
  assert.equal(state.draft.nmsh.styleProfiles.soft.gap, 2);
  const before = structuredClone(state.draft.nmsh.styleProfiles.outline);
  const powerline = [state.draft.nmsh.startStyle, state.draft.gap, state.draft.spacing];
  state.draft.nmsh.style = 'outline';
  state.selectedIndex = appearanceRows(state.draft).findIndex(row => row.id === 'outline.padding');
  handlePromptPanelKey({kind: 'right'} as Key, state);
  assert.notDeepEqual(state.draft.nmsh.styleProfiles.outline, before);
  state.draft.nmsh.style = 'soft';
  assert.equal(state.draft.nmsh.styleProfiles.soft.gap, 2, 'Soft kept its own gap');
  assert.deepEqual([state.draft.nmsh.startStyle, state.draft.gap, state.draft.spacing], powerline, 'Powerline geometry untouched');
  const saved = normalizePromptConfiguration(JSON.parse(JSON.stringify(state.draft)));
  assert.deepEqual(saved.nmsh.styleProfiles, state.draft.nmsh.styleProfiles, 'profiles persist');
});

test('each style shows only controls that change it; every shown control changes the render', () => {
  const ids = (config: PromptConfiguration) => styleRows(config).map(row => row.id);
  assert.deepEqual(ids(withStyle('powerline')), ['start', 'connector', 'connectorFade', 'fadeColors', 'gap', 'end', 'padding'].filter(id => id !== 'fadeColors'),
    'Fade colors hides while Connector fade is Off');
  assert.ok(!ids(normalizePromptConfiguration({nmsh: {gapEnabled: false}})).includes('connectorFade'), 'no gap: no connector fade');
  for (const style of PROMPT_STYLES) {
    assert.ok(!ids(withStyle(style)).some(id => style !== 'powerline' && ['start', 'connector', 'end', 'connectorFade'].includes(id)),
      `${style} shows no Powerline geometry`);
  }
  const connected = withStyle('soft');
  connected.nmsh.styleProfiles.soft.layout = 'connected';
  assert.ok(!ids(connected).includes('soft.gap'), 'a connected capsule has no gap');
  for (const style of PROMPT_STYLES) {
    for (const row of styleRows(withStyle(style))) {
      const config = showcase(withStyle(style));
      const before = buildContextLine(moduleShowcaseContext(), 200, config, 'composer');
      row.change!(config, 1);
      assert.notEqual(buildContextLine(moduleShowcaseContext(), 200, config, 'composer'), before, `${style} ${row.id} changes the render`);
    }
  }
});

test('every style: Nerd and Safe glyphs, left and right modules, one- and two-line, narrow fitting and history', () => {
  for (const glyphs of ['nerd', 'safe'] as const) {
    setIconStyle(glyphs);
    try {
      for (const style of PROMPT_STYLES) {
        const config = showcase(withStyle(style));
        config.modules = config.modules.map(module => module.id === 'gitBranch' || module.id === 'toolchain' ? {...module, placement: 'right' as const} : module);
        for (const layout of ['twoLine', 'oneLine'] as const) {
          config.composerLayout = layout;
          for (const width of [6, 14, 30, 60, 140]) {
            const line = buildContextLine(moduleShowcaseContext(), width, config, layout === 'oneLine' ? 'composer' : 'header');
            assert.ok(displayWidth(line) <= width, `${glyphs} ${style} ${layout} @${width}`);
            if (glyphs === 'safe') assert.doesNotMatch(line, PRIVATE_USE, `${style} safe @${width}`);
          }
        }
        const wide = stripAnsi(buildContextLine(moduleShowcaseContext(), 200, config, 'composer'));
        assert.match(wide, /notMyShell/u, `${style} left`);
        assert.match(wide, /feature\/example/u, `${style} right`);
        const snapshot = nativePromptSnapshot(moduleShowcaseContext(), config);
        const header = renderHistoricalContext({cwd: '/tmp', prompt: snapshot}, 120)!;
        assert.ok(displayWidth(header.plain) <= 120);
        assert.match(header.plain, /notMyShell/u, `${style} history`);
      }
    } finally { setIconStyle('nerd'); }
  }
});

test('history replays the submitted style profile even after the live profile changes', () => {
  const config = withStyle('outline');
  config.nmsh.styleProfiles.outline.cap = 'square';
  const snapshot = nativePromptSnapshot(themePreviewContext(), config);
  assert.equal(snapshot.styleProfile && 'cap' in snapshot.styleProfile ? snapshot.styleProfile.cap : undefined, 'square');
  config.nmsh.styleProfiles.outline.cap = 'rounded';
  assert.match(renderHistoricalContext({cwd: '/tmp', prompt: snapshot}, 120)!.plain, /\[ notMyShell \]/u);
  assert.equal(nativePromptSnapshot(themePreviewContext(), withStyle('powerline')).styleProfile, undefined, 'Powerline snapshots unchanged');
});

test('distinct styles: fills only where the style has them', () => {
  const fill = (style: PromptStyle) => backgrounds(buildContextLine(themePreviewContext(), 160, withStyle(style), 'composer')).length > 0;
  for (const style of ['powerline', 'soft', 'compact', 'ribbon', 'breadcrumb'] as const) assert.ok(fill(style), `${style} fills`);
  for (const style of ['minimal', 'outline'] as const) assert.ok(!fill(style), `${style} has no fills`);
  const ribbon = new Set(backgrounds(buildContextLine(themePreviewContext(), 160, withStyle('ribbon'), 'composer')).map(color => JSON.stringify(color)));
  assert.equal(ribbon.size, 1, 'Ribbon is one band');
  const renders = new Set(PROMPT_STYLES.map(style => stripAnsi(buildContextLine(themePreviewContext(), 160, withStyle(style), 'composer'))));
  assert.equal(renders.size, PROMPT_STYLES.length, 'no two styles are cosmetic aliases');
});

test('vibrance: Standard is identity; Soft/Vibrant keep hue and readable text; Vibrant separates neighbors more', () => {
  for (const palette of NATIVE_PALETTE_IDS) {
    for (const role of ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes', 'success', 'failure'] as const) {
      const standard = vibrantRoleColors(role, palette, 'semantic', 'standard');
      assert.deepEqual(standard, NATIVE_PROMPT_THEMES[palette].colors(role));
      for (const level of ['soft', 'vibrant'] as const) {
        const colors = vibrantRoleColors(role, palette, 'semantic', level);
        assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5, `${palette} ${role} ${level} contrast`);
        const a = toOklch(standard.background), b = toOklch(colors.background);
        if (a.c > 0.04) assert.ok(Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) < 12, `${palette} ${role} ${level} hue kept`);
      }
    }
    const spread = (level: 'soft' | 'standard' | 'vibrant') => {
      const roles = ['project', 'cwd', 'gitBranch', 'node', 'go'] as const;
      let total = 0;
      for (let index = 1; index < roles.length; index += 1) {
        const x = toOklch(vibrantRoleColors(roles[index]!, palette, 'semantic', level).background);
        const y = toOklch(vibrantRoleColors(roles[index - 1]!, palette, 'semantic', level).background);
        total += Math.abs(x.l - y.l) + Math.hypot(x.c - y.c);
      }
      return total;
    };
    // High Contrast Neon already sits at the sRGB gamut edge: Vibrant can only hold it.
    if (palette !== 'highContrast') assert.ok(spread('vibrant') > spread('standard'), `${palette} vibrant`);
    assert.ok(spread('standard') > spread('soft'), `${palette} soft`);
  }
});

test('vibrance never rewrites explicit module colors or semantic Rich Git colors', () => {
  const config = normalizePromptConfiguration({nmsh: {vibrance: 'vibrant'}, modules: [{id: 'project', visible: true, condition: 'always', background: '#123456', foreground: '#fedcba'}]});
  const project = renderedModules(themePreviewContext(), config).find(module => module.role === 'project')!;
  assert.deepEqual(project.background, {red: 0x12, green: 0x34, blue: 0x56});
  assert.deepEqual(project.foreground, {red: 0xfe, green: 0xdc, blue: 0xba});
  const staged = renderedModules(themePreviewContext(), config).find(module => module.role === 'gitStaged')!;
  assert.deepEqual(staged.background, renderedModules(themePreviewContext(), normalizePromptConfiguration({})).find(module => module.role === 'gitStaged')!.background);
  assert.deepEqual(applyVibrance({red: 10, green: 20, blue: 30}, 'standard'), {red: 10, green: 20, blue: 30});
});

test('new themes are complete, readable and not near-duplicates of each other', () => {
  const roles = ['project', 'cwd', 'gitBranch', 'node', 'go', 'python', 'docker', 'kubernetes', 'success', 'failure'] as const;
  for (const palette of NATIVE_PALETTE_IDS) {
    for (const role of roles) {
      const colors = NATIVE_PROMPT_THEMES[palette].colors(role);
      assert.ok(colors.background && colors.foreground, `${palette} ${role}`);
    }
  }
  for (const palette of ['aurora', 'ocean', 'sunset', 'forest', 'rose', 'nebula', 'highContrast'] as const) {
    for (const role of roles) {
      const colors = NATIVE_PROMPT_THEMES[palette].colors(role);
      assert.ok(contrastRatio(colors.foreground, colors.background) >= 4.5, `${palette} ${role}`);
    }
    for (const other of NATIVE_PALETTE_IDS.filter(id => id !== palette)) {
      const distance = roles.reduce((sum, role) => {
        const a = toOklch(NATIVE_PROMPT_THEMES[palette].colors(role).background), b = toOklch(NATIVE_PROMPT_THEMES[other].colors(role).background);
        return sum + Math.abs(a.l - b.l) + Math.min(Math.abs(a.h - b.h), 360 - Math.abs(a.h - b.h)) / 360 + Math.abs(a.c - b.c);
      }, 0) / roles.length;
      assert.ok(distance > 0.08, `${palette} vs ${other} too similar (${distance.toFixed(3)})`);
    }
  }
  for (const palette of NATIVE_PALETTE_IDS) assert.ok(themeChromaStops(palette).length >= 1, palette);
});

test('the /prompt Main Prompt row order and Chroma rows hide meaningless controls', () => {
  assert.deepEqual(appearanceRows(withStyle('minimal')).map(row => row.id),
    ['themeFamily', 'themeVariant', 'style', 'vibrance', 'minimal.separator', 'minimal.spacing', 'minimal.emphasis', 'icons', 'promptSymbol', 'modules']);
  const config = structuredClone(DEFAULT_PROMPT_CONFIGURATION);
  assert.deepEqual(chromaRows(config).map(row => row.id), ['preset'], 'Off shows only the palette');
  config.presentation.preset = 'aurora';
  assert.deepEqual(chromaRows(config).map(row => row.id), ['preset', 'influence', 'scope', 'geometry', 'motion']);
  config.presentation.motion = 'breathe';
  assert.deepEqual(chromaRows(config).map(row => row.id).slice(-2), ['speed', 'curve'], 'Breathe has no direction');
  config.presentation.motion = 'comet';
  assert.equal(chromaRows(config).at(-1)!.id, 'direction');
  config.modules[0] = {...config.modules[0]!, background: '#202020'};
  assert.equal(chromaRows(config).at(-1)!.id, 'customColors', 'only offered when a module has explicit colors');
});
