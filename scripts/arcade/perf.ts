/**
 * Headless Vespyr Arcade performance measurement (investigation numbers, not CI thresholds; see
 * docs/performance-benchmarks.md). Drives ArcadeSession exactly as the app does, with a fake clock and a seeded bot, and
 * reports per-frame CPU time (session.frame = step + animate, session.render = draw + ANSI encode), encoded frame bytes,
 * heap/RSS growth over a long simulated run, live handle counts across open/dispose cycles, and what a game still holds
 * after dispose.
 *
 *   t7run node --expose-gc --import=tsx scripts/arcade/perf.ts [--out <dir>] [--seconds 20] [--long 300] [--cycles 200] [--quick]
 *
 * Without --expose-gc the memory figures are not garbage-collected and are marked as such.
 */
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {arch, cpus, platform, totalmem} from 'node:os';
import {ArcadeSession} from '../../src/arcade/ArcadeSession.js';
import {ARCADE_GAMES, findGame} from '../../src/arcade/registry.js';
import {ArcadeStore} from '../../src/arcade/scores.js';
import {createRng} from '../../src/arcade/rng.js';
import type {Key} from '../../src/terminal/keys.js';
import type {GameDefinition} from '../../src/arcade/types.js';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
const quick = args.includes('--quick');
const SECONDS = Number(option('seconds') ?? (quick ? 6 : 20));
const LONG_SECONDS = Number(option('long') ?? (quick ? 30 : 300));
const CYCLES = Number(option('cycles') ?? (quick ? 40 : 200));
const WARMUP_S = 2;
/** --only a,b,c: just the all-games table for those ids (re-measure outliers in isolation). */
const ONLY = option('only')?.split(',').filter(Boolean);
const FRAME_MS = 33;
const OUT = option('out') ?? join(process.env.TMPDIR ?? '.', 'arcade-perf');
const gc = (globalThis as {gc?: () => void}).gc;
const SIZES = [{columns: 100, rows: 34}, {columns: 160, rows: 50}];
const mb = (bytes: number): number => Math.round(bytes / 1048576 * 10) / 10;
const round = (value: number, digits = 3): number => Math.round(value * 10 ** digits) / 10 ** digits;

const scratch = mkdtempSync(join(process.env.TMPDIR ?? '.', 'arcade-perf-'));
let clock = 1_760_000_000_000;

function makeSession(game: GameDefinition | undefined, size: {columns: number; rows: number}, reduced = false): ArcadeSession {
  const store = new ArcadeStore({directory: scratch, now: () => clock});
  return new ArcadeSession({
    store, now: () => clock, seed: () => 42, today: () => '2026-10-21',
    motion: () => ({reduced, effects: reduced ? 'subtle' : 'normal'}), color: () => 'truecolor', safeGlyphs: () => false,
  }, ARCADE_GAMES, size, game);
}

const text = (value: string): Key => ({kind: 'text', value});
const BOT: Key[] = [{kind: 'left'}, {kind: 'right'}, {kind: 'up'}, {kind: 'down'}, text(' '), {kind: 'enter'}, text('a'), text('d'), text('w'), text('s'), text('j'), text('k')];

/** A seeded bot: presses a key every ~6 frames, resumes from pause, retries after game over. */
function botKey(session: ArcadeSession, rng: ReturnType<typeof createRng>, frame: number): void {
  if (frame % 6 !== 0) return;
  if (session.screen === 'paused') { session.key({kind: 'escape'}); return; }
  if (session.screen === 'over') { session.key(text('r')); return; }
  if (session.screen === 'hub') return;
  if (session.game?.typing) { session.key(text(rng.pick([...'abcdefghijklmnopqrstuvwxyz']))); return; }
  session.key(rng.pick(BOT));
}

interface Stats { frames: number; meanMs: number; p95Ms: number; maxMs: number; frameMean: number; renderMean: number; renderP95: number; renderMax: number; bytesMean: number; bytesMax: number; over33: number }
function summarize(total: number[], frame: number[], render: number[], bytes: number[]): Stats {
  const sorted = [...total].sort((a, b) => a - b);
  const rsorted = [...render].sort((a, b) => a - b);
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const pct = (list: number[], p: number) => list[Math.min(list.length - 1, Math.floor(list.length * p))] ?? 0;
  return {
    frames: total.length, meanMs: round(mean(total)), p95Ms: round(pct(sorted, 0.95)), maxMs: round(sorted[sorted.length - 1] ?? 0),
    frameMean: round(mean(frame)), renderMean: round(mean(render)), renderP95: round(pct(rsorted, 0.95)), renderMax: round(rsorted[rsorted.length - 1] ?? 0),
    bytesMean: Math.round(mean(bytes)), bytesMax: Math.max(0, ...bytes), over33: total.filter(ms => ms > 33).length,
  };
}

