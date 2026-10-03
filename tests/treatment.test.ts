import assert from 'node:assert/strict';
import test from 'node:test';
import {sampleTreatment, treatmentText, normalizeTreatmentSettings, DEFAULT_TREATMENT_SETTINGS} from '../src/chroma/treatment.js';
import {solid, theme, resolveColor} from '../src/chroma/chroma.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import {normalizePromptConfiguration, loadPromptConfiguration, savePromptConfiguration} from '../src/prompt/configuration.js';

const red = solid({red: 255, green: 0, blue: 0});
const blue = solid({red: 0, green: 0, blue: 255});
const treatment = {stops: [red, blue], geometry: 'linear' as const, motion: 'static' as const, intensity: 1};
const context = {role: 'divider' as const, base: {red: 255, green: 255, blue: 255}, reducedMotion: false, effectsOff: false, level: 'truecolor' as const};

test('static interpolation, geometry, theme and intensity are independent', () => {
  assert.deepEqual(sampleTreatment(treatment, {...context, column: 1, width: 3}, 0), {red: 128, green: 0, blue: 128});
  for (const geometry of ['center-out', 'outside-in'] as const) {
    const center = sampleTreatment({...treatment, geometry}, {...context, column: 1, width: 3}, 0);
    assert.deepEqual(center, resolveColor(geometry === 'center-out' ? red : blue));
  }
  assert.deepEqual(sampleTreatment({...treatment, stops: [theme('accent')]}, {...context, column: 0, width: 1}, 0), resolveColor(theme('accent')));
  assert.deepEqual(sampleTreatment({...treatment, intensity: 0}, {...context, column: 0, width: 1}, 0), context.base);
});

test('time sampling is deterministic; reduced/off/semantic roles remain static', () => {
  for (const motion of ['travel', 'breathe'] as const) {
    const spec = {...treatment, motion};
    const cell = {...context, column: 1, width: 4};
    assert.deepEqual(sampleTreatment(spec, cell, 700), sampleTreatment(spec, cell, 700));
    assert.notDeepEqual(sampleTreatment(spec, cell, 0), sampleTreatment(spec, cell, 700));
    for (const guard of [{reducedMotion: true}, {effectsOff: true}]) {
      assert.deepEqual(sampleTreatment(spec, {...cell, ...guard}, 700), sampleTreatment({...spec, motion: 'static'}, cell, 0));
    }
  }
  for (const role of ['status', 'focus', 'raw', 'provider'] as const) {
    assert.deepEqual(sampleTreatment(treatment, {...context, role, column: 0, width: 3}, 0), context.base);
  }
});

test('text keeps graphemes and display widths; capability downgrade preserves plain content', () => {
  for (const level of ['truecolor', 'ansi256', 'ansi16', 'none'] as const) {
    for (const text of ['界é🧑‍💻', '-', '']) {
      const styled = treatmentText(text, treatment, {...context, level}, 0);
      assert.equal(stripAnsi(styled), text);
      assert.equal(displayWidth(styled), displayWidth(text));
      if (level === 'none') assert.equal(styled, text);
      if (text && level === 'ansi256') assert.match(styled, /38;5;/u);
      if (text && level === 'truecolor') assert.match(styled, /38;2;/u);
      if (level === 'ansi16') assert.doesNotMatch(styled, /38;/u);
    }
  }
});

test('bounded custom configuration and additive migration preserve prompt settings', () => {
  assert.deepEqual(normalizeTreatmentSettings(undefined), DEFAULT_TREATMENT_SETTINGS);
  const invalid = normalizeTreatmentSettings({preset: 'custom', customStops: ['#ff0000', 'bad'], intensity: NaN});
  assert.equal(invalid.preset, 'off');
  const valid = normalizeTreatmentSettings({preset: 'custom', customStops: ['#ff0000', '#0000ff'], intensity: 2, motion: 'travel'});
  assert.equal(valid.intensity, 1);
  assert.equal(valid.customStops.length, 2);
  assert.equal(normalizeTreatmentSettings({preset: 'custom', customStops: Array(9).fill('#ff0000')}).preset, 'off');
  const config = normalizePromptConfiguration({provider: 'starship', starship: {configPath: '/safe/theme'}, presentation: valid});
  assert.equal(config.provider, 'starship');
  assert.equal(config.starship.configPath, '/safe/theme');
  assert.deepEqual(config.presentation, valid);
});

