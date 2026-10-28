/**
 * /appearance › Ghostty shaders: NMSh's own GLSL passes for Ghostty 1.2+,
 * offered by what this Ghostty's shader interface provides, tuned with real
 * parameters and written only after an exact review. The panel is the shared
 * shader studio (ShaderStudioPanel); this file holds Ghostty's wording.
 */
import type {Key} from '../terminal/keys.js';
import type {GhosttyCatalog} from './ghosttyShaderCatalog.js';
import {trailGateReason, type GhosttyShaderGates, type GhosttyShaderInspection, type GhosttyShaderPlan} from './ghosttyShaders.js';
import type {GhosttyShaderSettings} from './kittyShaderSettings.js';
import {createShaderStudio, renderShaderStudio, shaderStudioKey, type ShaderStudioState, type StudioAction, type StudioHost} from './ShaderStudioPanel.js';

export type GhosttyShaderPanelState = ShaderStudioState<GhosttyCatalog, GhosttyShaderInspection, GhosttyShaderPlan, GhosttyShaderGates, GhosttyShaderSettings>;

export const GHOSTTY_STUDIO: StudioHost<GhosttyShaderGates> = {
  name: 'Ghostty',
  placement: false,
  intro: catalog => `Ghostty ${catalog.version} · NMSh’s own GLSL passes · effects cover the whole Ghostty surface (vim, less…), not only NMSh`,
  unsupportedHint: 'Cursor effects stay with /cursor (Portable).',
  status: inspection => inspection.configured
    ? `Set up · ${inspection.activePresets.length ? `${inspection.activePresets.length} NMSh pass${inspection.activePresets.length === 1 ? '' : 'es'} in Ghostty’s config` : 'no NMSh effect active'}`
    : 'Not set up · nothing in Ghostty’s configuration is changed until you review and confirm',
  userShaders: inspection => inspection.userEntries.length ? `Your shaders (kept, in order; NMSh’s run after them): ${inspection.userEntries.join(' · ')}` : 'You have no custom shaders of your own.',
  gate: gates => gates.reducedMotion ? 'Reduced Motion is on: NMSh writes no Ghostty effects until it is off.'
    : gates.effectsOff ? 'Decorative effects are Off: NMSh writes no Ghostty effects until they are on.'
      : trailGateReason(gates),
  placementNote: '',
  noParams: 'This effect has no adjustable settings.',
  reloadKey: true,
};

export function createGhosttyShaderPanel(saved: GhosttyShaderSettings, gates: GhosttyShaderGates): GhosttyShaderPanelState {
  return createShaderStudio(saved, gates);
}

export function ghosttyShaderKey(state: GhosttyShaderPanelState, key: Key): StudioAction | undefined {
  return shaderStudioKey(state, key, GHOSTTY_STUDIO);
}

export function renderGhosttyShaderPanel(state: GhosttyShaderPanelState, columns: number, height?: number): string[] {
  return renderShaderStudio(state, GHOSTTY_STUDIO, columns, height);
}
