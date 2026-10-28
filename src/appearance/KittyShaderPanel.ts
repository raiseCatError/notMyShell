/**
 * /appearance › Kitty shaders: choose Kitty 0.49+ shipped shader effects,
 * tune the settings the installed shaders really expose, order them, and
 * review the exact host change before anything is written. The panel itself
 * is the shared shader studio (ShaderStudioPanel); this file holds Kitty's
 * wording and keeps the Kitty-named entry points.
 */
import type {Key} from '../terminal/keys.js';
import type {KittyCatalog, OfferedParam, OfferedPreset, ShaderValue} from './kittyShaderCatalog.js';
import type {KittyShaderInspection, KittyShaderPlan, ShaderGates} from './kittyShaders.js';
import type {KittyShaderSettings} from './kittyShaderSettings.js';
import {createShaderStudio, renderShaderStudio, shaderStudioKey, studioParamValue, type ShaderStudioState, type StudioAction, type StudioHost, type StudioPreviewContext} from './ShaderStudioPanel.js';

export type KittyShaderPanelState = ShaderStudioState<KittyCatalog, KittyShaderInspection, KittyShaderPlan, ShaderGates, KittyShaderSettings>;
export type KittyShaderAction = Exclude<StudioAction, {kind: 'reloaded'}>;

export const KITTY_STUDIO: StudioHost<ShaderGates> = {
  name: 'Kitty',
  placement: true,
  intro: catalog => `Kitty ${catalog.version} · shipped shaders read from Kitty itself, plus NMSh’s own (written beside NMSh’s pipeline) · effects cover the whole Kitty window, not only NMSh`,
  unsupportedHint: 'Cursor effects stay with /cursor (Portable, or Kitty’s built-in trail).',
  status: inspection => inspection.drifted ? 'Your own custom_shaders changed since NMSh composed with it; S reviews an updated plan.'
    : inspection.configured ? `Set up · ${inspection.activePresets.length ? `${inspection.activePresets.length} NMSh effect${inspection.activePresets.length === 1 ? '' : 's'} in Kitty’s config` : 'no NMSh effect active'}`
      : 'Not set up · nothing in Kitty’s configuration is changed until you review and confirm',
  userShaders: inspection => inspection.userEntries.length ? `Your shaders (kept, in order): ${inspection.userEntries.join(' · ')}` : 'You have no custom_shaders of your own.',
  gate: gates => gates.reducedMotion ? 'Reduced Motion is on: NMSh keeps Kitty effects out of its pipeline until it is off.'
    : gates.effectsOff ? 'Decorative effects are Off: NMSh keeps Kitty effects out of its pipeline until they are on.'
      : gates.cursorRenderer === 'portable' ? 'Cursor renderer is Portable: NMSh draws the trail, so no Kitty trail is added.' : undefined,
  placementNote: 'Kitty runs shaders in list order; your own stay in their order either way.',
  noParams: 'Kitty exposes no adjustable settings for this shader.',
};

export function createKittyShaderPanel(saved: KittyShaderSettings, gates: ShaderGates): KittyShaderPanelState {
  return createShaderStudio(saved, gates);
}

export function paramValue(state: KittyShaderPanelState, preset: OfferedPreset, param: OfferedParam): ShaderValue {
  return studioParamValue(state, preset, param);
}

export function kittyShaderKey(state: KittyShaderPanelState, key: Key): KittyShaderAction | undefined {
  const action = shaderStudioKey(state, key, KITTY_STUDIO);
  return action?.kind === 'reloaded' ? undefined : action;
}

export function renderKittyShaderPanel(state: KittyShaderPanelState, columns: number, height?: number, preview?: StudioPreviewContext): string[] {
  return renderShaderStudio(state, KITTY_STUDIO, columns, height, preview);
}
