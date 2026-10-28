import test from 'node:test';
import assert from 'node:assert/strict';
import {appearanceHubKey, createAppearanceHub, renderAppearanceHub} from '../src/appearance/AppearanceHub.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {stripAnsi} from '../src/util/text.js';

const config = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const text = (rows: string[]) => stripAnsi(rows.join('\n'));

test('/appearance always offers the NMSh rows, with or without host integration', () => {
  const zed = createAppearanceHub('Zed', undefined, 'Opacity and blur are controlled by Zed.');
  const rendered = text(renderAppearanceHub(zed, config(), 100, 'Lavender Native', 'Portable'));
  for (const label of ['Theme Studio', 'Prompt', 'Cursor & effects', 'UI chrome', 'Chroma', 'Motion', 'Theme Bridge']) assert.match(rendered, new RegExp(label, 'u'));
  assert.doesNotMatch(rendered, /Prompt & theme/u, 'themes are not presented as prompt-only');
  assert.match(rendered, /Theme Bridge\s+Off · every tool Independent/u);
  assert.match(rendered, /Terminal\s+Zed/u);
  assert.match(rendered, /controlled by Zed/u);
  assert.doesNotMatch(rendered, /Opacity\s+█/u);
});

test('host with appearance integration keeps opacity/blur editing; Enter saves only after a change', () => {
  const hub = createAppearanceHub('Ghostty-like host', {opacity: 0.9, blurModeIndex: 0, blurStrength: 20, selectedIndex: 0});
  const rendered = text(renderAppearanceHub(hub, config(), 100, 'Lavender Native', 'Portable'));
  assert.match(rendered, /Opacity\s+█+░*\s+90%/u);
  hub.selected = 9; // first host row
  assert.equal(appearanceHubKey(hub, {kind: 'enter'}, config()), undefined, 'nothing to save yet');
  appearanceHubKey(hub, {kind: 'right'}, config());
  assert.equal(hub.host!.opacity, 0.95);
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'saveHost'});
});

test('NMSh rows open the canonical editors; Motion opens the general motion screen', () => {
  const hub = createAppearanceHub('Zed');
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'theme'});
  hub.selected = 1;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'prompt'});
  hub.selected = 2;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'cursor'});
  hub.selected = 4;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'chroma'});
  hub.selected = 6;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'themeBridge'});
  hub.selected = 5;
  assert.equal(appearanceHubKey(hub, {kind: 'enter'}, config()), undefined);
  assert.equal(hub.view, 'motion');
  const motion = text(renderAppearanceHub(hub, config(), 100, 'Lavender Native', 'Portable'));
  for (const label of ['Context transitions', 'Command launch', 'Completion highlight', 'Command completion', 'Event feedback']) assert.match(motion, new RegExp(label, 'u'));
  assert.doesNotMatch(motion, /Stiffness|Trail length/u, 'cursor physics stay in /cursor');
  assert.match(motion, /Rendering\s+‹ Rich ›/u, 'Rendering is the first Motion choice');
  assert.match(motion, /Advanced\s+Rich tuning ›/u);
  appearanceHubKey(hub, {kind: 'down'}, config());
  const change = appearanceHubKey(hub, {kind: 'right'}, config());
  assert.equal(change?.kind === 'motion' && change.motion.contextTransitions, 'off');
  appearanceHubKey(hub, {kind: 'escape'}, config());
  assert.equal(hub.view, 'hub');
  assert.equal(hub.selected, 5, 'back on the Motion row');
});


test('host save preview owns input; Escape cancels and Enter alone confirms', () => {
  const hub = createAppearanceHub('Host', {opacity: 1, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0});
  hub.confirmation = {plan: {preview: ['File: private/config', '+ background-opacity = 0.65'], guidance: 'Reload required'} as any, offset: 0};
  const rows = text(renderAppearanceHub(hub, config(), 64, 'Theme', 'Portable', undefined, 12));
  assert.match(rows, /Review host configuration/u);
  assert.match(rows, /background-opacity = 0.65/u);
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'confirmHost'});
  assert.equal(appearanceHubKey(hub, {kind: 'escape'}, config()), undefined);
  assert.equal(hub.confirmation, undefined);
  assert.equal(hub.view, 'hub');
});

test('restore is a separate review action and background input accepts only RGB', () => {
  const hub = createAppearanceHub('Host', {opacity: 1, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0});
  assert.deepEqual(appearanceHubKey(hub, {kind: 'text', value: 'r'}, config()), {kind: 'restoreHost'});
  hub.selected = 11; // background after opacity/blur
  appearanceHubKey(hub, {kind: 'enter'}, config());
  appearanceHubKey(hub, {kind: 'text', value: '123abc'}, config());
  appearanceHubKey(hub, {kind: 'enter'}, config());
  assert.equal(hub.host?.background, '#123abc');
  assert.equal(hub.hostDirty, true);
});


test('short appearance panels keep the selected host control and navigation visible', () => {
  const hub = createAppearanceHub('Host', {opacity: 0.8, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0});
  hub.selected = 9;
  const rows = renderAppearanceHub(hub, config(), 45, 'Theme', 'Portable', undefined, 8);
  assert.ok(rows.length <= 8);
  assert.match(text(rows), /Opacity/u);
  assert.match(text(rows), /Esc/u);
});


test('Motion R remains replay on integrated hosts; large existing blur values do not crash', () => {
  const hub = createAppearanceHub('Host', {opacity: 1, blurModeIndex: 1, blurStrength: 75, selectedIndex: 0});
  assert.doesNotThrow(() => renderAppearanceHub(hub, config(), 70, 'Theme', 'Portable'));
  hub.view = 'motion'; hub.selected = 1;
  assert.equal(appearanceHubKey(hub, {kind: 'text', value: 'r'}, config(), 123), undefined);
  assert.equal(hub.previewStart, 123);
});


test('configuration-derived background cannot emit OSC controls from the hub', () => {
  const hub = createAppearanceHub('Host', {opacity: 1, blurModeIndex: 0, blurStrength: 0, selectedIndex: 0, background: 'black\u001b]52;c;bad\u0007'});
  assert.doesNotMatch(renderAppearanceHub(hub, config(), 100, 'Theme', 'Portable').join('\n'), /\u001b\]52/u);
});


test('Welcome summary uses the provider display label', () => {
  const configuration = config(); configuration.welcome = 'fastfetch';
  assert.match(text(renderAppearanceHub(createAppearanceHub('generic'), configuration, 100, 'Theme', 'Portable')), /Welcome.*Fastfetch/);
});