/** Time `seconds` of simulated play: frame (step + animate) then render, as the app does each tick. */
function measure(session: ArcadeSession, seconds: number, hooks?: (frame: number) => void, dt = FRAME_MS): Stats {
  const rng = createRng(7);
  const total: number[] = [], frameT: number[] = [], renderT: number[] = [], bytes: number[] = [];
  const frames = Math.round(seconds * 1000 / dt);
  const warm = Math.round(WARMUP_S * 1000 / dt);
  for (let i = 0; i < frames + warm; i += 1) {
    clock += dt;
    hooks?.(i);
    botKey(session, rng, i);
    const t0 = performance.now();
    session.frame(dt);
    const t1 = performance.now();
    const out = session.render();
    const t2 = performance.now();
    if (i < warm) continue;
    frameT.push(t1 - t0); renderT.push(t2 - t1); total.push(t2 - t0);
    let size = 0;
    for (const row of out.rows) size += row.length;
    for (const overlay of out.overlays) size += JSON.stringify(overlay).length;
    bytes.push(size);
  }
  return summarize(total, frameT, renderT, bytes);
}

type Row = {scenario: string; size: string} & Stats;
const rows: Row[] = [];
const add = (scenario: string, size: {columns: number; rows: number}, stats: Stats): void => { rows.push({scenario, size: `${size.columns}x${size.rows}`, ...stats}); };

// ---- parade crowd forcing ------------------------------------------------------------------------------------------
function bigCrowd(session: ArcadeSession): (frame: number) => void {
  return () => {
    const state = (session.game as unknown as {state?: {count: number; peak: number; started: boolean; alive: boolean}} | undefined)?.state;
    if (!state) return;
    state.started = true;
    if (state.count < 200_000 && state.alive) { state.count = 500_000; state.peak = Math.max(state.peak, state.count); }
  };
}

function measureAll(): Row[] {
  const out: Row[] = [];
  for (const game of ARCADE_GAMES) {
    if (ONLY && !ONLY.includes(game.id)) continue;
    const size = SIZES[0]!;
    const session = makeSession(game, size);
    out.push({scenario: game.id, size: `${size.columns}x${size.rows}`, ...measure(session, SECONDS)});
    session.dispose();
  }
  return out;
}

// JIT warm-up so the first scenario is not charged for compiling the renderer.
{ const warm = makeSession(undefined, SIZES[0]!); for (let i = 0; i < 60; i += 1) { clock += 100; warm.frame(100); warm.render(); } warm.dispose(); }

if (ONLY) {
  const header = '| scenario | size | total mean ms | p95 | max | frame() mean | render() mean | render p95 | bytes mean | bytes max | frames >33ms |';
  console.log([header, ...measureAll().map(r => `| ${r.scenario} | ${r.size} | ${r.meanMs} | ${r.p95Ms} | ${r.maxMs} | ${r.frameMean} | ${r.renderMean} | ${r.renderP95} | ${r.bytesMean} | ${r.bytesMax} | ${r.over33} |`)].join('\n'));
  rmSync(scratch, {recursive: true, force: true});
  process.exit(0);
}

// ---- 1. hub ----------------------------------------------------------------------------------------------------------
for (const size of SIZES) {
  const reduced = makeSession(undefined, size, true);
  add('hub idle (reduced motion, render only, no frames wanted)', size, measure(reduced, SECONDS / 2, undefined, 100));
  reduced.dispose();
  const animated = makeSession(undefined, size);
  add('hub animated preview (frame+render at the 100 ms hub tick)', size, measure(animated, SECONDS, undefined, 100));
  animated.dispose();
}
// Every game's hub preview, worst render at 160x50: select with the library keys and time 30 ticks each.
const previews: Array<{id: string; meanMs: number; maxMs: number}> = [];
{
  const size = SIZES[1]!;
  for (const game of ARCADE_GAMES) {
    const session = makeSession(undefined, size);
    // Walk the cursor to the game by searching for its id.
    session.key(text('/')); for (const ch of game.id) session.key(text(ch)); session.key({kind: 'enter'});
    const times: number[] = [];
    for (let i = 0; i < 60; i += 1) { clock += 100; session.frame(100); const t = performance.now(); session.render(); if (i >= 10) times.push(performance.now() - t); }
    previews.push({id: game.id, meanMs: round(times.reduce((a, b) => a + b, 0) / times.length), maxMs: round(Math.max(...times))});
    session.dispose();
  }
}

