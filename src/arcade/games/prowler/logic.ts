import type {Rng} from '../../rng.js';

/**
 * Maze Prowler's rules. The cat eats every dot in a maze while four hunters chase it; each hunter thinks differently:
 *  - Rascal (`chaser`) heads straight for the cat along the shortest path (BFS distances),
 *  - Ambush (`ambusher`) aims at the tile four steps ahead of the cat and plans with A*,
 *  - Patrol (`patroller`) walks the four corners but breaks off to chase when the cat is within CHASE_RANGE steps,
 *  - Wander (`wanderer`) picks a random turn at junctions and only now and then goes for the cat.
 * A power treat frightens them (they turn around and wander slowly, and can be eaten for 200, 400, 800, 1600; an eaten
 * hunter returns to the den as eyes). Being caught costs a life. Clearing the dots starts the next level: a new maze,
 * faster hunters and a shorter fright.
 *
 * Mazes are generated with a recursive backtracker on odd coordinates (a perfect maze), then braided: most dead ends
 * are opened and a few extra walls removed, so there are loops to run around and no corner can trap the cat.
 */
export const DIRS = [{dx: 0, dy: -1}, {dx: 1, dy: 0}, {dx: 0, dy: 1}, {dx: -1, dy: 0}] as const;
export type Dir = 0 | 1 | 2 | 3;
export const opposite = (dir: Dir): Dir => ((dir + 2) % 4) as Dir;
export const CHASE_RANGE = 7;
export const AMBUSH_AHEAD = 4;
export const START_LIVES = 3;
export const PLAYER_SPEED = 6.2;

export type HunterKind = 'chaser' | 'ambusher' | 'patroller' | 'wanderer';
export const HUNTERS: readonly HunterKind[] = ['chaser', 'ambusher', 'patroller', 'wanderer'];
export type HunterMode = 'den' | 'hunt' | 'scared' | 'eyes';
export type Phase = 'ready' | 'play' | 'dying' | 'cleared' | 'over';
export interface Tile { x: number; y: number }

export interface Mover { x: number; y: number; dir: Dir | -1; t: number }
export interface Hunter extends Mover { kind: HunterKind; mode: HunterMode; release: number; waypoint: number; target: Tile }

export type ProwlerEvent =
  | {kind: 'dot'} | {kind: 'power'; x: number; y: number}
  | {kind: 'eat'; hunter: HunterKind; points: number; x: number; y: number}
  | {kind: 'caught'} | {kind: 'cleared'; level: number} | {kind: 'level'; level: number} | {kind: 'over'} | {kind: 'extra'};

export class Maze {
  readonly walls: boolean[];
  constructor(readonly width: number, readonly height: number) { this.walls = new Array<boolean>(width * height).fill(true); }
  wall(x: number, y: number): boolean { return x < 0 || y < 0 || x >= this.width || y >= this.height || this.walls[y * this.width + x]!; }
  set(x: number, y: number, wall: boolean): void { this.walls[y * this.width + x] = wall; }
  open(x: number, y: number, dir: Dir): boolean { return !this.wall(x + DIRS[dir].dx, y + DIRS[dir].dy); }
  exits(x: number, y: number): Dir[] { return ([0, 1, 2, 3] as const).filter(dir => this.open(x, y, dir)); }
  get floors(): Tile[] { const out: Tile[] = []; for (let y = 0; y < this.height; y += 1) for (let x = 0; x < this.width; x += 1) if (!this.wall(x, y)) out.push({x, y}); return out; }

