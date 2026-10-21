import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng, type Rng} from '../src/arcade/rng.js';
import type {GameContext, GameRecordHandle} from '../src/arcade/types.js';
import type {GameRecord} from '../src/arcade/scores.js';
import {BALL_R, COLORS, OrbitState, RING_R, RING_T, TAP_CAP, TAP_GAP, type Obstacle} from '../src/arcade/games/orbit/logic.js';
import {orbitGame} from '../src/arcade/games/orbit/index.js';

const DT = 10;
const clear = (obstacle: Extract<Obstacle, {kind: 'ring'}>) => obstacle.r - RING_T / 2 - BALL_R;

/** A bot that can only tap: `gap` ms apart (jittered) when adjusting, about 110-170 ms when it has more than 5 units to climb. */
export function bot(state: OrbitState, rng: Rng, options: {gap: [number, number]}) {
  let last = -1e9;
  let wait = rng.range(options.gap[0], options.gap[1]);
  let committed: Obstacle | undefined;
  let exiting: Obstacle | undefined;
  return (now: number): void => {
    if (!state.alive) return;
    const next = state.obstacles.find(o => o.y + (o.kind === 'ring' ? o.r : 3) + 4 > state.y);
    let target = state.y + 20;
    if (next) {
      const lead = (t: number) => {
        if (next.kind === 'bar') return OrbitState.barColor(next, state.time + t) === state.color;
        const bottom = OrbitState.ringColor(next, state.time + t, Math.PI / 2) === state.color;
        const top = OrbitState.ringColor(next, state.time + t, -Math.PI / 2) === state.color;
        return state.y < next.y ? bottom : top;
      };
      if (next.kind === 'bar') {
        target = next.y - 9;
        if (state.y > next.y - 18 && [0.1, 0.4, 0.8, 1.2].every(lead)) committed = next;
        if (committed === next) target = next.y + 10;
      } else if (state.y < next.y - next.r - 4) {
        target = next.y - next.r - 8;
        if (state.y > next.y - next.r - 14 && [0.1, 0.35, 0.7, 1.0].every(lead)) committed = next;
        if (committed === next) target = next.y;
      } else if (state.y < next.y + next.r - 6) {
        // inside the ring: hover at the centre until the top arc matches, then rise
        target = next.y;
        const topMatches = [0.1, 0.4, 0.7, 1.0].every(t => OrbitState.ringColor(next, state.time + t, -Math.PI / 2) === state.color);
        if (topMatches) exiting = next;
        if (exiting === next) target = next.y + next.r + 8;
      } else target = next.y + next.r + 10;
    }
    const far = target - state.y > 5;
    if (now - last < (far ? Math.min(wait, 110 + (wait % 60)) : wait)) return;
    const want = Math.max(-8, Math.min(26, (target - state.y) * 2.2));
    if (state.vy < want) { state.tap(); last = now; wait = rng.range(options.gap[0], options.gap[1]); }
  };
}

function run(seed: number, kind: 'beginner' | 'steady' | 'mash' | 'idle', stepMs = DT, limitMs = 150_000) {
  const state = new OrbitState(createRng(seed));
  const rng = createRng(seed + 1000);
  const play = kind === 'beginner' ? bot(state, rng, {gap: [250, 450]}) : kind === 'steady' ? bot(state, rng, {gap: [250, 350]}) : undefined;
  state.tap();
  let now = 0;
  for (; now < limitMs && state.alive; now += stepMs) {
    if (kind === 'mash' && Math.floor(now / 60) !== Math.floor((now + stepMs) / 60)) state.tap();
    play?.(now);
    state.step(stepMs);
  }
  return state;
}

test('a tap is gentle: from rest it lifts about the ring radius at most, and taps never stack past the cap', () => {
  const s = new OrbitState(createRng(1)); s.obstacles = []; s.prisms = [];
  s.tap();
  let top = 0;
  for (let t = 0; t < 2000; t += DT) { s.step(DT); top = Math.max(top, s.y); }
  assert.ok(top > 1 && top < RING_R * 0.4, `one tap lifts ${top.toFixed(1)} units`);
  const m = new OrbitState(createRng(1)); m.obstacles = []; m.prisms = [];
  let fastest = 0;
  for (let t = 0; t < 3000; t += DT) { if (Math.floor(t / 20) !== Math.floor((t + DT) / 20)) m.tap(); m.step(DT); fastest = Math.max(fastest, m.vy); }
  assert.ok(fastest <= TAP_CAP + 1e-9);
  const before = new OrbitState(createRng(1)); before.tap(); const v = before.vy; before.tap();
  assert.equal(before.vy, v, 'taps inside the cooldown are ignored');
  assert.ok(TAP_GAP < 0.15);
});

