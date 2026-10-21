/**
 * Small, exact collision helpers shared by the arcade's physics games (paddles and balls, flippers, darts on a spinning
 * target, blocks and wheels). Plain numbers in, plain numbers out: no allocation beyond the returned object, no clock,
 * no randomness, so every caller stays deterministic. Units are whatever the game uses (usually pixels of its buffer).
 */
export interface Vec { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export interface Circle { x: number; y: number; r: number }

export const TAU = Math.PI * 2;

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function circlesOverlap(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x, dy = a.y - b.y, r = a.r + b.r;
  return dx * dx + dy * dy < r * r;
}

/** The point of segment a→b closest to p, and the parameter t in [0, 1] along it. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): {x: number; y: number; t: number} {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return {x: a.x + dx * t, y: a.y + dy * t, t};
}

/** Contact between a circle and a segment: the unit normal pointing toward the circle and the penetration depth. */
export function circleSegment(circle: Circle, a: Vec, b: Vec): {nx: number; ny: number; depth: number; t: number} | undefined {
  const near = closestOnSegment(circle, a, b);
  const dx = circle.x - near.x, dy = circle.y - near.y;
  const distance = Math.hypot(dx, dy);
  if (distance >= circle.r) return undefined;
  if (distance === 0) {
    // Dead on the line: push out along the segment's left normal.
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return {nx: -(b.y - a.y) / length, ny: (b.x - a.x) / length, depth: circle.r, t: near.t};
  }
  return {nx: dx / distance, ny: dy / distance, depth: circle.r - distance, t: near.t};
}

/** Contact between a circle and a box: unit normal from the box toward the circle and penetration depth. */
export function circleBox(circle: Circle, box: Box): {nx: number; ny: number; depth: number} | undefined {
  const cx = Math.max(box.x, Math.min(circle.x, box.x + box.width));
  const cy = Math.max(box.y, Math.min(circle.y, box.y + box.height));
  const dx = circle.x - cx, dy = circle.y - cy;
  const distance = Math.hypot(dx, dy);
  if (distance >= circle.r) return undefined;
  if (distance === 0) {
    // The center is inside the box: leave through the nearest face.
    const faces = [
      {nx: -1, ny: 0, depth: circle.x - box.x + circle.r}, {nx: 1, ny: 0, depth: box.x + box.width - circle.x + circle.r},
      {nx: 0, ny: -1, depth: circle.y - box.y + circle.r}, {nx: 0, ny: 1, depth: box.y + box.height - circle.y + circle.r},
    ];
    return faces.reduce((best, face) => face.depth < best.depth ? face : best);
  }
  return {nx: dx / distance, ny: dy / distance, depth: circle.r - distance};
}

/** Reflect velocity v off a surface with unit normal n, keeping `restitution` of the normal speed and `friction` of the tangent. */
export function bounce(v: Vec, nx: number, ny: number, restitution = 1, friction = 1): Vec {
  const along = v.x * nx + v.y * ny;
  if (along >= 0) return {x: v.x, y: v.y}; // already separating
  const tx = v.x - along * nx, ty = v.y - along * ny;
  return {x: tx * friction - along * restitution * nx, y: ty * friction - along * restitution * ny};
}

/** An angle wrapped into [0, 2π). */
export function wrapAngle(angle: number): number { return ((angle % TAU) + TAU) % TAU; }

/** Smallest absolute difference between two angles, in [0, π]. */
export function angleGap(a: number, b: number): number {
  const d = Math.abs(wrapAngle(a) - wrapAngle(b));
  return d > Math.PI ? TAU - d : d;
}

/** Whether `angle` lies in the arc that starts at `start` and runs counterclockwise for `span` radians. */
export function inArc(angle: number, start: number, span: number): boolean {
  if (span >= TAU) return true;
  return wrapAngle(angle - start) < span;
}
