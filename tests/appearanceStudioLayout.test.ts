import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {createGhosttyShaderPanel, renderGhosttyShaderPanel, ghosttyShaderKey} from '../src/appearance/GhosttyShaderPanel.js';
import {buildGhosttyCatalog} from '../src/appearance/ghosttyShaderCatalog.js';
import {DEFAULT_PROMPT_CONFIGURATION as DEFAULT} from '../src/prompt/configuration.js';
import {stripAnsi, displayWidth} from '../src/util/text.js';
import {createKittyShaderPanel, renderKittyShaderPanel, kittyShaderKey} from '../src/appearance/KittyShaderPanel.js';
import {buildKittyCatalog} from '../src/appearance/kittyShaderCatalog.js';
import {studioPreviewContext} from '../src/appearance/ShaderStudioPanel.js';
import {renderStudioReview, studioWrap} from '../src/ui/StudioLayout.js';

const sizes = [[120, 40], [80, 24], [60, 20], [40, 14]] as const;
const gates = {reducedMotion: false, effectsOff: false, cursorRenderer: 'auto' as const, cursorMotion: 'tail' as const};
test('shader browser offers category jumps and visible focus with a persistent footer at every size', () => {
  const s = createGhosttyShaderPanel(DEFAULT.hostShaders.ghostty, gates);
  s.catalog = buildGhosttyCatalog('1.3.1');
  ghosttyShaderKey(s, {kind: 'complete'});
  for (const [w, h] of sizes) {
    const rows = renderGhosttyShaderPanel(s, w, h);
    const plain = rows.map(stripAnsi);
    assert.ok(plain.some(row => row.startsWith('›') && row.includes('Aurora')), 'Tab jumps to the next category');
    assert.ok(plain.at(-1)?.includes('Esc'));
    assert.ok(rows.length <= h && rows.every(row => displayWidth(row) <= w));
  }
});
test('hub preserves focused host editing and wrapped actions at every size', () => {
  const s = createAppearanceHub('Host', {opacity: 0.9, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0});
  s.selected = 9;
  for (const [w, h] of sizes) {
    const rows = renderAppearanceHub(s, DEFAULT, w, 'Native', 'Portable', undefined, h);
    assert.ok(rows.map(stripAnsi).some(row => row.startsWith('›') && row.includes('Opacity')));
    assert.match(stripAnsi(rows.join('\n')), /S review/);
    assert.ok(rows.at(-1)?.includes('Esc'));
    assert.ok(rows.length <= h && rows.every(row => displayWidth(row) <= w));
  }
});

const resources = {
  'types.slang': '// types',
  'cursor-trail-blaze.pipeline': 'startgroup\nshaders cursor-trail-blaze\nendgroup\n',
  'cursor-trail-blaze.slang': 'static const float DURATION = 0.5;\nstatic const float4 TRAIL_COLOR = float4(1.0, 0.725, 0.161, 1.0);\n',
  'spotlight.pipeline': 'startgroup\nshaders spotlight\nendgroup\n',
  'spotlight.slang': 'static const float SPOTLIGHT_RADIUS = 0.25;\nstatic const float AMBIENT_LIGHT = 0.5;\n',
};
const plan = {preview: ['File: /private/config', '+ include nmsh.conf', 'Also changes /cursor Motion: Off → Tail',
  'Also changes /cursor renderer: Portable → Auto', "Turns Kitty's cursor_trail on (3; it would be 0)", 'Notes: Keep existing passes in their original order.',
  '+ ' + 'long exact diff contents '.repeat(30), 'End of exact plan'], guidance: 'Effective after configuration reload; written is not loaded.'};