// ---- 2. representative games -------------------------------------------------------------------------------------------
const FOCUS = ['pinball', 'rover', 'sandfall', 'parade', 'driftkeys'];
for (const size of SIZES) {
  for (const id of FOCUS) {
    const game = findGame(id)!;
    const session = makeSession(game, size);
    add(`${id} (bot play)`, size, measure(session, SECONDS));
    session.dispose();
  }
  const parade = makeSession(findGame('parade')!, size);
  const hook = bigCrowd(parade);
  add('parade (forced 500k crowd)', size, measure(parade, SECONDS, hook));
  parade.dispose();
}
// Every game once at 100x34 for outlier hunting.
const all: Row[] = measureAll();

// ---- 3. long run: heap / RSS growth ------------------------------------------------------------------------------------
interface Mem { game: string; heapStartMb: number; heapEndMb: number; rssStartMb: number; rssEndMb: number; heapSamplesMb: number[]; gcd: boolean }
const memRows: Mem[] = [];
const settle = (): void => { gc?.(); gc?.(); };
for (const id of FOCUS) {
  const game = findGame(id)!;
  const session = makeSession(game, SIZES[0]!);
  const rng = createRng(11);
  const hook = id === 'parade' ? bigCrowd(session) : undefined;
  const step = (frames: number, offset: number) => { for (let i = 0; i < frames; i += 1) { clock += FRAME_MS; hook?.(i); botKey(session, rng, offset + i); session.frame(FRAME_MS); session.render(); } };
  step(Math.round(10_000 / FRAME_MS), 0);
  settle();
  const start = process.memoryUsage();
  const samples: number[] = [];
  const minutes = Math.max(1, Math.round(LONG_SECONDS / 60));
  const perChunk = Math.round(LONG_SECONDS * 1000 / FRAME_MS / minutes);
  for (let minute = 0; minute < minutes; minute += 1) { step(perChunk, minute * perChunk); settle(); samples.push(mb(process.memoryUsage().heapUsed)); }
  const end = process.memoryUsage();
  memRows.push({game: id, heapStartMb: mb(start.heapUsed), heapEndMb: mb(end.heapUsed), rssStartMb: mb(start.rss), rssEndMb: mb(end.rss), heapSamplesMb: samples, gcd: Boolean(gc)});
  session.dispose();
}

// ---- 4. open / dispose cycles --------------------------------------------------------------------------------------------
const resources = (): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const name of process.getActiveResourcesInfo()) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
};
interface Cycle { scenario: string; cycles: number; resourcesBefore: Record<string, number>; resourcesAfter: Record<string, number>; heapBeforeMb: number; heapAfterMb: number; msPerCycle: number }
const cycleRows: Cycle[] = [];
function cycle(scenario: string, open: GameDefinition | undefined): void {
  settle();
  const before = resources();
  const heapBefore = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  for (let i = 0; i < CYCLES; i += 1) {
    const session = makeSession(open, SIZES[0]!);
    for (let f = 0; f < 6; f += 1) { clock += FRAME_MS; session.frame(FRAME_MS); session.render(); }
    session.key({kind: 'enter'});
    session.dispose();
    session.dispose();
  }
  const ms = performance.now() - t0;
  settle();
  cycleRows.push({scenario, cycles: CYCLES, resourcesBefore: before, resourcesAfter: resources(), heapBeforeMb: mb(heapBefore), heapAfterMb: mb(process.memoryUsage().heapUsed), msPerCycle: round(ms / CYCLES)});
}
cycle('open hub then dispose', undefined);
for (const id of FOCUS) cycle(`open ${id} then dispose`, findGame(id)!);

