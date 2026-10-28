import {WelcomeSequencer} from './sequence.js';
import type {WelcomeSnapshot} from './legacy.js';
import {renderWelcome} from '../output/Welcome.js';
import type {GraphicsService} from '../graphics/service.js';
import {composeWelcome, type WelcomeCapabilities} from './compose.js';
import {assetCapabilities, paintWelcome} from './render.js';
import {loadWelcomeAsset, type WelcomeAsset} from './assets.js';
import {stripAnsi} from '../util/text.js';

/** The same admitted asset, compositor, painter and sequencer for startup and P preview. */
export class NativeWelcomePresentation {
  private owner = {};
  private closed = false;
  private sequence = new WelcomeSequencer();
  private started: number;
  private finalKey?: string;
  private still = false;
  private waitingForAsset: boolean;
  constructor(readonly snapshot: WelcomeSnapshot, private service: GraphicsService, private caps: () => WelcomeCapabilities,
    private background: () => {red: number; green: number; blue: number}, private repaint: () => void = () => {},
    private asset?: WelcomeAsset, private now: () => number = Date.now, private reason?: string) {
    this.started = now();
    const model = snapshot.studio;
    this.waitingForAsset = Boolean(model?.customized && model.assetPath && ['image', 'art'].includes(model.logo) && !asset && !reason);
  }
  /** Adopt an already admitted editor asset without another read or decode. */
  useAsset(asset: WelcomeAsset | undefined, reason?: string): void {
    if (this.closed) return;
    if (this.waitingForAsset) this.started = this.now();
    this.waitingForAsset = false; this.asset = asset; this.reason = reason; this.finalKey = undefined;
  }
  async load(cwd: string, scratch: string): Promise<void> {
    const model = this.snapshot.studio;
    if (!model?.customized || !model.assetPath || !['image', 'art'].includes(model.logo)) return;
    try {
      const asset = await loadWelcomeAsset(model.assetPath, cwd, scratch);
      this.useAsset(asset);
    } catch (error) { this.useAsset(undefined, error instanceof Error ? error.message : 'Image unavailable.'); }
  }
  /** Explicit elapsed time is the deterministic parity/testing seam; production uses the same clock. */
  frame(columns: number, height = 40, elapsed = this.now() - this.started, reason?: string) {
    const snapshot = this.snapshot, model = snapshot.studio;
    if (this.closed) return {rows: [], images: [], active: false};
    if (!model?.customized || snapshot.captured) return {rows: renderWelcome(snapshot, columns).slice(0, height), images: [], active: false};
    const capabilities = this.caps();
    const caps = {...capabilities, effectsOff: capabilities.effectsOff || this.waitingForAsset, asset: assetCapabilities(this.asset, this.reason ?? reason)};
    const frame = composeWelcome(model, snapshot.facts ?? {}, {columns, rows: height}, caps, this.still ? 5000 : elapsed);
    // Durable stills are sampled independently of playback and always rendered as portable cells.
    const finalKey = JSON.stringify([columns, height, caps, this.background()]);
    if (finalKey !== this.finalKey) {
      const final = composeWelcome(model, snapshot.facts ?? {}, {columns, rows: height}, caps, 5000);
      snapshot.still = paintWelcome(final, this.asset, this.service, {}, 'inline', this.background(), true).rows;
      this.finalKey = finalKey;
    }
    this.sequence.sync(!this.still && frame.active, this.repaint, frame.nextFrameMs);
    const painted = paintWelcome(frame, this.asset, this.service, this.owner, 'inline', this.background(), this.still);
    return {...frame, active: !this.still && frame.active, rows: painted.rows.map(ansi => ({ansi, plain: stripAnsi(ansi)}))};
  }
  rows(snapshot: WelcomeSnapshot, columns: number, reason?: string) {
    if (snapshot.studio !== this.snapshot.studio) return renderWelcome(snapshot, columns);
    const frame = this.frame(columns, 40, undefined, reason);
    snapshot.still = this.snapshot.still?.slice();
    return frame.rows;
  }
  cancelMotion(): void { this.still = true; this.sequence.stop(); this.service.releaseOwner(this.owner); }
  dispose(): void { this.cancelMotion(); this.closed = true; this.asset = undefined; }
}