  /** Shortest-path steps from `from` to every tile (-1 where unreachable). */
  distances(from: Tile): Int32Array {
    const dist = new Int32Array(this.width * this.height).fill(-1);
    const queue = [from.y * this.width + from.x];
    dist[queue[0]!] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const at = queue[head]!;
      const x = at % this.width, y = (at - x) / this.width;
      for (const dir of this.exits(x, y)) {
        const next = (y + DIRS[dir].dy) * this.width + x + DIRS[dir].dx;
        if (dist[next]! < 0) { dist[next] = dist[at]! + 1; queue.push(next); }
      }
    }
    return dist;
  }

  /** A* with the Manhattan heuristic: the tiles from `from` to `to` inclusive, or undefined. */
  path(from: Tile, to: Tile, banned?: Tile): Tile[] | undefined {
    const key = (t: Tile): number => t.y * this.width + t.x;
    const best = new Map<number, number>([[key(from), 0]]);
    const came = new Map<number, number>();
    const open: Array<{tile: Tile; g: number; f: number}> = [{tile: from, g: 0, f: Math.abs(from.x - to.x) + Math.abs(from.y - to.y)}];
    while (open.length > 0) {
      let index = 0;
      for (let i = 1; i < open.length; i += 1) if (open[i]!.f < open[index]!.f) index = i;
      const current = open.splice(index, 1)[0]!;
      if (current.tile.x === to.x && current.tile.y === to.y) {
        const out: Tile[] = [current.tile];
        for (let at = key(current.tile); came.has(at); at = came.get(at)!) out.unshift({x: came.get(at)! % this.width, y: Math.floor(came.get(at)! / this.width)});
        return out;
      }
      if (current.g > (best.get(key(current.tile)) ?? Infinity)) continue;
      for (const dir of this.exits(current.tile.x, current.tile.y)) {
        const next = {x: current.tile.x + DIRS[dir].dx, y: current.tile.y + DIRS[dir].dy};
        if (banned && next.x === banned.x && next.y === banned.y) continue;
        const g = current.g + 1;
        if (g >= (best.get(key(next)) ?? Infinity)) continue;
        best.set(key(next), g);
        came.set(key(next), key(current.tile));
        open.push({tile: next, g, f: g + Math.abs(next.x - to.x) + Math.abs(next.y - to.y)});
      }
    }
    return undefined;
  }
}

/** Largest odd size not above `limit`, at least `min`. */
export const oddFit = (limit: number, min: number, max: number): number => { const n = Math.max(min, Math.min(max, Math.floor(limit))); return n % 2 === 1 ? n : n - 1; };

export function generateMaze(rng: Rng, width: number, height: number): Maze {
  const maze = new Maze(width, height);
  const stack: Tile[] = [{x: 1, y: 1}];
  maze.set(1, 1, false);
  while (stack.length > 0) {
    const at = stack[stack.length - 1]!;
    const options = ([0, 1, 2, 3] as const).filter(dir => { const x = at.x + DIRS[dir].dx * 2, y = at.y + DIRS[dir].dy * 2; return x > 0 && y > 0 && x < width - 1 && y < height - 1 && maze.wall(x, y); });
    if (options.length === 0) { stack.pop(); continue; }
    const dir = rng.pick(options);
    maze.set(at.x + DIRS[dir].dx, at.y + DIRS[dir].dy, false);
    maze.set(at.x + DIRS[dir].dx * 2, at.y + DIRS[dir].dy * 2, false);
    stack.push({x: at.x + DIRS[dir].dx * 2, y: at.y + DIRS[dir].dy * 2});
  }
  // Braid: open the walls beside dead ends, then a few more for loops.
  const removable = (x: number, y: number): boolean => x > 0 && y > 0 && x < width - 1 && y < height - 1 && maze.wall(x, y) && ((!maze.wall(x - 1, y) && !maze.wall(x + 1, y)) !== (!maze.wall(x, y - 1) && !maze.wall(x, y + 1)));
  for (const tile of maze.floors) {
    if (maze.exits(tile.x, tile.y).length !== 1 || !rng.chance(0.85)) continue;
    const walls = ([0, 1, 2, 3] as const).map(dir => ({x: tile.x + DIRS[dir].dx, y: tile.y + DIRS[dir].dy})).filter(w => removable(w.x, w.y));
    if (walls.length > 0) { const w = rng.pick(walls); maze.set(w.x, w.y, false); }
  }
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) if (removable(x, y) && rng.chance(0.06)) maze.set(x, y, false);
  return maze;
}