test('hovering: ordinary tap intervals keep the ball in the central band of a ring for over 1.2 s', () => {
  for (const [lo, hi, seed] of [[250, 450, 1], [250, 450, 2], [300, 300, 3], [350, 350, 4], [250, 350, 5]] as const) {
    const s = new OrbitState(createRng(seed)); s.prisms = [];
    const ring = {kind: 'ring' as const, y: 40, r: RING_R, speed: 0.9, phase: 0};
    s.obstacles = [ring];
    s.y = 40; s.started = true; s.color = OrbitState.ringColor(ring, 0, -Math.PI / 2);
    const rng = createRng(seed);
    let next = 0, inBand = 0, longest = 0;
    for (let t = 0; t < 4000 && s.alive; t += DT) {
      if (t >= next) { s.tap(); next = t + rng.range(lo, hi); }
      s.step(DT);
      if (Math.abs(s.y - ring.y) < clear(ring) - 1.5) { inBand += DT; longest = Math.max(longest, inBand); } else inBand = 0;
    }
    assert.ok(longest >= 1200, `${lo}-${hi}ms seed ${seed}: stayed ${longest} ms in the band`);
  }
});

test('entering a ring, hovering at its centre, then leaving through the matching colour of the upper ring', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = new OrbitState(createRng(seed)); s.prisms = [];
    const low = {kind: 'ring' as const, y: 50, r: RING_R, speed: 0.9, phase: seed};
    const high = {kind: 'ring' as const, y: 115, r: RING_R, speed: 1.0, phase: 2 * seed};
    s.obstacles = [low, high];
    const play = bot(s, createRng(seed + 50), {gap: [250, 450]});
    s.tap();
    let entered = 0, centred = 0, longest = 0, exited = false;
    for (let t = 0; t < 60_000 && s.alive && !exited; t += DT) {
      play(t);
      s.step(DT);
      if (Math.abs(s.y - low.y) < 3) entered += DT;
      if (Math.abs(s.y - low.y) < clear(low) - 1.5) { centred += DT; longest = Math.max(longest, centred); } else centred = 0;
      exited = s.y > high.y + RING_R + 4;
    }
    assert.ok(entered > 0 && exited && s.alive, `seed ${seed}: entered ${entered}, exited ${exited}, alive ${s.alive}`);
    assert.ok(longest >= 300, `seed ${seed}: spent ${longest} ms in the centre band`);
  }
});

test('wrong colour contact ends the run', () => {
  const s = new OrbitState(createRng(8)); s.prisms = [];
  const ring = {kind: 'ring' as const, y: 40, r: RING_R, speed: 0, phase: 0};
  s.obstacles = [ring]; s.started = true; s.y = 40 - RING_R - 8;
  s.color = (OrbitState.ringColor(ring, 0, Math.PI / 2) + 1) % COLORS;
  for (let t = 0; t < 5000 && s.alive; t += DT) { if (s.vy < 15) s.tap(); s.step(DT); }
  assert.equal(s.alive, false);
  assert.ok(s.y < ring.y, 'stopped at the bottom arc');
});

test('a reasonable bot passes at least 8 obstacles on every seed; a steady one does better', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const s = run(seed, 'beginner');
    assert.ok(s.score >= 8, `beginner seed ${seed}: score ${s.score}, alive ${s.alive}`);
  }
  for (const seed of [1, 2, 3]) assert.ok(run(seed, 'steady', DT, 90_000).score >= 8);
});

test('careless play still loses: mashing, never tapping again', () => {
  let masher = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const mash = run(seed, 'mash', DT, 60_000);
    masher += mash.score;
    assert.equal(mash.alive, false, `masher seed ${seed} survived`);
    const idle = run(seed, 'idle', DT, 60_000);
    assert.equal(idle.alive, false);
    assert.ok(idle.score === 0);
  }
  assert.ok(masher / 6 < 8, `mashing averages ${masher / 6}`);
});

