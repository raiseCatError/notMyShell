import {capSpeed, Substepper} from '../../engine/body.js';
import {circleBox, type Vec} from '../../engine/collide.js';
import {createRng, hashSeed} from '../../rng.js';

/**
 * Catapult Cats' world and physics, in world units (120 wide, 70 tall, y down, the ground at y = 60).
 *
 * A cat is a circle in ballistic flight (no air drag, so the dotted preview is exact). Structures are stacks of
 * axis-aligned blocks that fall, land, slide and shove each other with shared momentum: they translate but do not
 * rotate, which keeps stacks stable and the whole thing deterministic and cheap. Damage comes from impact speed, scaled
 * by who hits whom: a cat plows through a block it has the strength to break and bounces off one it does not, a block
 * dropped onto a target crushes it, a bomb damages everything within its radius by distance. Levels are generated from
 * `(seed, level)` alone, so a run is reproducible. Physics runs in fixed 240 Hz substeps whatever `step` is given.
 */
export const WORLD_W = 120;
export const WORLD_H = 70;
export const GROUND = 60;
export const GRAVITY = 70;
export const SUB_MS = 1000 / 240;
export const SLING = {x: 14, y: 47};
export const CAT_R = 2;
export const MIN_ANGLE = (8 * Math.PI) / 180;
export const MAX_ANGLE = (82 * Math.PI) / 180;
export const SPEED_MIN = 45;
export const SPEED_MAX = 90;
export const CAT_SPEED_CAP = 150;
export const BOMB_RADIUS = 15;

export type CatKind = 'tabby' | 'dash' | 'split' | 'boom';
export const CAT_KINDS: readonly CatKind[] = ['tabby', 'dash', 'split', 'boom'];
export const CAT_INFO: Readonly<Record<CatKind, {name: string; letter: string; ability: string}>> = {
  tabby: {name: 'Tabby', letter: 'T', ability: 'Plain and sturdy'},
  dash: {name: 'Dash', letter: 'D', ability: 'Space: speed boost'},
  split: {name: 'Triple', letter: 'S', ability: 'Space: splits in three'},
  boom: {name: 'Boom', letter: 'B', ability: 'Space or impact: explodes'},
};

export type Material = 'wood' | 'stone' | 'glass' | 'target';
export const MATERIAL: Readonly<Record<Material, {hp: number; density: number; points: number; letter: string}>> = {
  wood: {hp: 60, density: 1, points: 50, letter: '='},
  stone: {hp: 150, density: 2.2, points: 100, letter: '#'},
  glass: {hp: 22, density: 0.8, points: 30, letter: ':'},
  target: {hp: 14, density: 0.7, points: 500, letter: 'M'},
};

export interface Block {
  id: number; kind: Material;
  x: number; y: number; w: number; h: number;
  vx: number; vy: number;
  hp: number; maxHp: number; mass: number;
  dead: boolean;
  /** What it rests on: nothing, the ground or another block. */
  support: 'none' | 'ground' | Block;
}
export interface Cat { id: number; kind: CatKind; x: number; y: number; vx: number; vy: number; r: number; damage: number; used: boolean; ageMs: number; restMs: number; px: number; py: number }

export type CatapultEvent =
  | {kind: 'launch'; x: number; y: number}
  | {kind: 'hit'; x: number; y: number; material: Material; damage: number}
  | {kind: 'break'; x: number; y: number; w: number; h: number; material: Material; points: number}
  | {kind: 'explosion'; x: number; y: number}
  | {kind: 'ability'; cat: CatKind; x: number; y: number}
  | {kind: 'poof'; x: number; y: number}
  | {kind: 'clear'; stars: number; bonus: number}
  | {kind: 'lost'};

export type Phase = 'aim' | 'flight' | 'settle' | 'clear' | 'lost';

export interface Level { blocks: Block[]; queue: CatKind[] }