// ---- 5. what a game still holds after dispose ------------------------------------------------------------------------------
const RETAINED = /particle|popup|pop|spark|trail|burst|fx|confetti|splash/iu;
function heldItems(value: unknown, depth = 0, seen = new Set<unknown>()): Array<{path: string; length: number}> {
  const out: Array<{path: string; length: number}> = [];
  if (!value || typeof value !== 'object' || depth > 2 || seen.has(value)) return out;
  seen.add(value);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (Array.isArray(child) && RETAINED.test(key) && child.length > 0) out.push({path: key, length: child.length});
    else if (child && typeof child === 'object' && !Array.isArray(child)) {
      const count = (child as {count?: unknown}).count;
      if (RETAINED.test(key) && typeof count === 'number' && count > 0) out.push({path: key, length: count});
      else for (const nested of heldItems(child, depth + 1, seen)) out.push({path: `${key}.${nested.path}`, length: nested.length});
    }
  }
  return out;
}
const afterDispose: Array<{game: string; before: string; after: string}> = [];
for (const game of ARCADE_GAMES) {
  const session = makeSession(game, SIZES[0]!);
  const rng = createRng(3);
  for (let i = 0; i < 400; i += 1) { clock += FRAME_MS; botKey(session, rng, i); session.frame(FRAME_MS); session.render(); }
  const instance = session.game;
  const during = instance ? heldItems(instance) : [];
  session.dispose();
  const after = instance ? heldItems(instance) : [];
  if (during.length || after.length) afterDispose.push({game: game.id, before: during.map(item => `${item.path}=${item.length}`).join(' ') || '-', after: after.map(item => `${item.path}=${item.length}`).join(' ') || '-'});
}

// ---- output ----------------------------------------------------------------------------------------------------------------
const environment = {node: process.version, platform: `${platform()} ${arch()}`, cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, memGiB: round(totalmem() / 2 ** 30, 1), gc: Boolean(gc), seconds: SECONDS, longSeconds: LONG_SECONDS, cycles: CYCLES, frameMs: FRAME_MS, warmupS: WARMUP_S};
mkdirSync(OUT, {recursive: true});
writeFileSync(join(OUT, 'perf.json'), JSON.stringify({environment, rows, all, previews, memRows, cycleRows, afterDispose}, null, 2));
const line = (r: Row): string => `| ${r.scenario} | ${r.size} | ${r.meanMs} | ${r.p95Ms} | ${r.maxMs} | ${r.frameMean} | ${r.renderMean} | ${r.renderP95} | ${r.bytesMean} | ${r.bytesMax} | ${r.over33} |`;
const head = '| scenario | size | total mean ms | p95 | max | frame() mean | render() mean | render p95 | bytes mean | bytes max | frames >33ms |\n|---|---|---|---|---|---|---|---|---|---|---|';
const md = [
  `# Arcade perf (${JSON.stringify(environment)})`, '', head, ...rows.map(line), '', '## All games, 100x34, bot play', '', head, ...all.map(line), '',
  '## Hub previews at 160x50 (render ms)', '', ...[...previews].sort((a, b) => b.maxMs - a.maxMs).slice(0, 8).map(p => `- ${p.id}: mean ${p.meanMs}, max ${p.maxMs}`), '',
  '## Memory over the long run (heap MB after gc each simulated minute)', '', ...memRows.map(m => `- ${m.game}: heap ${m.heapStartMb} -> ${m.heapEndMb}, rss ${m.rssStartMb} -> ${m.rssEndMb}, samples ${m.heapSamplesMb.join(',')}${m.gcd ? '' : ' (no gc)'}`), '',
  '## Open/dispose cycles', '', ...cycleRows.map(c => `- ${c.scenario} x${c.cycles}: ${c.msPerCycle} ms/cycle, heap ${c.heapBeforeMb} -> ${c.heapAfterMb} MB, resources ${JSON.stringify(c.resourcesBefore)} -> ${JSON.stringify(c.resourcesAfter)}`), '',
  '## Particle/popup-like state held by a disposed game instance', '', ...(afterDispose.length ? afterDispose.map(a => `- ${a.game}: during ${a.before}; after dispose ${a.after}`) : ['- none found']),
].join('\n');
writeFileSync(join(OUT, 'perf.md'), md);
rmSync(scratch, {recursive: true, force: true});
console.log(md);
