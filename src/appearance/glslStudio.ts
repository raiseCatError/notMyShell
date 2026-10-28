/**
 * The GLSL shader studio controller: everything the app needs for NMSh's
 * Ghostty custom-shader passes, kept out of the general frontend (which must
 * not branch on host products). TerminalApp only calls these host-neutral
 * methods; host detection, catalog, gates, reviewed writes, sync, reload state
 * and the /cursor hand-off all live here.
 */
import {existsSync} from 'node:fs';
import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration} from '../prompt/configuration.js';
import type {CursorSettings} from '../prompt/configuration.js';
import {terminalProfile} from '../host/capabilities.js';
import {isReducedMotion} from '../presentation/environment.js';
import {contextFor, resolveCursorSettings} from '../cursor/colors.js';
import {effectPalette} from '../cursor/palette.js';
import type {HostCursorFacts} from '../cursor/backends.js';
import {fragmentContent, ghosttyCursorFragment, ghosttyCursorShaderWritten, writeManagedFiles, type ManagedWrite, type NativeHost} from '../cursor/native.js';
import type {AppearanceHubState} from './AppearanceHub.js';
import {createGhosttyShaderPanel, ghosttyShaderKey, renderGhosttyShaderPanel, type GhosttyShaderPanelState} from './GhosttyShaderPanel.js';
import {buildGhosttyCatalog} from './ghosttyShaderCatalog.js';
import {applyGhosttyShaderPlan, ghosttyReloadPending, ghosttyShaderPaths, inspectGhosttyLaunch, inspectGhosttyShaders, noteGhosttyTrailChange, planGhosttyShaderRemoval, planGhosttyShaders,
  readProcessTable, setGhosttyReloadPending, syncGhosttyShaders, writtenGhosttyTrail, type GhosttyLaunch, type GhosttyShaderContext, type GhosttyShaderGates} from './ghosttyShaders.js';

/** What the controller may ask of the app. */
export interface StudioServices {
  configuration(): PromptConfiguration;
  update(mutate: (configuration: PromptConfiguration) => void): void;
  /** The cursor facts changed (a trail was written, removed or confirmed reloaded). */
  invalidateCursor(): void;
  notify(message: string, error: boolean): void;
  render(): void;
  /** Esc: back to /appearance. */
  back(): void;
}

export class GlslShaderStudio {
  panel?: GhosttyShaderPanelState;
  /** Trails Ghostty may still draw when the reload record could not be saved (this process only; never two trails). */
  private unsavedPending: string[] = [];

  constructor(private readonly services: StudioServices, private readonly env: NodeJS.ProcessEnv = process.env, private readonly platform: NodeJS.Platform = process.platform) {}

  private get base() { return {env: this.env, platform: this.platform}; }

  /** The studio exists only when NMSh runs directly in Ghostty. */
  available(): boolean { return terminalProfile(this.env) === 'ghostty'; }

  /** In Ghostty the /appearance hub gains the studio row; the summary says what is chosen, never that it is loaded. */
  addHubRow(hub: AppearanceHubState): void {
    if (!this.available()) return;
    const chosen = this.services.configuration().hostShaders.ghostty.effects.filter(effect => effect.enabled).length;
    hub.ghosttyShaders = chosen ? `${chosen} effect${chosen === 1 ? '' : 's'} chosen · Ghostty 1.2+` : 'Off · Ghostty GPU effects';
  }

  gates(config: PromptConfiguration = this.services.configuration()): GhosttyShaderGates {
    return {reducedMotion: isReducedMotion() || config.presentation.reducedMotion, effectsOff: config.presentation.effectsOff, cursorRenderer: config.cursor.renderer, cursorMotion: config.cursor.motion};
  }

