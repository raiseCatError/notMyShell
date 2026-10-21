import type {Rng} from '../../rng.js';

/**
 * Kitten Parade's rules. A crowd of kittens runs up a three-lane road through a finite campaign of LEVELS levels. Each
 * level is a run of gate rows (`+n`, `-n`, `×n`, `÷n`, a saw that takes a quarter and one more) and rival waves, and ends
 * at a boss formation that fills the whole road. Lane changes are instant.
 *
 * Combat is deterministic, not scripted: when the crowd reaches a rival group both sides trade blows in exchanges of
 * `k` members each (k = ceil(smaller side / ROUNDS), at least 1, never more than either side has) until one side is gone.
 * The survivors are therefore `crowd - rivals`; a tie wipes both out and counts as a defeat. A rival group is drawn as a
 * cluster with its real count above it.
 *
 * Fairness. Every operation is monotone in the crowd size, and the lanes are free to change between rows, so the best
 * lane in every row (the one leaving the biggest crowd) is the optimal play. The generator walks that optimal path:
 * it sizes each good gate to keep the optimal crowd on a rising curve, each wave to cost the optimal crowd a modest share
 * (with its other lanes ruinous or lethal) and each boss to need only `crowd / ratio` with ratio in [BOSS_RATIO_MIN,
 * BOSS_RATIO_MAX], so a perfect run always wins by a real, bounded margin and a poor run loses. Rows are at least
 * MIN_GAP_S apart.
 */
export const LANES = 3;
export const LEVELS = 5;
export const START_COUNT = 3;
export const MAX_COUNT = 999_999;
export const MIN_GAP_S = 1.1;
export const ROW_LENGTH = 4;
/** How far ahead of a rival group, in metres, the crowd stops to fight it. */
export const ENEMY_REACH = 8;
export const LOOKAHEAD = 70;
/** The most kitten (or rival) sprites ever drawn, whatever the count. */
export const MAX_DRAWN = 48;
export const MAX_ENEMY_DRAWN = 24;
/** Milliseconds per exchange of blows, and the number of exchanges a fight is spread over. */
export const ROUND_MS = 150;
export const ROUNDS = 8;
export const BOSS_ROUNDS = 14;
export const CLEAR_MS = 2200;
export const BOSS_RATIO_MIN = 1.3;
export const BOSS_RATIO_MAX = 2.1;
/** The optimal crowd just before each level's boss. */
export const LEVEL_TARGET = [30, 70, 140, 260, 450] as const;
export const levelLength = (level: number): number => 8 + 2 * level;
export const speedFor = (level: number): number => 9 + 1.3 * (level - 1);
/** Recruits who join the survivors when a boss falls. */
export const recruits = (level: number): number => 2 + 2 * level;

export type Op = '+' | '-' | '×' | '÷';
export type Gate = {kind: 'gate'; op: Op; n: number} | {kind: 'saw'};
export type Enemy = {kind: 'enemy'; n: number; boss?: true};
export type Cell = Gate | Enemy | null;
export type RowKind = 'gate' | 'wave' | 'boss';
export interface Row { z: number; cells: [Cell, Cell, Cell]; kind: RowKind; level: number; applied: boolean; fought: number }
export interface Battle { lane: number; boss: boolean; crowd0: number; enemy0: number; crowd: number; enemy: number; step: number; ms: number }
export type ParadeEvent =
  | {kind: 'lane'; lane: number}
  | {kind: 'gate'; lane: number; op: Op; before: number; after: number; good: boolean}
  | {kind: 'saw'; lane: number; before: number; after: number; good: boolean}
  | {kind: 'empty'; lane: number}
  | {kind: 'battle'; lane: number; boss: boolean; crowd: number; enemy: number}
  | {kind: 'exchange'; lost: number; crowd: number; enemy: number; boss: boolean}
  | {kind: 'routed'; boss: boolean; survivors: number; enemy: number}
  | {kind: 'level'; level: number; recruits: number}
  | {kind: 'victory'}
  | {kind: 'dead'; boss: boolean; crowd0: number; enemy0: number; enemyLeft: number}
  | {kind: 'milestone'; meters: number};

