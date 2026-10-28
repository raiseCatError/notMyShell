import {presentationClock} from '../motion/PresentationClock.js';
/** One bounded frame subscription for editor, startup and full-terminal preview. */
export class WelcomeSequencer {
  private unsubscribe?: () => void;
  sync(active: boolean, repaint: () => void, delay = 100): void {
    if (!active) { this.stop(); return; }
    if (this.unsubscribe) return;
    this.unsubscribe = presentationClock.subscribe(() => {
      this.stop();
      repaint();
    }, Math.max(16, Math.min(5000, delay)), 16);
  }
  stop(): void { this.unsubscribe?.(); this.unsubscribe = undefined; }
}