const POST_H = 8, POST_W = 2.4, BEAM_T = 2.4, SPAN = 12, TARGET = 4.4;

let uid = 1;
function makeBlock(kind: Material, x: number, y: number, w: number, h: number): Block {
  const spec = MATERIAL[kind];
  return {id: uid++, kind, x, y, w, h, vx: 0, vy: 0, hp: spec.hp, maxHp: spec.hp, mass: Math.max(0.4, (w * h * spec.density) / 10), dead: false, support: 'none'};
}

/** The level for `(seed, level)`: structures of posts and beams, mice in and on them, and the cats to throw. */
export function buildLevel(seed: number, level: number): Level {
  const rng = createRng(hashSeed(`${seed}:${level}`));
  const structures = level < 3 ? 1 : level < 6 ? 2 : 3;
  const floorsMax = Math.min(3, 1 + Math.floor(level / 3));
  const woodOnly = level < 2;
  const blocks: Block[] = [];
  const slots: Vec[] = [];
  for (let s = 0; s < structures; s += 1) {
    const x0 = (structures === 1 ? 80 : 58) + s * 21 + (structures === 1 ? rng.int(-6, 8) : 0);
    const floors = 1 + (level >= 2 ? rng.int(0, floorsMax - 1) : 0);
    for (let f = 0; f < floors; f += 1) {
      const bottom = GROUND - f * (POST_H + BEAM_T);
      const postMaterial: Material = woodOnly ? 'wood' : level >= 3 ? rng.pick(['wood', 'wood', 'stone'] as const) : 'wood';
      const beamMaterial: Material = woodOnly ? 'wood' : level >= 3 ? rng.pick(['wood', 'glass', 'stone'] as const) : rng.pick(['wood', 'glass'] as const);
      blocks.push(makeBlock(postMaterial, x0, bottom - POST_H, POST_W, POST_H));
      blocks.push(makeBlock(postMaterial, x0 + SPAN, bottom - POST_H, POST_W, POST_H));
      blocks.push(makeBlock(beamMaterial, x0 - 2, bottom - POST_H - BEAM_T, SPAN + POST_W + 4, BEAM_T));
      slots.push({x: x0 + POST_W + (SPAN - POST_W - TARGET) / 2, y: bottom - TARGET});
    }
    slots.push({x: x0 + (SPAN + POST_W - TARGET) / 2, y: GROUND - floors * (POST_H + BEAM_T) - TARGET});
  }
  const targets = Math.max(1, Math.min(5, 1 + Math.floor(level / 2), slots.length));
  for (const slot of rng.shuffle(slots).slice(0, targets)) blocks.push(makeBlock('target', slot.x, slot.y, TARGET, TARGET));
  const count = Math.max(3, Math.min(7, targets + 2));
  const bag: CatKind[] = ['tabby', 'tabby', 'dash', 'dash', 'split', 'split', 'boom'];
  const queue: CatKind[] = ['tabby'];
  while (queue.length < count) queue.push(rng.pick(bag));
  return {blocks, queue};
}

const overlaps = (a: Block, b: Block): boolean => a.x < b.x + b.w - 1e-5 && b.x < a.x + a.w - 1e-5 && a.y < b.y + b.h - 1e-5 && b.y < a.y + a.h - 1e-5;

export class CatapultState {
  level: number;
  blocks: Block[] = [];
  cats: Cat[] = [];
  queue: CatKind[] = [];
  angle = (45 * Math.PI) / 180;
  power = 0.62;
  phase: Phase = 'aim';
  score = 0;
  levelPoints = 0;
  stars = 0;
  totalStars = 0;
  levelsCleared = 0;
  events: CatapultEvent[] = [];
  elapsedMs = 0;
  private settleMs = 0;
  private calmMs = 0;
  private nextCat = 1;
  private readonly sub = new Substepper(SUB_MS);

  constructor(readonly seed: number, level = 1) {
    this.level = level;
    this.load();
  }

