import {normalizePromptConfiguration, type PromptConfiguration} from '../src/prompt/configuration.js';
import {NATIVE_PROMPT_THEMES} from '../src/prompt/prompt.js';
import {sweepDurationMs, sweepOnce, type SweepCell} from '../src/motion/lightSweep.js';
import {sweepStyleFor} from '../src/motion/sweepStyle.js';
import {colorLevel} from '../src/presentation/capabilities.js';
import {graphemes} from '../src/input/inputLayout.js';
import type {Rgb} from '../src/chroma/escape.js';

/**
 * Deterministic light-sweep demo for physical review. Every frame is a pure
 * function of a stepped clock (100 ms per frame), so recordings repeat
 * exactly. Run: node --import=tsx scripts/shimmer-demo.ts [seconds]
 * With --frame <ms> it prints one frame at that time and exits.
 */
const variants: Array<[string, object]> = [
  ['Full Chroma · Semantic Override', {presentation: {preset: 'aurora', semantic: 'override', shimmer: 'on'}}],
  ['Full Chroma · Semantic Preserve', {presentation: {preset: 'aurora', semantic: 'preserve', shimmer: 'on'}}],
  ['Theme accent (Chroma off)', {nmsh: {palette: 'ocean'}, presentation: {shimmer: 'on'}}],
  ['Grayscale UI chrome (Grayscale theme)', {nmsh: {palette: 'grayscale'}, uiChrome: {source: 'custom', preset: 'grayscale'}, presentation: {shimmer: 'on'}}],
];

function sample(config: PromptConfiguration): SweepCell[] {
  const theme = NATIVE_PROMPT_THEMES[config.nmsh.palette];
  const cells: SweepCell[] = [];
  const add = (text: string, color: Rgb, semantic = false) => { for (const glyph of graphemes(text)) cells.push({glyph, color: glyph === ' ' ? undefined : color, semantic}); };
  add('✔ 0  ', theme.colors('success').background, true);
  add('notMyShell  ', theme.colors('project').background);
  add('~/Projects  ', theme.colors('cwd').background);
  add('main  ', theme.colors('gitBranch').background);
  add('node  ', theme.colors('node').background);
  add('✘ 1', theme.colors('failure').background, true);
  return cells;
}

function frame(time: number): string[] {
  return variants.flatMap(([label, patch]) => {
    const config = normalizePromptConfiguration(patch);
    // One pass at a time (as after a selection or value change), then a pause, then the next pass.
    const cells = sample(config);
    const pass = sweepDurationMs(cells.length) + 900;
    return [`\u001B[2m${label}\u001B[0m`, `  ${sweepOnce(cells, time % pass, sweepStyleFor(config), colorLevel())}\u001B[0m`, ''];
  });
}

const index = process.argv.indexOf('--frame');
if (index !== -1) {
  process.stdout.write(`${frame(Number(process.argv[index + 1] ?? 0)).join('\n')}\n`);
} else {
  const seconds = Number(process.argv[2] ?? 12);
  let step = 0;
  process.stdout.write('\u001B[?25l\u001B[2J');
  const timer = setInterval(() => {
    process.stdout.write(`\u001B[H${frame(step * 100).join('\n')}\n`);
    if (++step > seconds * 10) { clearInterval(timer); process.stdout.write('\u001B[?25h'); }
  }, 100);
}