  /**
   * Everything a plan needs: the catalog from the RUNNING Ghostty's reported version (inside tmux or ssh it is unknown
   * and nothing is offered), the gates, /cursor's trail colors and, unless given, Ghostty's launch options.
   */
  context(config: PromptConfiguration = this.services.configuration(), launch?: GhosttyLaunch): GhosttyShaderContext {
    const cursor = resolveCursorSettings(config.cursor, contextFor(config));
    const palette = effectPalette(cursor);
    const rgb = (color: {red: number; green: number; blue: number}) => [color.red / 255, color.green / 255, color.blue / 255];
    const head = palette.trail[0] ?? palette.caret;
    const tail = palette.trail.length > 1 ? palette.trail.at(-1)! : {red: head.red * 0.6, green: head.green * 0.6, blue: head.blue * 0.6};
    return {...this.base, catalog: buildGhosttyCatalog(terminalProfile(this.env) === 'ghostty' ? this.env.TERM_PROGRAM_VERSION : undefined),
      gates: this.gates(config), launch: launch ?? inspectGhosttyLaunch(readProcessTable(), process.pid), colors: {cursorColors: {head: rgb(head), tail: rgb(tail)}}};
  }

  open(): void {
    const panel = createGhosttyShaderPanel(this.services.configuration().hostShaders.ghostty, this.gates());
    this.panel = panel;
    // Opening the studio applies gate changes made while NMSh was not running (OS Reduced Motion, an edited config).
    this.sync(this.services.configuration());
    const context = this.context();
    panel.catalog = context.catalog;
    try { panel.inspection = inspectGhosttyShaders(context); } catch (error) { panel.message = error instanceof Error ? error.message : String(error); }
    panel.reloadPending = ghosttyReloadPending(context, context.launch);
    // A Ghostty process that started after the change has loaded it: the pending record is stale.
    if (!panel.reloadPending) { try { setGhosttyReloadPending(context, undefined); } catch { /* best effort */ } }
    this.services.render();
  }

  render(columns: number, height: number): string[] | undefined {
    return this.panel ? renderGhosttyShaderPanel(this.panel, columns, height) : undefined;
  }

  key(key: Key): void {
    const panel = this.panel;
    if (!panel) return;
    const action = ghosttyShaderKey(panel, key);
    if (!action) return;
    if (action.kind === 'back') { this.panel = undefined; this.services.back(); return; }
    if (action.kind === 'reloaded') {
      try { setGhosttyReloadPending(this.base, undefined); } catch (error) { panel.message = error instanceof Error ? error.message : String(error); return; }
      this.unsavedPending = [];
      panel.reloadPending = undefined;
      this.services.invalidateCursor();
      panel.message = 'Noted: Ghostty has reloaded, so Portable draws whatever Ghostty no longer does.';
      return;
    }
    if (!panel.catalog) return;
    if (action.kind === 'review' || action.kind === 'remove') {
      const planned = action.kind === 'review' ? planGhosttyShaders(panel.draft, this.context()) : planGhosttyShaderRemoval(this.base, {legacyActive: this.legacyCursorShaderWanted()});
      if (planned.ok) panel.confirmation = {plan: planned.plan, offset: 0};
      else panel.message = planned.error;
      return;
    }
    const reviewed = panel.confirmation?.plan;
    panel.confirmation = undefined;
    if (!reviewed) return;
    // Gates or files may have changed while the review was open: confirm only the plan that would be made now.
    const plan = reviewed.operation === 'remove' ? reviewed : (() => {
      const again = planGhosttyShaders(panel.draft, this.context());
      return again.ok && JSON.stringify(again.plan.shaders) === JSON.stringify(reviewed.shaders) && JSON.stringify(again.plan.effectiveShaders) === JSON.stringify(reviewed.effectiveShaders) ? reviewed : undefined;
    })();
    if (!plan) { panel.message = 'Something changed since the review (Reduced Motion, /cursor or Ghostty’s configuration); nothing was written. Press S to review again.'; return; }
    const applied = applyGhosttyShaderPlan(plan);
    if (!applied.ok) { panel.message = applied.error; return; }
    this.noteTrailChange(plan.trailBefore, plan.trailAfter);
    this.services.invalidateCursor();
    const saved = plan.operation === 'remove' ? {...panel.draft, effects: panel.draft.effects.map(effect => ({...effect, enabled: false}))} : structuredClone(panel.draft);
    // The older /cursor Ghostty shader, when paused, resumed inside the reviewed removal itself.
    this.services.update(configuration => { configuration.hostShaders.ghostty = saved; });
    panel.draft = structuredClone(saved);
    panel.dirty = false;
    try { panel.inspection = inspectGhosttyShaders(this.context(this.services.configuration(), {})); } catch { /* the message below still applies */ }
    panel.reloadPending = this.pending();
    panel.message = plan.operation === 'remove' ? `Removed NMSh's Ghostty shaders. ${plan.guidance}` : plan.guidance;
  }