export class ProwlerState {
  maze: Maze;
  level = 1;
  score = 0;
  lives = START_LIVES;
  phase: Phase = 'ready';
  phaseMs = 1400;
  started = false;
  player: Mover = {x: 0, y: 0, dir: -1, t: 0};
  want: Dir | -1 = -1;
  facing: Dir = 1;
  hunters: Hunter[] = [];
  dots = new Set<number>();
  powers = new Set<number>();
  frightMs = 0;
  combo = 0;
  time = 0;
  dotsEaten = 0;
  huntersEaten = 0;
  events: ProwlerEvent[] = [];
  private extra = false;
  private readonly corners: Tile[] = [];
  private playerStart: Tile = {x: 1, y: 1};
  private den: Tile = {x: 1, y: 1};
  /** A distance map from the cat's tile, recomputed when the cat enters a new tile. */
  private fromPlayer: Int32Array = new Int32Array(0);
  private fromPlayerAt = -1;

  constructor(private readonly rng: Rng, readonly width: number, readonly height: number) {
    this.maze = generateMaze(rng.fork('maze'), width, height);
    this.setup();
  }

  get dotsLeft(): number { return this.dots.size + this.powers.size; }
  get frightened(): boolean { return this.frightMs > 0; }
  private idx(x: number, y: number): number { return y * this.width + x; }

  /** Fresh dots and positions for the current maze. */
  private setup(): void {
    const w = this.width, h = this.height;
    this.corners.length = 0;
    this.corners.push(...[{x: 1, y: 1}, {x: w - 2, y: 1}, {x: w - 2, y: h - 2}, {x: 1, y: h - 2}].map(t => this.nearestFloor(t)));
    this.den = this.nearestFloor({x: oddFit(w / 2, 1, w - 2), y: oddFit(h / 2, 1, h - 2)});
    this.playerStart = this.nearestFloor({x: oddFit(w / 2, 1, w - 2), y: h - 2});
    this.dots.clear(); this.powers.clear();
    for (const tile of this.maze.floors) this.dots.add(this.idx(tile.x, tile.y));
    this.dots.delete(this.idx(this.den.x, this.den.y));
    this.dots.delete(this.idx(this.playerStart.x, this.playerStart.y));
    for (const corner of this.corners) { this.dots.delete(this.idx(corner.x, corner.y)); this.powers.add(this.idx(corner.x, corner.y)); }
    this.resetPositions();
  }

  private nearestFloor(tile: Tile): Tile {
    const dist = this.maze.distances({x: 1, y: 1});
    let best: Tile = {x: 1, y: 1}, score = Infinity;
    for (const f of this.maze.floors) {
      const d = Math.abs(f.x - tile.x) + Math.abs(f.y - tile.y);
      if (dist[this.idx(f.x, f.y)]! >= 0 && d < score) { score = d; best = f; }
    }
    return best;
  }

  private resetPositions(): void {
    this.player = {x: this.playerStart.x, y: this.playerStart.y, dir: -1, t: 0};
    this.want = -1;
    const scale = Math.max(0.4, 1 - 0.1 * (this.level - 1));
    this.hunters = HUNTERS.map((kind, index) => ({x: this.den.x, y: this.den.y, dir: -1, t: 0, kind, mode: 'den' as HunterMode, release: index * 3 * scale, waypoint: index, target: this.den}));
    this.frightMs = 0;
    this.combo = 0;
    this.fromPlayerAt = -1;
    this.phase = 'ready';
    this.phaseMs = 1400;
    this.timeInLevel = 0;
  }
  timeInLevel = 0;

  // ---- movement -------------------------------------------------------------------------------------------------
  setWant(dir: Dir): void {
    this.started = true;
    this.want = dir;
    this.facing = dir;
    // Turning back around mid-tile is allowed at once.
    const p = this.player;
    if (p.dir !== -1 && dir === opposite(p.dir) && p.t > 0) this.reverse(p);
  }

  private reverse(m: Mover): void {
    if (m.dir === -1) return;
    // Same spot, seen from the tile ahead looking back: t becomes 1 - t.
    m.x += DIRS[m.dir].dx; m.y += DIRS[m.dir].dy; m.dir = opposite(m.dir); m.t = 1 - m.t;
  }

