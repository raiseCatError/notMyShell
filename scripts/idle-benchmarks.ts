import {performance} from 'node:perf_hooks';
import {arch, platform} from 'node:os';
import {CellGrid} from '../src/idle/CellGrid.js';
import {IDLE_FRAME_MS, IDLE_MODES, idlePalette} from '../src/idle/scenes.js';
import {idleFrameRows} from '../src/idle/IdleVisuals.js';
import {PresentationClock} from '../src/motion/PresentationClock.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';
import {PRESET_STOPS} from '../src/chroma/treatment.js';
import {parseHexColor} from '../src/chroma/color.js';

/**
 * Idle visual cost: frame computation plus serialization, terminal bytes
 * actually written after row diffing, changed rows per frame, heap growth
 * over many frames, and timer cleanup. Run: node --import=tsx scripts/idle-benchmarks.ts
 */
const palette = idlePalette(PRESET_STOPS.aurora.map(hex => parseHexColor(hex)!));
const sizes: ReadonlyArray<readonly [number, number]> = [[80, 24], [120, 40], [180, 55]];
const frames = Number(process.env.NMSH_BENCH_SAMPLES ?? 120);
console.log(JSON.stringify({node: process.version, platform: platform(), arch: arch(), framesPerCase: frames}));

for (const mode of IDLE_MODES) {
  for (const [width, height] of sizes) {
    const grid = new CellGrid();
    let bytes = 0;
    const renderer = new TerminalRenderer(data => { bytes += Buffer.byteLength(data); });
    renderer.enter();
    const times: number[] = [];
    let changedRows = 0;
    let previous: string[] = [];
    global.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    for (let frame = 0; frame < frames; frame++) {
      const started = performance.now();
      const rows = idleFrameRows(grid, {mode, width, height, time: frame * IDLE_FRAME_MS[mode], palette, level: 'truecolor', nerd: true});
      times.push(performance.now() - started);
      changedRows += rows.filter((row, index) => row !== previous[index]).length;
      previous = rows;
      if (frame === 1) bytes = 0;
      renderer.render({rows, columns: width, cursorRow: 1, cursorColumn: 1, cursorVisible: false});
    }
    global.gc?.();
    const heapGrowthKb = Math.round((process.memoryUsage().heapUsed - heapBefore) / 1024);
    renderer.leave();
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({mode, size: `${width}x${height}`, frameMs: IDLE_FRAME_MS[mode],
      medianMs: +times[Math.floor(times.length / 2)]!.toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(3),
      avgChangedRows: +(changedRows / frames).toFixed(1), avgBytesPerFrame: Math.round(bytes / Math.max(1, frames - 2)), heapGrowthKb}));
  }
}

// Timer cleanup: an unsubscribed scene leaves the clock with no subscribers and no pending timer.
const clock = new PresentationClock();
const stop = clock.subscribe(() => {}, IDLE_FRAME_MS.aurora);
stop();
console.log(JSON.stringify({timerCleanup: {subscribers: clock.subscriberCount, scheduled: clock.scheduled}}));