/** The count after passing a cell. */
export function applyCell(count: number, cell: Cell): number {
  if (!cell) return count;
  if (cell.kind === 'enemy') return Math.max(0, count - cell.n);
  if (cell.kind === 'saw') return Math.max(0, count - (Math.ceil(count / 4) + 1));
  switch (cell.op) {
    case '+': return Math.min(MAX_COUNT, count + cell.n);
    case '-': return Math.max(0, count - cell.n);
    case '×': return Math.min(MAX_COUNT, count * cell.n);
    case '÷': return Math.floor(count / cell.n);
  }
}

export const cellText = (cell: Cell): string => (!cell ? '' : cell.kind === 'saw' ? 'SAW' : cell.kind === 'enemy' ? `${cell.boss ? 'B' : '!'}${compact(cell.n)}` : `${cell.op}${cell.n}`);

/** The lane that leaves the biggest crowd (the middle one on a tie, then the lowest): the optimal play for a row. */
export function bestLane(count: number, row: Row): number {
  let best = 1;
  for (const lane of [1, 0, 2]) if (applyCell(count, row.cells[lane]!) > applyCell(count, row.cells[best]!)) best = lane;
  return best;
}

/** The count as short text: 1,234 stays, 12,345 becomes 12.3k. */
export function compact(count: number): string {
  if (count < 10_000) return String(count);
  if (count < 1_000_000) return `${(Math.floor(count / 100) / 10).toFixed(1)}k`;
  return `${(Math.floor(count / 100_000) / 10).toFixed(1)}M`;
}

/**
 * Where to draw the sprites for a crowd of `count`: at most `cap` of them, packed into rows of at most `maxColumns`,
 * centered on x = 0 and growing downward from y = 0. Positions are in sprite units.
 */
export function crowdLayout(count: number, cap: number, maxColumns: number): Array<{x: number; y: number}> {
  const drawn = Math.max(0, Math.min(Math.floor(count), cap));
  const columns = Math.max(1, Math.min(maxColumns, Math.ceil(Math.sqrt(drawn * 1.6))));
  const out: Array<{x: number; y: number}> = [];
  for (let index = 0; index < drawn; index += 1) {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, drawn - row * columns);
    out.push({x: (index % columns) - (inRow - 1) / 2, y: row});
  }
  return out;
}

/** The exchange size for a fight between `crowd` and `enemy`. */
export const exchangeSize = (crowd: number, enemy: number, boss: boolean): number => Math.max(1, Math.ceil(Math.min(crowd, enemy) / (boss ? BOSS_ROUNDS : ROUNDS)));