  position(m: Mover): {x: number; y: number} { return m.dir === -1 ? {x: m.x, y: m.y} : {x: m.x + DIRS[m.dir].dx * m.t, y: m.y + DIRS[m.dir].dy * m.t}; }
  tileOf(m: Mover): Tile { return m.dir !== -1 && m.t >= 0.5 ? {x: m.x + DIRS[m.dir].dx, y: m.y + DIRS[m.dir].dy} : {x: m.x, y: m.y}; }

  /** Move `m` along its direction by `distance` tiles, calling `arrive` at every tile centre to choose what next. */
  private travel(m: Mover, distance: number, arrive: (m: Mover) => void): void {
    let left = distance;
    for (let guard = 0; guard < 8 && left > 1e-9; guard += 1) {
      if (m.dir === -1) { arrive(m); if (m.dir === -1) return; continue; }
      const move = Math.min(left, 1 - m.t);
      m.t += move; left -= move;
      if (m.t >= 1 - 1e-9) { m.x += DIRS[m.dir].dx; m.y += DIRS[m.dir].dy; m.t = 0; arrive(m); }
    }
  }

  private playerArrive(m: Mover): void {
    const at = this.idx(m.x, m.y);
    if (this.dots.delete(at)) { this.score += 10; this.dotsEaten += 1; this.events.push({kind: 'dot'}); }
    if (this.powers.delete(at)) {
      this.score += 50;
      this.frightMs = Math.max(2500, 7000 - 700 * (this.level - 1));
      this.combo = 0;
      for (const h of this.hunters) if (h.mode === 'hunt') { h.mode = 'scared'; this.reverse(h); }
      this.events.push({kind: 'power', x: m.x, y: m.y});
    }
    if (this.score >= 5000 && !this.extra) { this.extra = true; this.lives = Math.min(5, this.lives + 1); this.events.push({kind: 'extra'}); }
    if (this.want !== -1 && this.maze.open(m.x, m.y, this.want)) m.dir = this.want;
    else if (m.dir !== -1 && !this.maze.open(m.x, m.y, m.dir)) m.dir = -1;
  }

  // ---- the hunters' minds ---------------------------------------------------------------------------------------
  private playerDistances(): Int32Array {
    const tile = this.tileOf(this.player);
    const at = this.idx(tile.x, tile.y);
    if (at !== this.fromPlayerAt) { this.fromPlayer = this.maze.distances(tile); this.fromPlayerAt = at; }
    return this.fromPlayer;
  }

  /** The tile the cat is heading for, `steps` ahead (stops at a wall). */
  ahead(steps: number): Tile {
    const tile = this.tileOf(this.player);
    const dir = this.player.dir !== -1 ? this.player.dir : this.facing;
    let x = tile.x, y = tile.y;
    for (let i = 0; i < steps && this.maze.open(x, y, dir); i += 1) { x += DIRS[dir].dx; y += DIRS[dir].dy; }
    return {x, y};
  }

  /** The direction a hunter takes on arriving at a tile, by its own way of thinking. */
  decide(h: Hunter): Dir | -1 {
    const exits = this.maze.exits(h.x, h.y);
    if (exits.length === 0) return -1;
    const back = h.dir === -1 ? undefined : opposite(h.dir);
    const options = exits.filter(dir => dir !== back);
    const choices = options.length > 0 ? options : exits;
    if (choices.length === 1) return choices[0]!;
    const here = {x: h.x, y: h.y};
    const step = (dir: Dir): Tile => ({x: h.x + DIRS[dir].dx, y: h.y + DIRS[dir].dy});
    const nearest = (map: Int32Array): Dir => choices.reduce((best, dir) => (map[this.idx(step(dir).x, step(dir).y)]! < map[this.idx(step(best).x, step(best).y)]! ? dir : best), choices[0]!);
    if (h.mode === 'scared') return this.rng.pick(choices);
    if (h.mode === 'eyes') return nearest(this.maze.distances(this.den));
    switch (h.kind) {
      case 'chaser':
        h.target = this.tileOf(this.player);
        return nearest(this.playerDistances());
      case 'ambusher': {
        h.target = this.ahead(AMBUSH_AHEAD);
        let best = choices[0]!, length = Infinity;
        for (const dir of choices) {
          const path = this.maze.path(step(dir), h.target, here);
          const cost = path ? path.length : 1e6;
          if (cost < length) { length = cost; best = dir; }
        }
        return best;
      }
      case 'patroller': {
        const near = this.playerDistances()[this.idx(h.x, h.y)]!;
        if (near >= 0 && near <= CHASE_RANGE) { h.target = this.tileOf(this.player); return nearest(this.playerDistances()); }
        let goal = this.corners[h.waypoint % this.corners.length]!;
        if (goal.x === h.x && goal.y === h.y) { h.waypoint = (h.waypoint + 1) % this.corners.length; goal = this.corners[h.waypoint]!; }
        h.target = goal;
        return nearest(this.maze.distances(goal));
      }
      case 'wanderer':
        if (this.rng.chance(0.25)) { h.target = this.tileOf(this.player); return nearest(this.playerDistances()); }
        h.target = here;
        return this.rng.pick(choices);
    }
  }