import {buildContextLine, themePreviewContext, nativePromptSnapshot} from '../src/prompt/prompt.js';
import {framePanel} from '../src/ui/PanelShell.js';
import {OutputBuffer, serializeCopyPayload} from '../src/output/OutputBuffer.js';
import {planScreen} from '../src/app/screenPlan.js';

test('representative surfaces project decoration without changing semantic data', () => {
  process.env.NMSH_COLOR = 'truecolor';
  const config = normalizePromptConfiguration({nmsh: {style: 'minimal'}, presentation: {preset: 'lavender'}});
  const ordinary = normalizePromptConfiguration({...config, presentation: undefined});
  const decorated = buildContextLine(themePreviewContext(), 100, config);
  const plain = buildContextLine(themePreviewContext(), 100, ordinary);
  assert.equal(stripAnsi(decorated), stripAnsi(plain));
  assert.notEqual(decorated, plain);
  assert.deepEqual(nativePromptSnapshot(themePreviewContext(), config), nativePromptSnapshot(themePreviewContext(), ordinary));
  assert.notEqual(framePanel(['hello'], 30, config.presentation)[0], framePanel(['hello'], 30)[0]);
  const output = new OutputBuffer();
  output.beginCommand('echo raw', ['echo raw']);
  output.write('raw \u001B[31mred\u001B[0m');
  output.complete(0);
  const copy = serializeCopyPayload(output.recent(1)!);
  const before = output.wrapped(30);
  output.presenter.setTreatment(config.presentation);
  assert.deepEqual(output.wrapped(30), before);
  const archive = output.transcript();
  output.presenter.setTreatment(DEFAULT_TREATMENT_SETTINGS);
  assert.deepEqual(output.transcript(), archive);
  assert.equal(serializeCopyPayload(output.recent(1)!), copy);
});

test('six layouts retain placement and widths with treated chrome at narrow and normal widths', () => {
  for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
    for (const presentation of ['normal', 'chat'] as const) {
      for (const width of [1, 20, 100]) {
        const output = new OutputBuffer();
        output.beginCommand('echo ok', ['echo ok'], undefined, {cwd: '/tmp'});
        output.complete(0);
        output.presenter.setLayout(presentation);
        const normal = output.wrapped(width);
        output.presenter.setTreatment(normalizeTreatmentSettings({preset: 'lavender', motion: 'travel'}));
        const treated = output.wrapped(width);
        assert.ok(treated.every(row => displayWidth(row.plain) <= width));
        assert.equal(treated[0]?.plain.trim(), normal[0]?.plain.trim());
        const plan = planScreen({rows: 24, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true,
          contextPlacement: 'header', hasVisibleContext: true, composerLayout: 'twoLine', composerPosition, transcriptRows: treated.length});
        assert.ok(plan.regions.every(region => region.top + region.height <= 24));
      }
    }
  }
});

import {mkdtempSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('saving additive presentation settings preserves unknown declarative configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-treatment-config-'));
  const path = join(root, 'config.json');
  try {
    writeFileSync(path, JSON.stringify({futureFeature: {enabled: true}, nmsh: {palette: 'warm', futureGeometry: 'kept'}, presentation: {futurePalette: 'kept'}}));
    const config = loadPromptConfiguration(path);
    config.presentation.preset = 'lavender';
    savePromptConfiguration(config, path);
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    assert.deepEqual(saved.futureFeature, {enabled: true});
    assert.equal(saved.nmsh.futureGeometry, 'kept');
    assert.equal(saved.presentation.futurePalette, 'kept');
    assert.equal(saved.presentation.preset, 'lavender');
    assert.equal(saved.nmsh.palette, config.nmsh.palette);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
