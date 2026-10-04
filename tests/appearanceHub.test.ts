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
  for (const label of ['Prompt & theme', 'Cursor & effects', 'UI chrome', 'Chroma', 'Motion']) assert.match(rendered, new RegExp(label, 'u'));
  assert.match(rendered, /Host\s+Zed/u);
  assert.match(rendered, /controlled by Zed/u);
  assert.doesNotMatch(rendered, /Opacity\s+█/u);
});

test('host with appearance integration keeps opacity/blur editing; Enter saves only after a change', () => {
  const hub = createAppearanceHub('Ghostty-like host', {opacity: 0.9, blurModeIndex: 0, blurStrength: 20, selectedIndex: 0});
  const rendered = text(renderAppearanceHub(hub, config(), 100, 'Lavender Native', 'Portable'));
  assert.match(rendered, /Opacity\s+█+░*\s+90%/u);
  hub.selected = 5; // first host row
  assert.equal(appearanceHubKey(hub, {kind: 'enter'}, config()), undefined, 'nothing to save yet');
  appearanceHubKey(hub, {kind: 'right'}, config());
  assert.equal(hub.host!.opacity, 0.95);
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'saveHost'});
});

test('NMSh rows open the canonical editors; Motion opens the general motion screen', () => {
  const hub = createAppearanceHub('Zed');
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'prompt'});
  hub.selected = 1;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'cursor'});
  hub.selected = 3;
  assert.deepEqual(appearanceHubKey(hub, {kind: 'enter'}, config()), {kind: 'open', destination: 'chroma'});
  hub.selected = 4;
  assert.equal(appearanceHubKey(hub, {kind: 'enter'}, config()), undefined);
  assert.equal(hub.view, 'motion');
  const motion = text(renderAppearanceHub(hub, config(), 100, 'Lavender Native', 'Portable'));
  for (const label of ['Context transitions', 'Command launch', 'Completion highlight', 'Command completion', 'Event feedback']) assert.match(motion, new RegExp(label, 'u'));
  assert.doesNotMatch(motion, /Stiffness|Trail length/u, 'cursor physics stay in /cursor');
  const change = appearanceHubKey(hub, {kind: 'right'}, config());
  assert.equal(change?.kind === 'motion' && change.motion.contextTransitions, 'expressive');
  appearanceHubKey(hub, {kind: 'escape'}, config());
  assert.equal(hub.view, 'hub');
});
