/**
 * Per-concept animation cost, measured like scripts/idle-benchmarks.ts: frame
 * computation time and the bytes the production TerminalRenderer writes after
 * row diffing, at each concept's own cadence. Prototype measurement only.
 */
import {performance} from 'node:perf_hooks';
import {applyTheme, backdropFrameMs, type Backdrop, type Concept, type Env, type State} from './kit.js';
import {horizon} from './horizon.js';
import {stage} from './stage.js';
import {firstPrompt} from './firstprompt.js';
import {TerminalRenderer} from './src.js';

process.env.NMSH_COLOR = 'truecolor';
const env: Env = {reduced: false, palette: 'lavender', config: applyTheme('lavender')};
const concepts: Array<[string, Concept]> = [['horizon', horizon], ['stage', stage], ['prompt', firstPrompt]];
const sizes: Array<[number, number]> = [[100, 30], [130, 38], [200, 55]];
const frames = 120;

for (const backdrop of ['aurora', 'subtle'] as Backdrop[]) {
  for (const [name, concept] of concepts) {
    for (const [width, height] of sizes) {
      const state: State = {screen: 'pick', choice: 0, layout: 'twoLine', backdrop, confirmIndex: 0, confirmFrom: 'pick', changedAt: -1e9,
        previousChoice: 0, screenAt: 0, previousScreen: 'pick', customize: {row: 0, theme: 0}};
      let bytes = 0;
      const renderer = new TerminalRenderer(data => { bytes += Buffer.byteLength(data); });
      renderer.enter();
      const interval = backdropFrameMs(backdrop, env);
      const times: number[] = [];
      let changed = 0, previous: string[] = [];
      for (let frame = 0; frame < frames; frame++) {
        const started = performance.now();
        const rows = concept.render(state, width, height, 10_000 + frame * interval, env);
        times.push(performance.now() - started);
        changed += rows.filter((row, i) => row !== previous[i]).length;
        previous = rows;
        if (frame === 1) bytes = 0;
        renderer.render({rows, columns: width, cursorRow: height, cursorColumn: 1, cursorVisible: false});
      }
      renderer.leave();
      times.sort((a, b) => a - b);
      const perFrame = Math.round(bytes / (frames - 2));
      console.log(JSON.stringify({backdrop, concept: name, size: `${width}x${height}`, frameMs: interval,
        medianMs: +times[Math.floor(frames / 2)]!.toFixed(2), p95Ms: +times[Math.floor(frames * 0.95)]!.toFixed(2),
        changedRows: +(changed / frames).toFixed(1), bytesPerFrame: perFrame, kbPerSecond: +(perFrame / interval).toFixed(1)}));
    }
  }
}