/** The whole campaign's rows, generated up front from the rng (deterministic), walking the optimal path. */
export function generateCampaign(rng: Rng): Row[] {
  const rows: Row[] = [];
  let est = START_COUNT;
  let z = 14;
  for (let level = 1; level <= LEVELS; level += 1) {
    const speed = speedFor(level);
    const length = levelLength(level);
    const start = est;
    const wavesAt = new Set(length > 10 ? [3, 7] : [3]);
    if (length > 14) wavesAt.add(11);
    let firstWave = true;
    for (let index = 0; index < length; index += 1) {
      const target = start * Math.pow(LEVEL_TARGET[level - 1]! / Math.max(1, start), (index + 1) / length);
      const need = Math.max(0, target - est);
      let cells: [Cell, Cell, Cell];
      let kind: RowKind;
      if (wavesAt.has(index)) {
        kind = 'wave';
        const small = Math.max(1, Math.round(est * (0.1 + 0.03 * level + rng.range(0, 0.06))));
        const medium = Math.max(small + 1, Math.min(est - 1, Math.round(est * rng.range(0.5, 0.8))));
        const big = Math.max(medium + 1, est + 1, Math.round(est * rng.range(1.15, 1.6)));
        // The first wave of each level always puts the lethal group on the middle lane: standing still never survives.
        const lanes = firstWave ? (rng.chance(0.5) ? [0, 2, 1] : [2, 0, 1]) : rng.shuffle([0, 1, 2]);
        firstWave = false;
        cells = [null, null, null];
        cells[lanes[0]!] = {kind: 'enemy', n: small};
        cells[lanes[1]!] = {kind: 'enemy', n: medium};
        cells[lanes[2]!] = {kind: 'enemy', n: big};
        est -= small;
      } else {
        kind = 'gate';
        let good: Gate;
        const swing = est >= 3 && est <= 200 && index > 0 && index < length - 1 && rng.chance(0.28);
        if (swing) good = {kind: 'gate', op: '×', n: est <= 10 && rng.chance(0.4) ? 3 : 2};
        else if (est >= 2 && need >= est * 0.9 && rng.chance(0.55)) good = {kind: 'gate', op: '×', n: need >= est * 1.8 && est <= 14 && rng.chance(0.5) ? 3 : 2};
        else good = {kind: 'gate', op: '+', n: Math.max(2, Math.round(need * rng.range(0.9, 1.15)) + rng.int(0, 2))};
        const decoy: Cell = rng.chance(0.3) ? null : {kind: 'gate', op: '+', n: Math.max(1, Math.round(Math.max(good.op === '+' ? good.n : swing ? est * 0.8 : need, 2) * rng.range(0.25, 0.6)))};
        const roll = rng.next();
        const trap: Cell = roll < 0.4 ? {kind: 'gate', op: '-', n: Math.max(2, Math.round(est * rng.range(0.25, 0.7)))}
          : roll < 0.65 ? {kind: 'gate', op: '÷', n: est > 40 && rng.chance(0.3) ? 3 : 2}
            : {kind: 'saw'};
        const [a, b, c] = rng.shuffle<Cell>([good, decoy, trap]);
        cells = [a!, b!, c!];
        est = Math.max(...cells.map(cell => applyCell(est, cell)));
      }
      const gap = Math.max(MIN_GAP_S, (kind === 'wave' ? 2 : 1.55) + rng.range(0, 0.35));
      if (rows.length > 0) z += gap * speed + ROW_LENGTH; else z = 14;
      rows.push({z, cells, kind, level, applied: false, fought: -1});
    }
    // The boss formation: the same rival group in every lane, sized so the optimal crowd wins by a bounded margin.
    const ratio = level === 1 ? rng.range(1.6, BOSS_RATIO_MAX) : rng.range(BOSS_RATIO_MIN + 0.05, 1.75);
    const boss: Enemy = {kind: 'enemy', n: Math.max(3, Math.floor(est / ratio)), boss: true};
    z += (2.4 + rng.range(0, 0.3)) * speed + ROW_LENGTH;
    rows.push({z, cells: [boss, boss, boss], kind: 'boss', level, applied: false, fought: -1});
    est = est - boss.n + recruits(level);
  }
  return rows;
}

export class ParadeState {
  time = 0;
  /** Distance run, in metres. */
  z = 0;
  lane = 1;
  count = START_COUNT;
  peak = START_COUNT;
  alive = true;
  started = false;
  won = false;
  level = 1;
  rows: Row[];
  events: ParadeEvent[] = [];
  battle: Battle | undefined;
  /** Milliseconds left of the level-clear pause. */
  interlude = 0;
  gates = 0;
  streak = 0;
  /** Points from good choices, wins and survivors: see `score`. */
  points = 0;
  bossesDown = 0;
  rivalsBeaten = 0;
  perfect = 0;
  private milestone = 0;

  constructor(rng: Rng) { this.rows = generateCampaign(rng); }

  get speed(): number { return speedFor(this.level); }
  get meters(): number { return Math.floor(this.z); }
  get score(): number { return this.points + this.meters; }
  get over(): boolean { return !this.alive || this.won; }

  nextRow(): Row | undefined { return this.rows.find(row => !row.applied); }

  moveLane(direction: -1 | 1): boolean {
    if (!this.alive || this.won) return false;
    this.started = true;
    if (this.battle) return false;
    const lane = this.lane + direction;
    if (lane < 0 || lane >= LANES) return false;
    this.lane = lane;
    this.events.push({kind: 'lane', lane});
    return true;
  }