  /**
   * After a reviewed setup, keep NMSh's passes in step with Reduced Motion, Effects Off and /cursor. Only NMSh-owned files
   * are rewritten; anything needing a new review is said, not written. A trail that stops being written stays pending
   * until Ghostty reloads, so Portable does not draw a second one meanwhile.
   */
  sync(next: PromptConfiguration, options: {render?: boolean} = {}): void {
    try { if (!existsSync(ghosttyShaderPaths(this.base).ledger)) return; } catch { return; }
    const result = syncGhosttyShaders(next.hostShaders.ghostty, this.context(next, {}));
    if (result.kind === 'written') {
      this.noteTrailChange(result.trailBefore, result.trailAfter);
      this.services.invalidateCursor();
      if (this.panel) this.panel.reloadPending = this.pending();
    }
    if (result.kind === 'written' || result.kind === 'review') {
      const message = result.kind === 'review' ? `Ghostty shaders were not updated: ${result.message}` : result.message;
      if (this.panel) this.panel.message = message;
      else this.services.notify(message, result.kind === 'review');
      if (options.render !== false) this.services.render();
    }
  }

  /** Ghostty's written studio trail and any trail it may still draw until a reload (the process table is read only while one is pending). */
  trailFacts(): {trail?: string; pending?: string} {
    const trail = writtenGhosttyTrail(this.base);
    const pending = (ghosttyReloadPending(this.base) && ghosttyReloadPending(this.base, inspectGhosttyLaunch(readProcessTable(), process.pid))) ?? this.unsaved();
    return {...(trail ? {trail} : {}), ...(pending ? {pending} : {})};
  }

  private unsaved(): string | undefined {
    return this.unsavedPending.includes('nmsh-cursor') ? 'nmsh-cursor' : this.unsavedPending[0];
  }

  private pending(): string | undefined { return ghosttyReloadPending(this.base) ?? this.unsaved(); }

  /** Record a trail Ghostty may still draw; if the record cannot be saved, this process still keeps Portable from doubling it. */
  private noteTrailChange(before: string | undefined, after: string | undefined): void {
    try { noteGhosttyTrailChange(this.base, before, after); } catch { if (before && before !== after) this.unsavedPending = [...new Set([...this.unsavedPending, before])]; }
  }

  /** Whether /cursor's settings would list NMSh's older Ghostty cursor shader with no studio trail written. */
  private legacyCursorShaderWanted(): boolean {
    const config = this.services.configuration();
    return fragmentContent('ghostty', resolveCursorSettings(config.cursor, contextFor(config)), this.env, false) === ghosttyCursorFragment(true, this.env);
  }

  /** /cursor's native setup hands over to this studio once it owns the trail (set up, or a trail written). */
  ownsCursorSetup(facts: HostCursorFacts): boolean {
    return facts.host === 'ghostty' && (Boolean(facts.ghosttyTrail) || existsSync(ghosttyShaderPaths(this.base).ledger));
  }

  /**
   * Write NMSh's /cursor managed files for a host. In Ghostty a written studio trail keeps the older /cursor shader
   * paused, and a shader that stops being written is remembered until Ghostty reloads (never two trails).
   */
  writeCursorFiles(host: NativeHost, settings: CursorSettings): ManagedWrite & {trailChanged: boolean} {
    if (host !== 'ghostty') return {...writeManagedFiles(host, settings, this.env), trailChanged: false};
    const studioTrail = Boolean(writtenGhosttyTrail(this.base));
    const before = ghosttyCursorShaderWritten(this.env);
    const written = writeManagedFiles(host, settings, this.env, studioTrail);
    const stopped = before && !ghosttyCursorShaderWritten(this.env);
    if (stopped) this.noteTrailChange('nmsh-cursor', undefined);
    return {...written, trailChanged: stopped};
  }
}
