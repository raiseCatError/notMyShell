import {WelcomeSequencer} from './sequence.js';
import type {WelcomeSnapshot} from './legacy.js';
import {renderWelcome} from '../output/Welcome.js';
import type {GraphicsService} from '../graphics/service.js';
import {composeWelcome, type WelcomeCapabilities} from './compose.js';
import {assetCapabilities, motionAsset, paintWelcome} from './render.js';
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
  /** The last paint showed playback frames (generated or decoded), not the admitted still. */
  private paintedMotion = false;
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
    const caps = {...capabilities, effectsOff: capabilities.effectsOff || this.waitingForAsset, loading: this.waitingForAsset, asset: assetCapabilities(this.asset, this.reason ?? reason)};
    // A generated logo animation plays only while motion is live; every still (and the durable card) is the admitted asset.
    const live = this.still ? this.asset : motionAsset(this.asset, model, caps);
    const frame = composeWelcome(model, snapshot.facts ?? {}, {columns, rows: height}, live === this.asset ? caps : {...caps, asset: assetCapabilities(live, this.reason ?? reason)}, this.still ? 5000 : elapsed);
    // Durable stills are sampled independently of playback and always rendered as portable cells.
    // A small key (not the art rows or legacy card) so playback frames do not serialize the whole capability set.
    const finalKey = JSON.stringify([columns, height, caps.color, caps.level, caps.safeGlyphs, caps.reducedMotion, caps.effectsOff, caps.accent, caps.chroma, caps.catFrame,
      caps.asset?.width, caps.asset?.height, caps.asset?.reason, caps.asset?.rows?.length, this.background()]);
    // While the asset loads there is no final still to keep (a session archived now keeps its previous still, if any).
    if (!this.waitingForAsset && finalKey !== this.finalKey) {
      const final = composeWelcome(model, snapshot.facts ?? {}, {columns, rows: height}, caps, 5000);
      snapshot.still = paintWelcome(final, this.asset, this.service, {}, 'inline', this.background(), true).rows;
      this.finalKey = finalKey;
    }
    // At most ~30 repaints a second: very short GIF delays play slightly slower rather than driving 60 fps app renders.
    this.sequence.sync(!this.still && frame.active, this.repaint, frame.nextFrameMs === undefined ? undefined : Math.max(33, frame.nextFrameMs));
    // A stopped animation shows the still the way the terminal draws it (a native image where supported), exactly like Off.
    const moving = !this.still && frame.active;
    const painted = paintWelcome(frame, moving ? live : this.asset, this.service, this.owner, 'inline', this.background());
    // Still-image effects reuse the still's upload; only generated or decoded frames are separate uploads.
    this.paintedMotion = moving && (live !== this.asset || (this.asset?.kind === 'image' && (this.asset.animation?.frames.length ?? 0) > 1));
    return {...frame, active: moving, rows: painted.rows.map(ansi => ({ansi, plain: stripAnsi(ansi)}))};
  }
  rows(snapshot: WelcomeSnapshot, columns: number, reason?: string) {
    if (snapshot.studio !== this.snapshot.studio) return renderWelcome(snapshot, columns);
    const frame = this.frame(columns, 40, undefined, reason);
    snapshot.still = this.snapshot.still?.slice();
    return frame.rows;
  }
  /**
   * Stops playback for good. Uploaded playback frames are deleted now; a still already on screen stays, so a key press
   * never turns the picture into character art.
   */
  cancelMotion(): void {
    this.still = true; this.sequence.stop();
    if (this.paintedMotion) { this.service.releaseOwner(this.owner); this.paintedMotion = false; }
  }
  dispose(): void { this.cancelMotion(); this.service.releaseOwner(this.owner); this.closed = true; this.asset = undefined; }
}
