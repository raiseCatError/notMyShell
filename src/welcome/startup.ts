import {WelcomeSequencer} from './sequence.js';
import type {WelcomeSnapshot} from './legacy.js';
import {renderWelcome} from '../output/Welcome.js';
import type {GraphicsService} from '../graphics/service.js';
import {composeWelcome, type WelcomeCapabilities} from './compose.js';
import {assetCapabilities, paintWelcome} from './render.js';
import {loadWelcomeAsset, type WelcomeAsset} from './assets.js';
import {stripAnsi} from '../util/text.js';

/** 6b's sequencer can supply elapsed time here. 6a samples still-image effects only; decoded animation frames remain deferred. */
export class NativeWelcomePresentation {
  private owner = {};
  private asset?: WelcomeAsset;
  private closed = false;
  private reason?: string;
  private sequence = new WelcomeSequencer();
  private started = Date.now();
  private still = false;
  constructor(readonly snapshot: WelcomeSnapshot, private service: GraphicsService, private caps: () => WelcomeCapabilities,
    private background: () => {red: number; green: number; blue: number}, private repaint: () => void = () => {}) {}
  async load(cwd: string, scratch: string): Promise<void> {
    const model = this.snapshot.studio;
    if (!model?.customized || !model.assetPath || !['image', 'art'].includes(model.logo)) return;
    try { const asset = await loadWelcomeAsset(model.assetPath, cwd, scratch); if (!this.closed) this.asset = asset; }
    catch (error) { if (!this.closed) this.reason = error instanceof Error ? error.message : 'Image unavailable.'; }
  }
  rows(snapshot: WelcomeSnapshot, columns: number, reason?: string) {
    const model = snapshot.studio;
    if (this.closed || !model?.customized || model !== this.snapshot.studio || snapshot.captured) return renderWelcome(snapshot, columns);
    const frame = composeWelcome(model, snapshot.facts ?? {}, {columns, rows: 40}, {...this.caps(), ...(this.still ? {effectsOff: true} : {}), asset: assetCapabilities(this.asset, this.reason ?? reason, false)}, this.still ? 0 : Date.now() - this.started);
    this.sequence.sync(frame.active, this.repaint);
    return paintWelcome(frame, this.asset, this.service, this.owner, 'inline', this.background()).rows.map(ansi => ({ansi, plain: stripAnsi(ansi)}));
  }
  cancelMotion(): void { this.still = true; this.sequence.stop(); }
  dispose(): void { this.sequence.stop(); this.closed = true; this.asset = undefined; this.service.releaseOwner(this.owner); }
}
