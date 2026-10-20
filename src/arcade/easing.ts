/** Small easing and interpolation helpers shared by sprites, score pops and menu transitions. */
export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
export const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
export const smoothstep = (amount: number): number => { const t = clamp(amount, 0, 1); return t * t * (3 - 2 * t); };
export const easeOutCubic = (amount: number): number => 1 - (1 - clamp(amount, 0, 1)) ** 3;
export const easeInOutQuad = (amount: number): number => { const t = clamp(amount, 0, 1); return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2; };
/** A short overshoot (squash and stretch, a placed marker settling): 0 → 1 with a bump past 1. */
export const easeOutBack = (amount: number): number => { const t = clamp(amount, 0, 1) - 1; return 1 + 2.70158 * t ** 3 + 1.70158 * t ** 2; };
/** Triangle wave in [0, 1] with the given period. */
export const pingPong = (time: number, period: number): number => { const t = ((time % period) + period) % period / period; return t < 0.5 ? t * 2 : 2 - t * 2; };
