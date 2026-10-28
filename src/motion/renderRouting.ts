/**
 * Render routing: for each semantic surface NMSh animates, who draws it —
 * the host's GPU shader (native), NMSh's own cell renderer (Portable), or
 * nothing — and why. It is a read-only view over decisions made elsewhere
 * (the cursor backend choice, the presentation gates, the shader studios'
 * written passes); it never schedules or draws anything itself.
 *
 * Native routing exists only where the host offers reliable targeting: the
 * cursor (Ghostty/Kitty cursor uniforms) and whole-window focus or display
 * passes. A terminal shader sees the whole window, not NMSh's rows, so prompt
 * transitions, command feedback, notifications, idle scenes and the welcome
 * always stay Portable: no per-widget GPU targeting is claimed or faked.
 */
import type {BackendChoice} from '../cursor/backends.js';
import type {PresetCategory} from '../appearance/kittyShaderCatalog.js';
import {motionAllowed, type MotionGate} from './transitions.js';

export type RenderSurface = 'cursorTrail' | 'cursorEffect' | 'promptTransitions' | 'commandFeedback' | 'notifications' | 'idle' | 'welcome' | 'hostFocus' | 'hostDisplay';
export type RenderRoute = 'native' | 'portable' | 'off';
export interface SurfaceRoute {surface: RenderSurface; label: string; route: RenderRoute; reason: string}

/** One of NMSh's host shader passes that the host would load now (written, hook present). */
export interface NativePass {id: string; label: string; category: PresetCategory}

export interface RoutingInput {
  gate: MotionGate;
  /** Clean or Rich (Settings › Motion). */
  look: 'clean' | 'rich';
  /** /cursor's choice for this host, from the one cursor backend chooser. */
  cursor: BackendChoice;
  cursorMotion: string;
  cursorEffect: string;
  /** The host's name when it has a shader studio (Ghostty, Kitty); undefined elsewhere. */
  hostName?: string;
  nativePasses: readonly NativePass[];
  /** Screensaver timeout in minutes (0 = off). */
  idleTimeout: number;
  /** The screensaver mode takes the whole screen (those never start by themselves under Reduced Motion). */
  idleScreenMode: boolean;
  /** Settings › Motion rows set to Off. */
  motionOff: {launch: boolean; context: boolean; events: boolean};
}

export const SURFACE_LABELS: Record<RenderSurface, string> = {
  cursorTrail: 'Cursor trail', cursorEffect: 'Cursor effect', promptTransitions: 'Prompt transitions', commandFeedback: 'Command feedback',
  notifications: 'Notifications', idle: 'Screensaver', welcome: 'Welcome', hostFocus: 'Window focus', hostDisplay: 'Window display',
};

/** Why decorative motion is off, or undefined when it is allowed. */
export function gateReason(gate: MotionGate): string | undefined {
  if (gate.effectsOff) return 'Effects Off';
  if (gate.reducedMotion) return 'Reduced Motion';
  if (!gate.color) return 'no color (NO_COLOR or a monochrome terminal)';
  return undefined;
}

const ROWS_ONLY = 'NMSh’s own rows; a terminal shader sees the whole window, not NMSh’s rows';

export function renderRoutes(input: RoutingInput): SurfaceRoute[] {
  const route = (surface: RenderSurface, value: RenderRoute, reason: string): SurfaceRoute => ({surface, label: SURFACE_LABELS[surface], route: value, reason});
  const gated = gateReason(input.gate);
  const look = input.look === 'rich' ? 'Rich' : 'Clean';
  const cursorPart = (surface: 'cursorTrail' | 'cursorEffect', setting: string, feature: 'motion' | 'effect'): SurfaceRoute => {
    if (setting === 'off' || setting === 'none') return route(surface, 'off', `${feature === 'motion' ? 'Motion is Off' : 'Effect is None'} in /cursor`);
    if (input.cursor.nativeHandles[feature]) return route(surface, 'native', gated ? `${input.cursor.reason} · ${gated}: NMSh removes its host shader on the next sync` : input.cursor.reason);
    if (input.cursor.portableDraws[feature]) return gated ? route(surface, 'off', gated) : route(surface, 'portable', input.cursor.reason);
    return route(surface, 'off', input.cursor.reason);
  };
  const portableRows = (surface: RenderSurface, off: boolean) => gated ? route(surface, 'off', gated) : off ? route(surface, 'off', 'Off in Settings › Motion')
    : route(surface, 'portable', `${look} look · ${ROWS_ONLY}`);
  const passes = (categories: readonly PresetCategory[]) => input.nativePasses.filter(pass => categories.includes(pass.category));
  const host = (surface: RenderSurface, categories: readonly PresetCategory[], none: string) => {
    const chosen = passes(categories);
    if (chosen.length) return route(surface, 'native', `${input.hostName ?? 'Host'} shader: ${chosen.map(pass => pass.label).join(', ')} (written; the host loads it on its next config reload)`);
    return route(surface, 'off', input.hostName ? `${none} Choose one in /appearance › ${input.hostName} shaders.` : `${none} This terminal has no NMSh shader studio.`);
  };
  return [
    cursorPart('cursorTrail', input.cursorMotion, 'motion'),
    cursorPart('cursorEffect', input.cursorEffect, 'effect'),
    portableRows('promptTransitions', input.motionOff.context),
    portableRows('commandFeedback', input.motionOff.launch),
    portableRows('notifications', input.motionOff.events),
    input.idleTimeout <= 0 ? route('idle', 'off', 'The screensaver is off') : input.gate.effectsOff ? route('idle', 'off', 'Effects Off')
      : input.gate.reducedMotion && input.idleScreenMode ? route('idle', 'off', 'Does not start by itself under Reduced Motion; /screensaver previews it')
        : route('idle', 'portable', input.gate.reducedMotion ? 'Held still (Reduced Motion)' : 'NMSh draws idle scenes in its own screen'),
    route('welcome', 'portable', gated ? `Still (${gated}); images use the terminal’s graphics protocol where supported` : 'NMSh composes the welcome; images use the terminal’s graphics protocol where supported'),
    host('hostFocus', ['focus'], 'No focus shader written; NMSh cannot see other windows, so there is no Portable equivalent.'),
    host('hostDisplay', ['ambient', 'display', 'interaction'], 'No ambient or display shader written.'),
  ];
}