test('review wrapping retains every plan character, including long lines and cursor side effects', () => {
  for (const [w, h] of sizes) {
    for (const line of plan.preview) {
      const wrapped = studioWrap(line, w - 4);
      assert.equal(wrapped.join(''), line);
      assert.ok(wrapped.every(row => displayWidth(row) <= w - 4));
    }
    const review = {plan, offset: 0};
    const rows = renderStudioReview(review, 'Review configuration', w, h).map(stripAnsi);
    assert.match(rows.join('\n'), /Enter confirm write[\s\S]*Esc cancel/);
    assert.ok(rows.length <= h && rows.every(row => displayWidth(row) <= w));
  }
});

for (const color of ['truecolor', '16', 'none']) test(`both shader studios retain focus, actions and safe review routing (${color})`, () => {
  const savedColor = process.env.NMSH_COLOR, savedNoColor = process.env.NO_COLOR;
  if (color === 'none') { delete process.env.NMSH_COLOR; process.env.NO_COLOR = '1'; }
  else process.env.NMSH_COLOR = color;
  try {
    for (const [w, h] of sizes) {
      const hub = createAppearanceHub('Host', {opacity: 0.8, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0});
      hub.selected = 9;
      const rows = renderAppearanceHub(hub, DEFAULT, w, 'Native', 'Portable', undefined, h);
      assert.ok(rows.length <= h && rows.every(row => displayWidth(row) <= w));
      assert.ok(rows.map(stripAnsi).some(row => row.startsWith('›') && row.includes('Opacity')));
      assert.match(stripAnsi(rows.at(-1)!), /Esc/);
      hub.confirmation = {plan: structuredClone(plan) as never, offset: 0};
      const review = renderAppearanceHub(hub, DEFAULT, w, 'Native', 'Portable', undefined, h);
      assert.ok(review.length <= h && review.every(row => displayWidth(row) <= w));
      assert.match(stripAnsi(review.join('\n')), /Enter confirm write[\s\S]*Esc cancel/);
    }
    for (const host of ['kitty', 'ghostty'] as const) {
      const state = host === 'kitty' ? createKittyShaderPanel(DEFAULT.hostShaders.kitty, gates) : createGhosttyShaderPanel(DEFAULT.hostShaders.ghostty, gates);
      // The renderer/key wrappers share one state contract; the catalog is the host's real parser result.
      const render = (w: number, h: number) => host === 'kitty'
        ? renderKittyShaderPanel(state as ReturnType<typeof createKittyShaderPanel>, w, h, studioPreviewContext(100, false, color !== 'none'))
        : renderGhosttyShaderPanel(state as ReturnType<typeof createGhosttyShaderPanel>, w, h, studioPreviewContext(100, false, color !== 'none'));
      const key = (k: Parameters<typeof ghosttyShaderKey>[1]) => host === 'kitty' ? kittyShaderKey(state as ReturnType<typeof createKittyShaderPanel>, k) : ghosttyShaderKey(state as ReturnType<typeof createGhosttyShaderPanel>, k);
      const check = (w: number, h: number, focus = true) => {
        const rows = render(w, h), plain = rows.map(stripAnsi);
        assert.ok(rows.length <= h, `${host} ${w}x${h} height`);
        assert.ok(rows.every(row => displayWidth(row) <= w), `${host} ${w}x${h} width`);
        assert.match(plain.at(-1)!, /Esc/);
        if (focus) assert.ok(plain.some(row => row.startsWith('›')), `${host} ${w}x${h} focus`);
        return plain;
      };
      for (const [w, h] of sizes) check(w, h);
      state.catalog = (host === 'kitty' ? buildKittyCatalog('0.49.2', resources) : buildGhosttyCatalog('1.3.1')) as typeof state.catalog;
      for (const [w, h] of sizes) {
        check(w, h);
        assert.deepEqual(key({kind: 'text', value: 's'}), {kind: 'review'});
      }
      // Toggle the first preset (Kitty starts on placement), then visit every parameter.
      if (host === 'kitty') key({kind: 'down'});
      key({kind: 'enter'});
      for (let i = 0; i < 12; i++) { for (const [w, h] of sizes) check(w, h); key({kind: 'down'}); }
      for (const [w, h] of sizes) {
        state.confirmation = {plan: structuredClone(plan) as never, offset: 0};
        const seen: string[] = [];
        for (let scroll = 0; scroll < 80; scroll++) { seen.push(...check(w, h, false)); key({kind: 'down'}); }
        assert.match(seen.join('\n'), /End of exact plan/);
        assert.match(seen.join('\n'), /Also changes \/cursor/);
        assert.deepEqual(key({kind: 'enter'}), {kind: 'confirm'});
        const draft = structuredClone(state.draft);
        assert.equal(key({kind: 'escape'}), undefined);
        assert.equal(state.confirmation, undefined);
        assert.deepEqual(state.draft, draft, 'cancel does not apply draft or write');
      }
      state.catalog!.supported = false; state.catalog!.reason = 'Unsupported host version';
      for (const [w, h] of sizes) { check(w, h); assert.equal(key({kind: 'text', value: 's'}), undefined); }
      assert.deepEqual(key({kind: 'text', value: 'r'}), {kind: 'remove'});
      assert.deepEqual(key({kind: 'escape'}), {kind: 'back'});
    }
  } finally {
    if (savedColor === undefined) delete process.env.NMSH_COLOR; else process.env.NMSH_COLOR = savedColor;
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
  }
});