  private load(): void {
    const built = buildLevel(this.seed, this.level);
    this.blocks = built.blocks;
    this.queue = built.queue;
    this.cats = [];
    this.phase = 'aim';
    this.levelPoints = 0;
    this.stars = 0;
    this.settleMs = 0;
    this.calmMs = 0;
  }

  get targetsLeft(): number { return this.blocks.filter(b => b.kind === 'target' && !b.dead).length; }
  get speed(): number { return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * ((this.power - 0.25) / 0.75); }
  /** The cat waiting in the sling. */
  get loaded(): CatKind | undefined { return this.phase === 'aim' ? this.queue[0] : undefined; }

  aim(dAngle: number, dPower: number): void {
    if (this.phase !== 'aim') return;
    this.angle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, this.angle + dAngle));
    this.power = Math.max(0.25, Math.min(1, this.power + dPower));
  }

  /** The preview arc: points of the ballistic path for the current aim, up to where it meets the ground or a block. */
  preview(points = 24, stepSeconds = 0.075): Vec[] {
    const v = this.speed;
    const vx = Math.cos(this.angle) * v, vy = -Math.sin(this.angle) * v;
    const out: Vec[] = [];
    for (let i = 1; i <= points; i += 1) {
      const t = i * stepSeconds;
      const x = SLING.x + vx * t, y = SLING.y + vy * t + 0.5 * GRAVITY * t * t;
      if (y >= GROUND || x > WORLD_W + 4) break;
      if (this.blocks.some(b => !b.dead && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)) break;
      out.push({x, y});
    }
    return out;
  }

  fire(): boolean {
    if (this.phase !== 'aim' || this.queue.length === 0) return false;
    const kind = this.queue.shift()!;
    const v = this.speed;
    const cat = this.makeCat(kind, SLING.x, SLING.y, Math.cos(this.angle) * v, -Math.sin(this.angle) * v);
    this.cats.push(cat);
    this.phase = 'flight';
    this.events.push({kind: 'launch', x: SLING.x, y: SLING.y});
    return true;
  }

  private makeCat(kind: CatKind, x: number, y: number, vx: number, vy: number): Cat {
    return {id: this.nextCat++, kind, x, y, vx, vy, r: CAT_R, damage: kind === 'boom' ? 0.6 : 1, used: false, ageMs: 0, restMs: 0, px: x, py: y};
  }

  /** The cat's ability, while it flies. Returns whether anything happened. */
  ability(): boolean {
    if (this.phase !== 'flight') return false;
    let did = false;
    for (const cat of this.cats.slice()) {
      if (cat.used) continue;
      if (cat.kind === 'dash') {
        cat.used = true; cat.vx *= 1.7; cat.vy *= 1.7; capSpeed(cat, CAT_SPEED_CAP);
        this.events.push({kind: 'ability', cat: 'dash', x: cat.x, y: cat.y});
        did = true;
      } else if (cat.kind === 'split') {
        cat.used = true;
        const speed = Math.hypot(cat.vx, cat.vy), heading = Math.atan2(cat.vy, cat.vx);
        this.cats.splice(this.cats.indexOf(cat), 1);
        for (const turn of [-0.28, 0, 0.28]) {
          const piece = this.makeCat('split', cat.x, cat.y, Math.cos(heading + turn) * speed, Math.sin(heading + turn) * speed);
          piece.used = true; piece.r = 1.5; piece.damage = 0.7;
          this.cats.push(piece);
        }
        this.events.push({kind: 'ability', cat: 'split', x: cat.x, y: cat.y});
        did = true;
      } else if (cat.kind === 'boom') {
        this.explode(cat);
        did = true;
      }
    }
    return did;
  }

  private explode(cat: Cat): void {
    this.cats.splice(this.cats.indexOf(cat), 1);
    this.events.push({kind: 'explosion', x: cat.x, y: cat.y});
    for (const block of this.blocks) {
      if (block.dead) continue;
      const nx = Math.max(block.x, Math.min(cat.x, block.x + block.w)), ny = Math.max(block.y, Math.min(cat.y, block.y + block.h));
      const d = Math.hypot(cat.x - nx, cat.y - ny);
      if (d >= BOMB_RADIUS) continue;
      const falloff = 1 - d / BOMB_RADIUS;
      this.damage(block, 170 * falloff * falloff + 25 * falloff);
      if (!block.dead) {
        const dir = block.x + block.w / 2 >= cat.x ? 1 : -1;
        block.vx += (dir * 55 * falloff) / Math.sqrt(block.mass);
        block.vy -= (25 * falloff) / Math.sqrt(block.mass);
      }
    }
    this.removeDead();
  }

  private damage(block: Block, amount: number): void {
    if (block.dead || amount <= 0) return;
    block.hp -= amount;
    if (block.hp <= 0) {
      block.dead = true;
      const points = MATERIAL[block.kind].points;
      this.score += points;
      this.levelPoints += points;
      this.events.push({kind: 'break', x: block.x, y: block.y, w: block.w, h: block.h, material: block.kind, points});
    }
  }

  private removeDead(): void { this.blocks = this.blocks.filter(b => !b.dead); }

  step(dtMs: number): void {
    if (this.phase === 'clear' || this.phase === 'lost') return;
    this.elapsedMs += dtMs;
    this.sub.run(dtMs, dt => this.substep(dt));
    if (this.phase === 'flight' && this.cats.length === 0) { this.phase = 'settle'; this.settleMs = 0; this.calmMs = 0; }
    if (this.phase === 'settle') {
      this.settleMs += dtMs;
      const moving = this.blocks.some(b => Math.abs(b.vx) > 0.6 || Math.abs(b.vy) > 0.6);
      this.calmMs = moving ? 0 : this.calmMs + dtMs;
      if (this.calmMs >= 450 || this.settleMs > 4500) this.conclude();
    }
  }

  private conclude(): void {
    if (this.targetsLeft === 0) {
      const leftover = this.queue.length;
      const bonus = leftover * 1000;
      this.score += bonus;
      this.levelPoints += bonus;
      this.stars = 1 + Math.min(2, leftover);
      this.totalStars += this.stars;
      this.levelsCleared += 1;
      this.phase = 'clear';
      this.events.push({kind: 'clear', stars: this.stars, bonus});
    } else if (this.queue.length > 0) this.phase = 'aim';
    else { this.phase = 'lost'; this.events.push({kind: 'lost'}); }
  }

  /** After a cleared level: build the next one. */
  nextLevel(): void {
    if (this.phase !== 'clear') return;
    this.level += 1;
    this.load();
  }

  private substep(dt: number): void {
    this.stepBlocks(dt);
    for (const cat of this.cats.slice()) this.stepCat(cat, dt);
    this.removeDead();
    this.blocks = this.blocks.filter(b => b.x < WORLD_W + 40);
  }

  private stepBlocks(dt: number): void {
    const order = this.blocks.slice().sort((a, b) => (b.y + b.h) - (a.y + a.h) || a.id - b.id);
    for (const a of order) {
      if (a.dead) continue;
      // Friction: with the ground, or dragged along by what it rests on.
      if (a.support === 'ground') a.vx = Math.abs(a.vx) < 0.05 ? 0 : a.vx * Math.max(0, 1 - 7 * dt);
      else if (a.support !== 'none' && !a.support.dead) a.vx += (a.support.vx - a.vx) * Math.min(1, 10 * dt);
      a.support = 'none';
      // Horizontal move and shove.
      if (a.vx !== 0) {
        a.x += a.vx * dt;
        for (const b of order) {
          if (b === a || b.dead || !overlaps(a, b)) continue;
          const pushRight = a.x + a.w - b.x, pushLeft = b.x + b.w - a.x;
          if (pushRight < pushLeft) a.x -= pushRight; else a.x += pushLeft;
          const rel = Math.abs(a.vx - b.vx);
          const common = (a.mass * a.vx + b.mass * b.vx) / (a.mass + b.mass);
          if (rel > 8) { this.damage(a, (rel - 8) * 2 * (b.mass / (a.mass + b.mass))); this.damage(b, (rel - 8) * 2 * (a.mass / (a.mass + b.mass))); }
          a.vx = common; b.vx = common;
        }
      }
      // Gravity, fall and landing.
      a.vy += GRAVITY * dt;
      a.y += a.vy * dt;
      if (a.y + a.h > GROUND) {
        a.y = GROUND - a.h;
        if (a.vy > 18) this.damage(a, (a.vy - 18) * 1.2);
        a.vy = 0; a.support = 'ground';
      }
      for (const b of order) {
        if (b === a || b.dead || !overlaps(a, b)) continue;
        if (a.y + a.h / 2 < b.y + b.h / 2) {
          a.y = b.y - a.h;
          const impact = a.vy - b.vy;
          if (impact > 18) {
            this.damage(a, (impact - 18) * 1.2 * (b.mass / (a.mass + b.mass)) * 1.5);
            this.damage(b, (impact - 18) * 1.2 * (a.mass / (a.mass + b.mass)) * 1.5);
          }
          a.vy = b.vy; a.support = b;
        }
      }
    }
  }

  private stepCat(cat: Cat, dt: number): void {
    cat.px = cat.x; cat.py = cat.y;
    cat.ageMs += dt * 1000;
    cat.vy += GRAVITY * dt;
    capSpeed(cat, CAT_SPEED_CAP);
    cat.x += cat.vx * dt; cat.y += cat.vy * dt;
    let touching = false;
    for (const block of this.blocks) {
      if (block.dead) continue;
      const hit = circleBox({x: cat.x, y: cat.y, r: cat.r}, {x: block.x, y: block.y, width: block.w, height: block.h});
      if (!hit) continue;
      touching = true;
      cat.x += hit.nx * hit.depth; cat.y += hit.ny * hit.depth;
      const impact = -((cat.vx - block.vx) * hit.nx + (cat.vy - block.vy) * hit.ny);
      if (impact <= 0) continue;
      if (cat.kind === 'boom' && !cat.used) { this.explode(cat); return; }
      const amount = impact > 6 ? impact * cat.damage * (block.kind === 'target' ? 3 : 1.15) : 0;
      this.events.push({kind: 'hit', x: cat.x, y: cat.y, material: block.kind, damage: amount});
      this.damage(block, amount);
      if (block.dead) { cat.vx *= 0.88; cat.vy *= 0.88; continue; }
      const j = (1.25 * impact) / (1 / 1 + 1 / block.mass);
      cat.vx += hit.nx * j; cat.vy += hit.ny * j;
      block.vx -= (hit.nx * j) / block.mass;
      block.vy -= (hit.ny * j) / block.mass;
    }
    if (cat.y + cat.r > GROUND) {
      cat.y = GROUND - cat.r;
      touching = true;
      if (cat.kind === 'boom' && !cat.used && cat.vy > 3) { this.explode(cat); return; }
      cat.vy = cat.vy > 8 ? -cat.vy * 0.3 : 0;
      cat.vx *= Math.max(0, 1 - 3 * dt);
    }
    const speed = Math.hypot(cat.vx, cat.vy);
    cat.restMs = touching && speed < 6 ? cat.restMs + dt * 1000 : 0;
    if (cat.restMs > 700 || cat.ageMs > 12000 || cat.x > WORLD_W + 30 || cat.x < -30) {
      this.cats.splice(this.cats.indexOf(cat), 1);
      this.events.push({kind: 'poof', x: cat.x, y: cat.y});
    }
  }
}
