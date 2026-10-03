import {mixRgb, BRAND_LAVENDER} from '../src/chroma/chroma.js';
import {colorEscape} from '../src/chroma/escape.js';
import {performance} from 'node:perf_hooks';
import {platform, arch} from 'node:os';
import {normalizeTreatmentSettings, paintTreatment} from '../src/chroma/treatment.js';
import {UI_COLORS} from '../src/ui/palette.js';
import {EffectState, applyEffect, effectRegion, effectCells} from '../src/motion/effects.js';
import {PresentationClock} from '../src/motion/PresentationClock.js';
import {planScreen} from '../src/app/screenPlan.js';
import {OutputBuffer} from '../src/output/OutputBuffer.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';

const settings = normalizeTreatmentSettings({preset: 'lavender'});
const animated = {...settings, motion: 'travel' as const};
let time = 0;
function measure(name: string, run: () => unknown, samples = 100): void {
  for (let i = 0; i < 5; i++) run();
  const cpu = process.cpuUsage();
  const values: number[] = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); run(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  const used = process.cpuUsage(cpu);
  console.log(JSON.stringify({name, samples, medianMs: +values[Math.floor(samples / 2)]!.toFixed(3), p95Ms: +values[Math.floor(samples * 0.95)]!.toFixed(3), cpuMs: +(used.user / 1000 + used.system / 1000).toFixed(3)}));
}
console.log(JSON.stringify({node: process.version, platform: platform(), arch: arch(), frameRate: 10}));
measure('static-prompt-sampling-40-cells', () => paintTreatment('notMyShell ~/Projects main node'.padEnd(40), settings, 'native-identity', UI_COLORS.primary));
measure('animated-prompt-sampling-40-cells', () => paintTreatment('notMyShell ~/Projects main node'.padEnd(40), animated, 'native-identity', UI_COLORS.primary, time += 100));
measure('animated-divider-120-cells', () => paintTreatment('-'.repeat(120), animated, 'divider', UI_COLORS.separator, time += 100));
const state = new EffectState(); state.trigger('rain', 'bottom', 0, 42, settings);
const planInput = {rows: 40, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: true, contextPlacement: 'header' as const, hasVisibleContext: true, composerLayout: 'twoLine' as const, transcriptRows: 100};
const output = new OutputBuffer();
for (let i = 0; i < 1000; i++) { output.beginCommand(`echo ${i}`, [`echo ${i}`], undefined, {cwd: '/work'}); output.write(`raw output ${i}\r\n`); output.complete(0); }
output.presenter.setTreatment(settings);
measure('large-transcript-static-1000-commands', () => output.wrapped(120), 10);
for (const composerPosition of ['bottom', 'top', 'flow'] as const) {
  for (const transcriptPresentation of ['normal', 'chat'] as const) {
    output.presenter.setLayout(transcriptPresentation);
    const base = output.wrapped(120).slice(-35).map(row => row.ansi);
    const plan = planScreen({...planInput, composerPosition});
    const region = effectRegion(plan, 'bottom');
    if (!region) continue;
    const rows = Array.from({length: plan.rows}, (_, i) => base[i] ?? '');
    let writes = 0, bytes = 0;
    const renderer = new TerminalRenderer(data => { writes++; bytes += Buffer.byteLength(data); });
    renderer.enter(); renderer.render({rows, columns: 120, cursorRow: 40, cursorColumn: 1}); writes = 0; bytes = 0;
    let changedRows = 0, maxChangedCells = 0;
    let previousCells = new Map<string, string>();
    let previous = rows;
    measure(`${composerPosition}-${transcriptPresentation}-cached-effect-frame`, () => {
      const now = (time++ % 29) * 100;
      const next = applyEffect(rows, state.active!, region, 120, now, true, 'truecolor');
      const cells = new Map(effectCells(state.active!, region, 120, now, true).map(cell =>
        [`${cell.row}:${cell.column}`, colorEscape(38, mixRgb(BRAND_LAVENDER, {red: 235, green: 220, blue: 255}, cell.intensity), 'truecolor') + cell.glyph]));
      maxChangedCells = Math.max(maxChangedCells, [...new Set([...cells.keys(), ...previousCells.keys()])].filter(key => cells.get(key) !== previousCells.get(key)).length);
      previousCells = cells;
      changedRows = next.filter((row, i) => row !== previous[i]).length;
      renderer.render({rows: next, columns: 120, cursorRow: 40, cursorColumn: 1}); previous = next;
    });
    console.log(JSON.stringify({layout: `${composerPosition}-${transcriptPresentation}`, writes, bytes, finalChangedRows: changedRows, maxChangedCells, particleBound: 64, cellUpdateBound: 512 * 4}));
    renderer.leave();
  }
}
measure('resize-plan-and-effect-20-to-320-columns', () => {
  const plan = planScreen({...planInput, rows: 12, composerPosition: 'flow'});
  const region = effectRegion(plan, 'top');
  if (region) for (const width of [20, 80, 320]) applyEffect(Array(12).fill(''), state.active!, region, width, 700, true, 'truecolor');
});
const clock = new PresentationClock(); let wakeups = 0;
const stop = clock.subscribe(() => wakeups++);
await new Promise(resolve => setTimeout(resolve, 550)); stop();
console.log(JSON.stringify({clockWindowMs: 550, wakeups, subscribersAfterStop: clock.subscriberCount, scheduledAfterStop: clock.scheduled}));