  private hunterSpeed(h: Hunter): number {
    if (h.mode === 'eyes') return 11;
    if (h.mode === 'scared') return 3.4;
    return Math.min(6.4, 4.8 + 0.25 * (this.level - 1));
  }

  // ---- the clock ------------------------------------------------------------------------------------------------
  step(dtMs: number): void {
    if (!this.started || this.phase === 'over') return;
    const dt = dtMs / 1000;
    if (this.phase !== 'play') {
      this.phaseMs -= dtMs;
      if (this.phaseMs > 0) return;
      if (this.phase === 'ready') this.phase = 'play';
      else if (this.phase === 'dying') {
        this.lives -= 1;
        if (this.lives <= 0) { this.phase = 'over'; this.events.push({kind: 'over'}); } else this.resetPositions();
      } else if (this.phase === 'cleared') {
        this.level += 1;
        this.maze = generateMaze(this.rng.fork(`maze${this.level}`), this.width, this.height);
        this.setup();
        this.events.push({kind: 'level', level: this.level});
      }
      return;
    }
    this.time += dt;
    this.timeInLevel += dt;
    if (this.frightMs > 0) {
      this.frightMs = Math.max(0, this.frightMs - dtMs);
      if (this.frightMs === 0) for (const h of this.hunters) if (h.mode === 'scared') h.mode = 'hunt';
    }
    this.travel(this.player, PLAYER_SPEED * dt, m => this.playerArrive(m));
    if (this.player.dir === -1 && this.want !== -1 && this.maze.open(this.player.x, this.player.y, this.want)) this.player.dir = this.want;
    for (const h of this.hunters) {
      if (h.mode === 'den') {
        if (this.timeInLevel >= h.release) h.mode = this.frightMs > 0 ? 'scared' : 'hunt'; else continue;
      }
      this.travel(h, this.hunterSpeed(h) * dt, m => {
        const hunter = m as Hunter;
        if (hunter.mode === 'eyes' && hunter.x === this.den.x && hunter.y === this.den.y) { hunter.mode = 'den'; hunter.release = this.timeInLevel + 1.2; hunter.dir = -1; return; }
        hunter.dir = this.decide(hunter);
      });
    }
    this.collide();
    if (this.phase === 'play' && this.dotsLeft === 0) {
      this.score += 500 * this.level;
      this.phase = 'cleared';
      this.phaseMs = 1500;
      this.events.push({kind: 'cleared', level: this.level});
    }
  }

  private collide(): void {
    const p = this.position(this.player);
    for (const h of this.hunters) {
      if (h.mode === 'den' || h.mode === 'eyes') continue;
      const q = this.position(h);
      if (Math.hypot(p.x - q.x, p.y - q.y) > 0.6) continue;
      if (h.mode === 'scared') {
        const points = 200 * 2 ** this.combo;
        this.combo = Math.min(3, this.combo + 1);
        this.score += points;
        this.huntersEaten += 1;
        h.mode = 'eyes';
        this.events.push({kind: 'eat', hunter: h.kind, points, x: q.x, y: q.y});
      } else {
        this.phase = 'dying';
        this.phaseMs = 1000;
        this.events.push({kind: 'caught'});
        return;
      }
    }
  }
}
