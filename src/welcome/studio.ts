import fs from 'node:fs/promises';
import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import {captureWelcome} from '../output/WelcomeProviders.js';
import {resolveCommand} from '../providers/providers.js';
import {WelcomeSequencer} from './sequence.js';
import type {GraphicsDecision} from '../graphics/capabilities.js';
import type {GraphicsService} from '../graphics/service.js';
import type {WelcomeCapabilities, WelcomeFacts} from './compose.js';
import {loadWelcomeAsset, listWelcomeAssets, resolveWelcomePath, type WelcomeAsset} from './assets.js';
import {createWelcomeEditor, renderWelcomeEditor, welcomeEditorKey, type WelcomeEditor} from './editor.js';
import {exportWelcomePreset, importWelcomePreset, normalizeWelcomeStudio, type WelcomeStudio} from './model.js';
import {assetCapabilities, paintWelcome, type WelcomeOverlay} from './render.js';

export interface StudioHost {
  config(): PromptConfiguration; cwd(): string; scratch(): string;
  graphics(): GraphicsService; decision(): GraphicsDecision;
  facts(model: WelcomeStudio): WelcomeFacts; capabilities(): WelcomeCapabilities;
  background(): {red: number; green: number; blue: number};
  save(config: PromptConfiguration): boolean; render(): void; close(): void;
}
/** Editor owns drafts, capture cache, a bounded preview subscription and one graphics owner. */
export class WelcomeStudioController {
  readonly state: WelcomeEditor;
  overlay?: WelcomeOverlay;
  private asset?: WelcomeAsset;
  private beforeAsset?: WelcomeAsset;
  private abort = new AbortController();
  private captureJobs = new Map<string, Promise<string[]>>();
  private owner = {};
  private sequence = new WelcomeSequencer();
  private closed = false;
  private pending = 0;
  private captures = new Map<string, string[]>();
  constructor(private host: StudioHost) { this.state = createWelcomeEditor(host.config()); }
  async start(): Promise<void> { await Promise.all([this.assetChanged(), this.providerChanged()]); }
  private async assetChanged(selectLogo = false): Promise<void> {
    const generation = ++this.pending;
    this.asset = undefined;
    this.host.graphics().releaseOwner(this.owner);
    if (!this.state.draft.assetPath) return;
    try {
      const asset = await loadWelcomeAsset(this.state.draft.assetPath, this.host.cwd(), this.host.scratch());
      if (this.closed || generation !== this.pending) return;
      this.asset = asset;
      if (this.state.original.assetPath === this.state.draft.assetPath) this.beforeAsset = asset;
      if (selectLogo) this.state.draft.logo = asset.kind;
      const m = asset.metadata;
      this.state.message = `${m.format} · ${m.bytes} bytes · ${m.width}×${m.height} · ${m.frames} frames${m.note ? ` · ${m.note}` : ''}`;
    } catch (error) { if (!this.closed && generation === this.pending) this.state.message = error instanceof Error ? error.message : 'Asset unavailable.'; }
    if (!this.closed) this.host.render();
  }
  private async providerChanged(): Promise<void> {
    const provider = this.state.provider;
    this.state.captured = this.captures.get(provider);
    if (provider === 'none' || provider === 'vespyr' || this.state.captured) return;
    let job = this.captureJobs.get(provider);
    if (!job) {
      job = captureWelcome(provider, this.host.cwd(), process.env, this.abort.signal).then(captured =>
        captured.ok ? captured.lines : [`${provider}: ${captured.reason}; startup falls back to Vespyr.`]);
      this.captureJobs.set(provider, job);
    }
    const rows = await job;
    if (this.closed) return;
    this.captures.set(provider, rows);
    if (this.state.provider === provider) { this.state.captured = rows; this.host.render(); }
  }
  async key(key: Key): Promise<void> {
    if (this.closed) return;
    const s = this.state;
    const before = JSON.stringify(s.draft);
    if (!s.input && key.kind === 'text' && ['r', ' '].includes(key.value.toLowerCase())) this.sequence.stop();
    if (s.picker) {
      const p = s.picker;
      if (key.kind === 'escape' || key.kind === 'interrupt') s.picker = undefined;
      else if (key.kind === 'up' || key.kind === 'down') p.selected = (p.selected + (key.kind === 'up' ? -1 : 1) + p.entries.length) % p.entries.length;
      else if (key.kind === 'enter') {
        const entry = p.entries[p.selected];
        if (entry?.directory) await this.pick(entry.path);
        else if (entry) { s.draft.assetPath = entry.path; s.draft.customized = true; s.picker = undefined; await this.assetChanged(true); }
      }
      this.host.render(); return;
    }
    const providers = (['vespyr', 'fastfetch', 'neofetch', 'macchina', 'zigfetch', 'none'] as const).filter(id => id !== 'neofetch' || resolveCommand('neofetch') !== undefined);
    const action = welcomeEditorKey(s, key, Date.now(), providers);
    if (action === 'close') { this.dispose(); this.host.close(); return; }
    if (action === 'save') {
      const config = {...this.host.config(), welcome: s.provider, welcomeStudio: normalizeWelcomeStudio(s.draft), welcomePresets: structuredClone(s.presets)};
      if (this.host.save(config)) { this.dispose(); this.host.close(); return; }
      s.message = 'Could not save; draft kept.';
    } else if (action === 'asset') await this.assetChanged(s.selected === 2);
    else if (action === 'provider') await this.providerChanged();
    else if (action === 'picker') await this.pick(this.host.cwd());
    else if (action === 'import' || action === 'export') {
      try {
        const input = s.input;
        if (!input) return;
        const file = resolveWelcomePath(input.value, this.host.cwd());
        if (action === 'import') {
          // Descriptor-bounded reads also refuse FIFOs/devices and oversized JSON.
          const {readImageFile} = await import('../graphics/decode.js');
          const {bytes} = await readImageFile(file, {maxBytes: 32 * 1024});
          if (this.closed || s.input !== input) return;
          const imported = importWelcomePreset(Buffer.from(bytes).toString('utf8'));
          this.beforeAsset = this.asset;
          s.original = structuredClone(s.draft); s.draft = imported; s.draft.customized = true; s.before = false;
          s.input = undefined; await this.assetChanged(); s.message = 'Imported draft. B compares before/after; S saves.';
        } else {
          await fs.writeFile(file, exportWelcomePreset(s.draft, s.includePath), {flag: 'wx', mode: 0o600});
          if (this.closed || s.input !== input) return;
          s.input = undefined; s.message = `Exported JSON${s.includePath ? ' including the private path' : ' without the private path'}; no asset bytes.`;
        }
      } catch (error) { if (!this.closed && s.input) s.message = error instanceof Error ? error.message : 'File operation failed.'; }
    }
    if (JSON.stringify(s.draft) !== before) { s.elapsed = 0; s.started = Date.now(); this.sequence.stop(); }
    if (!this.closed) this.host.render();
  }
  private async pick(directory: string): Promise<void> {
    try { const entries = await listWelcomeAssets(directory); if (!this.closed) this.state.picker = {directory, entries, selected: 0}; }
    catch (error) { this.state.message = error instanceof Error ? error.message : 'Folder unavailable.'; }
  }
  render(columns: number, height: number): string[] {
    const decision = this.host.decision();
    const caps = this.host.capabilities();
    const asset = this.state.before ? this.beforeAsset : this.asset;
    const reason = asset?.kind === 'image' && (decision.inline !== 'placeholder' && !['kitty', 'iterm2', 'sixel'].includes(decision.backend)) ? decision.reason : undefined;
    this.overlay = undefined;
    const rows = renderWelcomeEditor(this.state, columns, height, this.host.facts(this.state.before ? this.state.original : this.state.draft), {...caps, asset: assetCapabilities(asset, reason)}, Date.now(), frame => {
      const painted = paintWelcome(frame, asset, this.host.graphics(), this.owner, 'viewer', this.host.background());
      if (painted.overlay) this.overlay = {...painted.overlay, y: painted.overlay.y + (this.state.previewTop ?? 0), x: painted.overlay.x};
      return painted.rows;
    });
    const active = this.state.provider === 'vespyr' && !this.state.paused && !this.state.reduced && this.state.preview?.active;
    this.sequence.sync(Boolean(active), () => { if (!this.closed) this.host.render(); });
    return rows;
  }
  dispose(): void {
    this.closed = true; this.abort.abort(); this.pending++; this.sequence.stop();
    this.host.graphics().releaseOwner(this.owner); this.overlay = undefined;
  }
}
