/**
 * NMSh's host shader passes that the running terminal would load now, as
 * host-neutral facts for render routing (the general frontend never branches
 * on host products). Read from NMSh's own ledgers and fragments only.
 */
import {terminalProfile} from '../host/capabilities.js';
import type {NativePass} from '../motion/renderRouting.js';
import {presetById} from './ghosttyShaderCatalog.js';
import {writtenGhosttyPasses} from './ghosttyShaders.js';
import {KITTY_PRESETS} from './kittyShaderCatalog.js';
import {writtenKittyPresets} from './kittyShaders.js';

export function writtenNativePasses(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): {hostName?: string; passes: NativePass[]} {
  const context = {env, platform};
  const profile = terminalProfile(env);
  if (profile === 'ghostty') {
    return {hostName: 'Ghostty', passes: writtenGhosttyPasses(context).flatMap(id => { const preset = presetById(id); return preset ? [{id, label: preset.label, category: preset.category}] : []; })};
  }
  if (profile === 'kitty') {
    return {hostName: 'Kitty', passes: writtenKittyPresets(context).flatMap(id => { const preset = KITTY_PRESETS.find(item => item.id === id); return preset ? [{id, label: preset.label, category: preset.category}] : []; })};
  }
  return {passes: []};
}
