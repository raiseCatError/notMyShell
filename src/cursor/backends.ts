import type {CursorSettings} from '../prompt/configuration.js';

/**
 * Cursor-effect backends. Portable works wherever NMSh owns its input
 * (terminal cells only). Host-native backends use a terminal's own supported
 * GPU features and only where they are installed and configured; nothing
 * here injects anything into a host that does not document the feature.
 */
export type CursorCapability = 'smooth' | 'smear' | 'tail' | 'particles' | 'ripple' | 'idle' | 'dynamicColor' | 'customShader' | 'hotReload';

export interface CursorEffectBackend {
  id: 'portable' | 'ghostty' | 'kitty';
  label: string;
  capabilities: ReadonlySet<CursorCapability>;
  /** Native effects apply to the whole terminal surface (vim, less…), not only NMSh's input. */
  surfaceWide: boolean;
}

export const PORTABLE_BACKEND: CursorEffectBackend = {id: 'portable', label: 'Portable', surfaceWide: false,
  capabilities: new Set(['smooth', 'smear', 'tail', 'particles', 'ripple', 'idle', 'dynamicColor'])};
/** Ghostty ≥ 1.2: custom-shader with the cursor uniforms (iCurrentCursor, iPreviousCursor, iTimeCursorChange); shaders stack. */
export const GHOSTTY_BACKEND: CursorEffectBackend = {id: 'ghostty', label: 'Ghostty native', surfaceWide: true,
  capabilities: new Set(['smooth', 'smear', 'tail', 'particles', 'ripple', 'customShader', 'hotReload'])};
/** Kitty ≥ 0.37: the built-in cursor_trail (a tail with decay and color); no custom cursor shaders. */
export const KITTY_BACKEND: CursorEffectBackend = {id: 'kitty', label: 'Kitty native', surfaceWide: true, capabilities: new Set(['tail', 'dynamicColor'])};

export interface HostCursorFacts {
  host: 'ghostty' | 'kitty' | 'other';
  version?: string;
  /** NMSh's managed native integration is installed in the host's config (include line + managed file). */
  integrated: boolean;
}

export function hostCursorFacts(env: NodeJS.ProcessEnv, integrated: (host: 'ghostty' | 'kitty') => boolean): HostCursorFacts {
  if (env.TERM_PROGRAM === 'ghostty' || env.TERM === 'xterm-ghostty') return {host: 'ghostty', ...(env.TERM_PROGRAM_VERSION ? {version: env.TERM_PROGRAM_VERSION} : {}), integrated: integrated('ghostty')};
  if (env.KITTY_WINDOW_ID || env.TERM === 'xterm-kitty') return {host: 'kitty', integrated: integrated('kitty')};
  return {host: 'other', integrated: false};
}

const atLeast = (version: string | undefined, major: number, minor: number) => {
  const match = /^(\d+)\.(\d+)/u.exec(version ?? '');
  return Boolean(match && (Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor)));
};

/** Whether this host can do native cursor effects at all (documented feature present), regardless of setup. */
export function nativeBackendFor(facts: HostCursorFacts): CursorEffectBackend | undefined {
  if (facts.host === 'ghostty' && (facts.version === undefined || atLeast(facts.version, 1, 2))) return GHOSTTY_BACKEND;
  if (facts.host === 'kitty') return KITTY_BACKEND;
  return undefined;
}

export interface BackendChoice {
  backend: CursorEffectBackend;
  /** Shown in /cursor: why this backend is active. */
  reason: string;
  /** What the native backend draws, so the portable engine skips it (no double rendering). */
  nativeHandles: {motion: boolean; effect: boolean};
}

/**
 * Auto uses native only when NMSh's managed integration is present on a
 * supporting host; forced Host native on an unsupported host falls back to
 * Portable and says so. The person never ends up with no cursor.
 */
export function chooseBackend(settings: CursorSettings, facts: HostCursorFacts): BackendChoice {
  const native = nativeBackendFor(facts);
  const none = {motion: false, effect: false};
  if (settings.renderer === 'portable') return {backend: PORTABLE_BACKEND, reason: 'Portable (chosen)', nativeHandles: none};
  if (!native) {
    return {backend: PORTABLE_BACKEND, reason: settings.renderer === 'native' ? 'Host native is unavailable in this terminal; using Portable' : 'Portable (this terminal has no native cursor effects)', nativeHandles: none};
  }
  if (!facts.integrated) {
    return {backend: PORTABLE_BACKEND, reason: settings.renderer === 'native' ? `${native.label} needs setup (shown before anything changes); using Portable until then` : `Portable · ${native.label} is available after setup`, nativeHandles: none};
  }
  const motion = settings.motion !== 'off' && native.capabilities.has(settings.motion === 'smooth' ? 'smooth' : settings.motion);
  const effect = settings.effect !== 'none' && (native.capabilities.has('customShader') || (settings.effect === 'ripple' && native.capabilities.has('ripple')));
  return {backend: native, reason: `${native.label}${motion || effect ? '' : ' (this combination falls back to Portable)'}`, nativeHandles: {motion, effect}};
}
