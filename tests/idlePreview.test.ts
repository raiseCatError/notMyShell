import test from 'node:test';
import assert from 'node:assert/strict';
import {CellGrid} from '../src/idle/CellGrid.js';
import {idleFrameRows, idlePreviewRows, previewSaver, RANDOM_PREVIEW_DWELL_MS, sampleCapture} from '../src/idle/IdleVisuals.js';
import {idlePalette, randomCandidates, SCREEN_MODE_EFFECT, type IdleMode} from '../src/idle/scenes.js';
import {stripAnsi} from '../src/util/text.js';

/**
 * Setup's and the color editor's screen saver previews: the screen-animating savers (Black Hole, Fireworks,
 * Circletastic, raiseCatError) run on a sample screen instead of falling back to the star field, and Random shows the
 * savers it can actually choose, in turn.
 */
const palette = idlePalette(['#a67cf3', '#7aa2f7', '#f7768e'].map(hex => parseInt(hex.slice(1), 16)) as never);
const base = {width: 40, height: 8, palette, level: 'truecolor' as const, nerd: true};
const text = (rows: string[]) => rows.map(row => stripAnsi(row)).join('\n');

test('screen-animating savers preview on a sample screen, not the star field', () => {
  for (const mode of Object.keys(SCREEN_MODE_EFFECT) as IdleMode[]) {
    const sample = {};
    const first = idlePreviewRows(new CellGrid(), {...base, mode, elapsed: 0, still: false, sample});
    assert.equal(first.shown, mode);
    assert.match(text(first.rows), /❯|npm|git|README|passing/u, `${mode}: the sample screen is what it animates`);
    const starField = idleFrameRows(new CellGrid(), {...base, mode: 'deepSpace', time: 0});
    assert.notEqual(text(first.rows), text(starField), `${mode}: not the star field`);
    // It moves: a later frame differs from the first.
    const later = idlePreviewRows(new CellGrid(), {...base, mode, elapsed: 2500, still: false, sample});
    assert.notEqual(text(later.rows), text(first.rows), `${mode}: animated`);
  }
  assert.match(text(sampleCapture(40, 8).glyphs.join('').match(/.{1,40}/gu) ?? []), /npm test/u, 'fixed NMSh-like text, never a capture of the person\'s screen');
});

test('Random previews each saver it can choose, in turn, from the registry', () => {
  const candidates = randomCandidates();
  const seen = new Set<string>();
  for (let index = 0; index < candidates.length; index += 1) seen.add(previewSaver('random', index * RANDOM_PREVIEW_DWELL_MS + 10).mode);
  assert.deepEqual([...seen].sort(), [...candidates].sort());
  assert.equal(previewSaver('random', RANDOM_PREVIEW_DWELL_MS * candidates.length + 5).mode, previewSaver('random', 5).mode, 'and loops');
  assert.deepEqual(previewSaver('aurora', 1234), {mode: 'aurora', elapsed: 1234});
  const random = idlePreviewRows(new CellGrid(), {...base, mode: 'random', elapsed: 10, still: false, sample: {}});
  assert.ok(candidates.includes(random.shown), 'it names a real saver');
});

test('Setup: the Chroma row says what will show, and what hides or stills it', async () => {
  const {chromaVisibilityNote} = await import('../src/setup/SetupCat.js');
  const {normalizePromptConfiguration} = await import('../src/prompt/configuration.js');
  const draft = (patch: Record<string, unknown>) => normalizePromptConfiguration(patch as never);
  assert.match(chromaVisibilityNote(draft({presentation: {preset: 'off'}}), true), /^Off \(the default\): .*the preview shows it at once$/u);
  assert.match(chromaVisibilityNote(draft({presentation: {preset: 'aurora'}}), false), /NO_COLOR is set: .*no visible effect/u);
  assert.match(chromaVisibilityNote(draft({provider: 'starship', presentation: {preset: 'aurora'}}), true), /your external prompt keeps its own colors, so the prompt will not change/u);
  assert.match(chromaVisibilityNote(draft({provider: 'none', presentation: {preset: 'aurora'}}), true), /with Prompt None there is no prompt to color/u);
  assert.match(chromaVisibilityNote(draft({presentation: {preset: 'aurora', effectsOff: true}}), true), /^Aurora on the whole Native prompt · Decorative effects Off: its colors show, its motion stays still; P compares/u);
  assert.match(chromaVisibilityNote(draft({presentation: {preset: 'aurora', scope: 'identity'}}), true), /identity modules only \(the rest keeps theme colors\)/u);
});