test('difficulty rises: ring speed, bars and tighter spacing grow, while the first obstacles stay slow', () => {
  const s = new OrbitState(createRng(9));
  while (s.obstacles.length < 60) s.step(DT), s.y += 0, (s as unknown as {spawn(): void}).spawn();
  const rings = s.obstacles.filter((o): o is Extract<Obstacle, {kind: 'ring'}> => o.kind === 'ring');
  const early = rings.slice(0, 3).map(o => Math.abs(o.speed));
  const late = rings.slice(-3).map(o => Math.abs(o.speed));
  assert.ok(Math.max(...early) <= 1.0, `early ring speeds ${early}`);
  assert.ok(Math.min(...late) > 1.6);
  const bars = s.obstacles.filter(o => o.kind === 'bar');
  assert.ok(s.obstacles.slice(0, 4).every(o => o.kind === 'ring'), 'no bar in the first four');
  assert.ok(bars.length >= 5);
  assert.ok(Math.abs(bars[0]!.speed) < Math.abs(bars.at(-1)!.speed));
});

test('generated sequences are never unavoidable: every window outlasts crossing, prisms never repeat the colour', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    const s = new OrbitState(createRng(seed));
    for (let i = 0; i < 80; i += 1) (s as unknown as {spawn(): void}).spawn();
    const crossing = (RING_T + 2 * BALL_R) / 15; // seconds to cross a band at a slow 15 units/s
    s.obstacles.forEach((o, index) => {
      if (o.kind === 'ring') {
        assert.ok(Math.abs(o.speed) > 0.3 && (Math.PI / 2) / Math.abs(o.speed) > crossing + 0.4, `ring ${index}`);
        for (let colour = 0; colour < COLORS; colour += 1) {
          let seen = false;
          for (let t = 0; t < (2 * Math.PI) / Math.abs(o.speed); t += 0.05) seen ||= OrbitState.ringColor(o, t, -Math.PI / 2) === colour && OrbitState.ringColor(o, t, Math.PI / 2) === (colour + 2) % COLORS;
          assert.ok(seen, `ring ${index} shows every colour`);
        }
      } else assert.ok(Math.abs(o.speed) > 1 && 12 / Math.abs(o.speed) > 0.9 && Math.abs(o.speed) < 14, `bar ${index}`);
      if (index > 0) assert.ok(o.y - s.obstacles[index - 1]!.y >= 2 * RING_R + 20, 'obstacles never overlap');
      // No prism inside any obstacle's contact band: a forced colour change mid-crossing would be unavoidable.
      const half = o.kind === 'ring' ? RING_T / 2 + BALL_R : 3 / 2 + BALL_R;
      const radii = o.kind === 'ring' ? [o.r] : [0];
      for (const prism of s.prisms) for (const radius of radii) for (const edge of [o.y - radius, o.y + radius]) assert.ok(Math.abs(prism.y - edge) > half + 2.5, `prism at ${prism.y} touches the band at ${edge}`);
    });
  }
});

test('step rate does not change the motion or the outcome', () => {
  const trace = (step: number) => {
    const s = new OrbitState(createRng(11)); s.obstacles = []; s.prisms = [];
    const out: number[] = [];
    for (let t = 0; t < 4000; t += step) { if (t % 300 === 0) s.tap(); if (t % 500 === 0) out.push(s.y); s.step(step); }
    return out;
  };
  const a = trace(10), b = trace(20), c = trace(25), d = trace(5);
  a.forEach((y, i) => { assert.ok(Math.abs(y - b[i]!) < 0.01 && Math.abs(y - c[i]!) < 0.01 && Math.abs(y - d[i]!) < 0.01); });
  const scored = [5, 10, 20, 25].map(step => run(3, 'idle', step, 60_000).score);
  assert.deepEqual(scored, [0, 0, 0, 0]);
});

function memory(initial: GameRecord = {}): GameRecordHandle {
  let data = structuredClone(initial);
  return {get: () => structuredClone(data), set: next => { data = structuredClone(next); return true; }, update: change => { const copy = structuredClone(data); change(copy); data = copy; return true; }};
}

test('the same tap schedule gives the same result at 28x12, 80x24 and 160x50', () => {
  const outcomes = [[28, 12], [80, 24], [160, 50]].map(([columns, rows]) => {
    const game = orbitGame.create({size: {columns: columns!, rows: rows!}, seed: 4, rng: createRng(4), motion: {reduced: false, effects: 'normal'}, color: 'truecolor', safeGlyphs: false, record: memory(), now: () => 0, today: '2026-10-21'} as GameContext);
    for (let t = 0; t < 60_000 && game.status !== 'over'; t += 10) {
      if (t % 330 === 0) game.key({kind: 'text', value: ' '});
      game.step(10); game.animate(10);
    }
    return `${game.status}:${game.result?.score}`;
  });
  assert.equal(outcomes[0], outcomes[1]);
  assert.equal(outcomes[1], outcomes[2]);
});
