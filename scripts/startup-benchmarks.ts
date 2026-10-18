import {performance} from 'node:perf_hooks';
import {arch, platform} from 'node:os';
import {CellGrid} from '../src/idle/CellGrid.js';
import {pureMix, type SkyMood} from '../src/idle/auroraMoods.js';
import {PresentationClock} from '../src/motion/PresentationClock.js';
import {normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {createQuickSetup, renderSetup, type SetupState} from '../src/setup/SetupCat.js';
import {paintStartupEnding, type StartupEnding} from '../src/setup/startup/ending.js';
import {skyFrameMs} from '../src/setup/startup/sky.js';
import {STARTING_POINT_MOODS, STARTING_POINTS} from '../src/setup/startup/startingPoints.js';
import {startupLayout} from '../src/setup/startup/view.js';
import {TerminalRenderer} from '../src/terminal/TerminalRenderer.js';

/**
 * The first-run selector's cost: one frame of the whole selector (sky, horizon,
 * cached ground) per tick at each mood's own cadence, the 700 ms cross-fade at
 * 40 ms, and the ending at 40 ms; median and p95 milliseconds, terminal bytes
 * actually written after row diffing, and the resulting KB/s. Then timer
 * cleanup. Run: node --import=tsx scripts/startup-benchmarks.ts
 */
process.env.NMSH_COLOR ??= 'truecolor';
const sizes: ReadonlyArray<readonly [number, number]> = [[100, 30], [130, 38], [200, 55]];
const frames = Number(process.env.NMSH_BENCH_SAMPLES ?? 60);
const config = normalizePromptConfiguration({introSeen: true});
console.log(JSON.stringify({node: process.version, platform: platform(), arch: arch(), framesPerCase: frames}));

interface Measured {medianMs: number; p95Ms: number; avgBytesPerFrame: number; kbPerSecond: number}

/** Frames through the real renderer: time to build each frame, bytes the renderer writes for it. */
function measure(width: number, height: number, cadenceMs: number, frame: (index: number) => string[]): Measured {
  let bytes = 0;
  const renderer = new TerminalRenderer(data => { bytes += Buffer.byteLength(data); });
  renderer.enter();
  const times: number[] = [];
  for (let index = 0; index < frames; index++) {
    const started = performance.now();
    const rows = frame(index);
    times.push(performance.now() - started);
    // The first frame paints everything; what matters is what each later tick writes.
    if (index === 1) bytes = 0;
    renderer.render({rows, columns: width, cursorRow: 1, cursorColumn: 1, cursorVisible: false});
  }
  renderer.leave();
  times.sort((a, b) => a - b);
  const perFrame = bytes / Math.max(1, frames - 2);
  return {medianMs: +times[Math.floor(times.length / 2)]!.toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)]!.toFixed(3),
    avgBytesPerFrame: Math.round(perFrame), kbPerSecond: cadenceMs > 0 ? +(perFrame * (1000 / cadenceMs) / 1024).toFixed(1) : 0};
}

const selector = (choice: number, now: number): SetupState => {
  const state = createQuickSetup(config, now);
  state.onboarding = true;
  state.quick!.choice = choice; state.quick!.previousChoice = choice;
  return state;
};

for (let choice = 0; choice < STARTING_POINTS.length; choice++) {
  const mood: SkyMood = STARTING_POINT_MOODS[STARTING_POINTS[choice]!];
  for (const [width, height] of sizes) {
    // At rest: the sky moves at its own cadence (Out holds still, so it is drawn once and then only on change).
    const state = selector(choice, 0);
    const rest = skyFrameMs({now: 10_000, changedAt: state.quick!.changedAt, activeAt: 10_000, backdrop: state.quick!.backdrop, reduced: false});
    const cadence = rest || 200;
    const atRest = measure(width, height, rest, index => { state.quick!.sky.activeAt = 10_000 + index * cadence; return renderSetup(state, width, height, 10_000 + index * cadence); });
    // The cross-fade into this mood from Recommended's aurora: 700 ms at 40 ms.
    const fading = selector(0, 0);
    fading.quick!.choice = choice; fading.quick!.previousChoice = 0; fading.quick!.changedAt = 20_000;
    fading.quick!.sky.from = pureMix('aurora');
    const crossfade = measure(width, height, 40, index => { fading.quick!.sky.activeAt = 20_000 + (index % 18) * 40; return renderSetup(fading, width, height, 20_000 + (index % 18) * 40); });
    console.log(JSON.stringify({mood, size: `${width}x${height}`, restCadenceMs: rest, rest: atRest, crossfade}));
  }
}

// The ending over a real-shaped frame: transcript rows above a two-line composer, 40 ms ticks across 880 ms.
for (const [width, height] of sizes) {
  const real = Array.from({length: height}, (_, i) => i < height - 3 ? `transcript ${i}` : i === height - 3 ? 'PROMPT' : i === height - 2 ? '❯ ' : '─'.repeat(width));
  const plan = {regions: [{kind: 'transcript' as const, top: 0, height: height - 3}, {kind: 'prompt' as const, top: height - 3, height: 1},
    {kind: 'input' as const, top: height - 2, height: 1}, {kind: 'separator' as const, top: height - 1, height: 1}]};
  const layout = startupLayout(width, height);
  const ending: StartupEnding = {start: 0, columns: width, rows: height, skyHeight: layout.skyHeight, backdrop: 'aurora', config,
    sky: {started: 0, mood: 'aurora', previousMood: 'aurora', changedAt: Number.NEGATIVE_INFINITY, from: pureMix('aurora'), timeAt: 0, activeAt: 0},
    ground: Array.from({length: height - layout.skyHeight}, (_, i) => `ground ${i}`), catX: layout.margin, welcome: false, welcomeLines: 0};
  const grid = new CellGrid();
  console.log(JSON.stringify({ending: `${width}x${height}`, ...measure(width, height, 40, index => paintStartupEnding(real, plan, width, (index % 23) * 40, ending, grid).rows)}));
}

// Timer cleanup: an unsubscribed sky leaves the clock with no subscribers and no pending timer.
const clock = new PresentationClock();
const stop = clock.subscribe(() => {}, 200);
stop();
console.log(JSON.stringify({timerCleanup: {subscribers: clock.subscriberCount, scheduled: clock.scheduled}}));