test('review fixes: an unseen plan cannot be confirmed; Shift+Tab from Placement; indented wrap; long notices end with an ellipsis', () => {
  // Too small to show the plan: no "confirm write" is offered and Enter does nothing; a usable size makes Enter confirm again.
  const s = createGhosttyShaderPanel(DEFAULT.hostShaders.ghostty, gates);
  s.catalog = buildGhosttyCatalog('1.3.1');
  s.confirmation = {plan: {...plan, preview: ['+ custom-shader = x']} as never, offset: 0};
  const tiny = renderGhosttyShaderPanel(s, 40, 6).map(stripAnsi).join('\n');
  assert.match(tiny, /Resize to review/u);
  assert.doesNotMatch(tiny, /confirm write/u);
  assert.equal(ghosttyShaderKey(s, {kind: 'enter'} as never), undefined);
  assert.ok(s.confirmation, 'still reviewing');
  renderGhosttyShaderPanel(s, 80, 24);
  assert.equal(ghosttyShaderKey(s, {kind: 'enter'} as never)?.kind, 'confirm');
  // Kitty's Placement row has no category: Shift+Tab goes to the last category, Tab to the first.
  const k = createKittyShaderPanel(DEFAULT.hostShaders.kitty, gates);
  k.catalog = buildKittyCatalog('0.49.2', resources);
  k.selected = 0;
  kittyShaderKey(k, {kind: 'focusPrevious'} as never);
  assert.ok(renderKittyShaderPanel(k, 120, 40).map(stripAnsi).some(row => row.startsWith('›') && row.includes('Spotlight')), 'Shift+Tab from Placement selects the last category');
  k.selected = 0;
  kittyShaderKey(k, {kind: 'complete'} as never);
  assert.ok(renderKittyShaderPanel(k, 120, 40).map(stripAnsi).some(row => row.startsWith('›') && row.includes('Blaze')), 'Tab from Placement selects the first category');
  // An indented long word splits instead of leaving a row of spaces; ordinary text still breaks at spaces.
  assert.ok(studioWrap('  /a/very/long/path/name', 10).every(row => row.trim().length > 0));
  assert.deepEqual(studioWrap('alpha beta gamma', 11), ['alpha beta ', 'gamma']);
  // A notice longer than its rows ends with an ellipsis.
  const g = createGhosttyShaderPanel(DEFAULT.hostShaders.ghostty, gates);
  g.catalog = buildGhosttyCatalog('1.3.1');
  g.message = 'word '.repeat(80);
  assert.ok(renderGhosttyShaderPanel(g, 60, 20).map(stripAnsi).some(row => row.trimEnd().endsWith('…')));
});