  private setCount(count: number): void { this.count = count; this.peak = Math.max(this.peak, count); }

  step(dtMs: number): void {
    if (this.over || !this.started) return;
    if (this.interlude > 0) {
      this.interlude -= dtMs;
      if (this.interlude <= 0) { this.interlude = 0; this.level += 1; }
      return;
    }
    if (this.battle) {
      this.battle.ms += dtMs;
      while (this.battle && this.battle.ms >= ROUND_MS) { this.battle.ms -= ROUND_MS; this.exchange(); }
      return;
    }
    this.time += dtMs / 1000;
    this.z += this.speed * (dtMs / 1000);
    const row = this.nextRow();
    if (row) {
      const cell = row.cells[this.lane] ?? null;
      const reach = cell?.kind === 'enemy' ? ENEMY_REACH : 0;
      if (row.z - reach <= this.z) this.hit(row, cell);
    }
    const mark = Math.floor(this.z / 500);
    if (mark > this.milestone) { this.milestone = mark; this.events.push({kind: 'milestone', meters: mark * 500}); }
  }

  private hit(row: Row, cell: Cell): void {
    row.applied = true;
    this.gates += 1;
    const before = this.count;
    const best = applyCell(before, row.cells[bestLane(before, row)]!);
    const after = applyCell(before, cell);
    const good = after >= best;
    if (good) { this.streak += 1; this.perfect += 1; this.points += 10 + 2 * Math.min(this.streak, 10); } else { this.streak = 0; this.points += 2; }
    if (cell?.kind === 'enemy') { this.startBattle(row, cell); return; }
    this.setCount(after);
    if (!cell) this.events.push({kind: 'empty', lane: this.lane});
    else if (cell.kind === 'saw') this.events.push({kind: 'saw', lane: this.lane, before, after, good});
    else this.events.push({kind: 'gate', lane: this.lane, op: cell.op, before, after, good});
    if (this.count <= 0) { this.alive = false; this.events.push({kind: 'dead', boss: false, crowd0: before, enemy0: 0, enemyLeft: 0}); }
  }

  private startBattle(row: Row, cell: Enemy): void {
    row.fought = this.lane;
    this.battle = {lane: this.lane, boss: Boolean(cell.boss), crowd0: this.count, enemy0: cell.n, crowd: this.count, enemy: cell.n, step: exchangeSize(this.count, cell.n, Boolean(cell.boss)), ms: 0};
    this.events.push({kind: 'battle', lane: this.lane, boss: Boolean(cell.boss), crowd: this.count, enemy: cell.n});
  }

  /** One exchange of blows: both sides lose the same number of members. */
  private exchange(): void {
    const battle = this.battle!;
    const lost = Math.min(battle.step, battle.crowd, battle.enemy);
    battle.crowd -= lost;
    battle.enemy -= lost;
    this.count = battle.crowd;
    this.events.push({kind: 'exchange', lost, crowd: battle.crowd, enemy: battle.enemy, boss: battle.boss});
    if (battle.crowd > 0 && battle.enemy > 0) return;
    this.battle = undefined;
    if (battle.crowd <= 0) {
      this.alive = false;
      this.events.push({kind: 'dead', boss: battle.boss, crowd0: battle.crowd0, enemy0: battle.enemy0, enemyLeft: battle.enemy});
      return;
    }
    this.rivalsBeaten += battle.enemy0;
    this.points += battle.enemy0 * 2 + Math.min(5000, battle.crowd) * (battle.boss ? 6 : 3);
    this.events.push({kind: 'routed', boss: battle.boss, survivors: battle.crowd, enemy: battle.enemy0});
    if (!battle.boss) return;
    this.bossesDown += 1;
    this.points += 500 * this.level;
    if (this.level >= LEVELS) {
      this.won = true;
      this.points += 2000 + Math.min(5000, this.count) * 5;
      this.events.push({kind: 'victory'});
      return;
    }
    const joined = recruits(this.level);
    this.setCount(this.count + joined);
    this.events.push({kind: 'level', level: this.level, recruits: joined});
    this.interlude = CLEAR_MS;
  }
}
