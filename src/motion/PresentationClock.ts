/** One demand-driven frame scheduler. Pure presentation primitives consume its time. */
export class PresentationClock {
  private listeners = new Map<symbol, {callback: (now: number) => void; interval: number; next: number}>();
  private timer?: NodeJS.Timeout;
  /** Scheduling uses a monotonic source so wall-clock adjustments cannot stall or burst frames. */
  constructor(private readonly monotonic: () => number = () => performance.now()) {}
  get subscriberCount(): number { return this.listeners.size; }
  get scheduled(): boolean { return this.timer !== undefined; }

  subscribe(callback: (now: number) => void, interval = 100): () => void {
    const key = Symbol();
    // Short one-shot sweeps may ask for up to 25 frames per second; everything else keeps 10 or fewer.
    const bounded = Number.isFinite(interval) ? Math.max(40, Math.min(60_000, interval)) : 100;
    this.listeners.set(key, {callback, interval: bounded, next: this.monotonic() + bounded});
    this.schedule();
    return () => { if (this.listeners.delete(key)) this.schedule(); };
  }

  after(callback: () => void, delay: number): () => void {
    const stop = this.subscribe(() => { stop(); callback(); }, delay);
    return stop;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.listeners.size) return;
    const next = Math.min(...Array.from(this.listeners.values(), listener => listener.next));
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const tick = this.monotonic();
      const now = Date.now(); // Callbacks still receive wall time for presentation sampling.
      try {
        for (const [key, listener] of [...this.listeners]) {
          if (!this.listeners.has(key) || tick < listener.next) continue;
          listener.next = tick + listener.interval;
          try { listener.callback(now); }
          catch (error) { this.listeners.delete(key); throw error; }
        }
      } finally { this.schedule(); }
    }, Math.max(0, next - this.monotonic()));
    this.timer.unref?.();
  }
}

export const presentationClock = new PresentationClock();
