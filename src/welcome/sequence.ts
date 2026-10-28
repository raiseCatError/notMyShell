import {presentationClock} from '../motion/PresentationClock.js';
/** One subscription policy for Studio and startup still-image composition; decoded frame playback can join here in 6b. */
export class WelcomeSequencer {
  private unsubscribe?: () => void;
  sync(active: boolean, repaint: () => void): void {
    if (active && !this.unsubscribe) {
      const deadline = Date.now() + 5000;
      this.unsubscribe = presentationClock.subscribe(() => { if (Date.now() >= deadline) this.stop(); repaint(); }, 100);
    }
    else if (!active) this.stop();
  }
  stop(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
}
