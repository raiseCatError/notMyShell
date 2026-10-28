import type {CursorEffect, CursorIdleEffect, CursorMotion, CursorRenderer, CursorSettings} from '../prompt/configuration.js';
import {terminalProfile} from '../host/capabilities.js';

/**
 * Cursor-effect backends. Portable works wherever NMSh owns its input
 * (terminal cells only). Host-native backends use a terminal's own supported
 * GPU features and only where they are installed and configured; nothing
 * here injects anything into a host that does not document the feature.
 */
export type CursorFeature = 'motion' | 'effect' | 'idleEffect';

/**
 * What a backend REALLY implements, by named value. This is the capability
 * matrix: a feature is listed only when the generated implementation (the
 * Portable engine, NMSh's Ghostty shader, Kitty's cursor_trail) draws that
 * named thing. Broad flags such as "custom shader" prove nothing about Fire,
 * Lightning or an idle glow, so they are never consulted.
 */
export interface CursorSupport {
  motion: readonly CursorMotion[];
  effect: readonly CursorEffect[];
  idleEffect: readonly CursorIdleEffect[];
}

export interface CursorEffectBackend {
  id: 'portable' | 'ghostty' | 'kitty';
  label: string;
  /** The host's own name for messages ("Ghostty"); Portable has none. */
  host?: string;
  support: CursorSupport;
  /** Native effects apply to the whole terminal surface (vim, less…), not only NMSh's input. */
  surfaceWide: boolean;
}

export const PORTABLE_BACKEND: CursorEffectBackend = {id: 'portable', label: 'Portable', surfaceWide: false,
  support: {motion: ['smooth', 'smear', 'tail'], effect: ['fire', 'sparks', 'lightning', 'railgun', 'ripple', 'wireframe'], idleEffect: ['glow', 'embers', 'flame', 'sparks']}};
/**
 * Ghostty ≥ 1.2: custom-shader with the cursor uniforms (iCurrentCursor, iPreviousCursor, iTimeCursorChange); shaders stack.
 * NMSh's shader draws Smear and Tail, and the Fire, Sparks and Ripple effects. It does not draw Smooth (the real caret
 * jumps), Lightning, Railgun, Wireframe, or any idle effect, and says so instead of pretending.
 */
export const GHOSTTY_BACKEND: CursorEffectBackend = {id: 'ghostty', label: 'Ghostty native', host: 'Ghostty', surfaceWide: true,
  support: {motion: ['smear', 'tail'], effect: ['fire', 'sparks', 'ripple'], idleEffect: []}};
/** Kitty ≥ 0.37: the built-in cursor_trail (a tail with decay and color); no NMSh cursor shader, so no effects. */
export const KITTY_BACKEND: CursorEffectBackend = {id: 'kitty', label: 'Kitty native', host: 'Kitty', surfaceWide: true, support: {motion: ['tail'], effect: [], idleEffect: []}};
/**
 * Kitty ≥ 0.49 with NMSh's reviewed Lightning trail shader written: Kitty draws the trail AND a lightning bolt along it, so
 * Portable must not draw its own Lightning too. Other Kitty trail styles (Blaze, Motion blur, Default) are trail looks only.
 */
export const KITTY_LIGHTNING_BACKEND: CursorEffectBackend = {...KITTY_BACKEND, support: {motion: ['tail'], effect: ['lightning'], idleEffect: []}};
/**
 * Ghostty with a trail from /appearance › Ghostty shaders written (NMSh's reviewed studio pass): Ghostty draws the Smear or
 * Tail trail; NMSh's older /cursor shader is paused then, so its Fire/Sparks/Ripple are drawn by Portable.
 */
export const GHOSTTY_TRAIL_BACKEND: CursorEffectBackend = {id: 'ghostty', label: 'Ghostty native', host: 'Ghostty', surfaceWide: true, support: {motion: ['smear', 'tail'], effect: [], idleEffect: []}};
const GHOSTTY_TRAIL_LABELS: Record<string, string> = {smear: 'Smear', comet: 'Comet'};
const KITTY_TRAIL_LABELS: Record<string, string> = {'cursor-trail-default': 'Default', 'cursor-trail-blaze': 'Blaze', 'cursor-trail-lightning': 'Lightning', 'cursor-trail-motion-blur': 'Motion blur'};

export interface HostCursorFacts {
  host: 'ghostty' | 'kitty' | 'other';
  /** A friendly name for the terminal when it is recognised ("Zed", "Terminal.app"); messages use it. */
  hostName?: string;
  /**
   * Who decides the color of the PHYSICAL caret. NMSh never sets it (no terminal cursor-color sequence is sent), so it is the
   * host's own; Zed paints it from the active theme's cursor color and ignores a terminal's color request.
   * NMSh's cursor color tints its own effects, trails and previews.
   */
  caretColor: 'host-controlled' | 'theme-controlled';
  version?: string;
  /** NMSh's managed native integration is installed in the host's config (include line + managed file). */
  integrated: boolean;
  /** Kitty: the trail shader NMSh's reviewed Kitty pipeline currently contains (e.g. "cursor-trail-blaze"). */
  kittyTrail?: string;
  /** Ghostty: the studio trail NMSh's reviewed Ghostty configuration currently contains (e.g. "comet"). */
  ghosttyTrail?: string;
  /**
   * Ghostty: a native trail NMSh stopped writing that Ghostty may still draw until its config is reloaded
   * ('nmsh-cursor' = NMSh's older /cursor shader). Portable cursor motion waits meanwhile (never two trails).
   */
  ghosttyTrailPending?: string;
}

const KNOWN_HOSTS: Record<string, string> = {zed: 'Zed', Apple_Terminal: 'Terminal.app', 'iTerm.app': 'iTerm2', WezTerm: 'WezTerm', vscode: 'VS Code', ghostty: 'Ghostty'};

export function hostCursorFacts(env: NodeJS.ProcessEnv, integrated: (host: 'ghostty' | 'kitty') => boolean, kittyTrail: () => string | undefined = () => undefined,
  ghostty: () => {trail?: string; pending?: string} = () => ({})): HostCursorFacts {
  // One host identity for every surface (terminalProfile): an inherited TERM_PROGRAM must not turn Kitty into Ghostty.
  const profile = terminalProfile(env);
  const hostName = KNOWN_HOSTS[env.TERM_PROGRAM ?? ''];
  const caretColor = profile === 'zed' ? 'theme-controlled' as const : 'host-controlled' as const;
  if (profile === 'ghostty') {
    const studio = ghostty();
    return {host: 'ghostty', hostName: 'Ghostty', caretColor, ...(env.TERM_PROGRAM_VERSION ? {version: env.TERM_PROGRAM_VERSION} : {}), integrated: integrated('ghostty'),
      ...(studio.trail ? {ghosttyTrail: studio.trail} : {}), ...(studio.pending ? {ghosttyTrailPending: studio.pending} : {})};
  }
  if (profile === 'kitty' || (profile === 'baseline' && env.KITTY_WINDOW_ID)) {
    const trail = kittyTrail();
    return {host: 'kitty', hostName: 'Kitty', caretColor, integrated: integrated('kitty'), ...(trail ? {kittyTrail: trail} : {})};
  }
  return {host: 'other', ...(hostName ? {hostName} : {}), caretColor, integrated: false};
}

/**
 * What "Cursor color" does and does not do on this host, in one sentence. It colors NMSh's own effects, trails and
 * previews (and, once set up, Ghostty's or Kitty's native trail); the physical caret keeps the host's color.
 */
export function caretColorNote(facts: HostCursorFacts, source: string): string {
  const who = facts.hostName ?? 'Your terminal';
  if (source === 'host') return `Host: ${who} draws the caret in its own color; effects borrow a neutral tone.`;
  const how = facts.caretColor === 'theme-controlled' ? `in your ${who} theme's cursor color` : 'in its own color';
  const native = facts.integrated && facts.host !== 'other' ? ' and the native trail' : '';
  return `Colors NMSh's effects, trails${native} and previews. ${who} draws the physical caret ${how}; NMSh does not change it.`;
}

const atLeast = (version: string | undefined, major: number, minor: number) => {
  const match = /^(\d+)\.(\d+)/u.exec(version ?? '');
  return Boolean(match && (Number(match[1]) > major || (Number(match[1]) === major && Number(match[2]) >= minor)));
};

/** Whether this host can do native cursor effects at all (documented feature present), regardless of setup. */
export function nativeBackendFor(facts: HostCursorFacts): CursorEffectBackend | undefined {
  if (facts.host === 'ghostty' && facts.ghosttyTrail) return GHOSTTY_TRAIL_BACKEND;
  if (facts.host === 'ghostty' && (facts.version === undefined || atLeast(facts.version, 1, 2))) return GHOSTTY_BACKEND;
  if (facts.host === 'kitty') return facts.kittyTrail === 'cursor-trail-lightning' ? KITTY_LIGHTNING_BACKEND : KITTY_BACKEND;
  return undefined;
}

export interface BackendChoice {
  backend: CursorEffectBackend;
  /** Shown in /cursor: why this backend is active. */
  reason: string;
  /** What the native backend draws, so the portable engine skips it (no double rendering). */
  nativeHandles: {motion: boolean; effect: boolean};
  /** What the Portable engine is asked to draw: everything, only what native does not, or nothing (a forced host renderer). */
  portableDraws: {motion: boolean; effect: boolean; idle: boolean};
  /** The host's native backend when this terminal has one (set up or not), for messages. */
  native?: CursorEffectBackend;
}

const supports = (backend: CursorEffectBackend, feature: CursorFeature, value: string): boolean => (backend.support[feature] as readonly string[]).includes(value);
const isOff = (value: string) => value === 'off' || value === 'none';

/**
 * Auto uses native only when NMSh's managed integration is present on a
 * supporting host; Portable draws whatever native does not. Forced Host
 * native draws only what the host backend does, and nothing at all where the
 * host has none. Portable is always available. The person never ends up
 * unsure which renderer is drawing.
 */
export function chooseBackend(settings: CursorSettings, facts: HostCursorFacts): BackendChoice {
  const choice = chooseWithoutPending(settings, facts);
  // A trail Ghostty may still draw: one NMSh stopped writing (until a reload), or one still written although it should not be
  // (Portable chosen but the update was refused). Portable must not add a second trail either way.
  const loaded = facts.ghosttyTrailPending ?? (facts.ghosttyTrail && !choice.nativeHandles.motion ? facts.ghosttyTrail : undefined);
  if (!loaded) return choice;
  const effects = loaded === 'nmsh-cursor';
  return {...choice, portableDraws: {...choice.portableDraws, motion: false, effect: choice.portableDraws.effect && !effects},
    reason: facts.ghosttyTrailPending ? `${choice.reason} · Portable cursor motion waits for a Ghostty config reload (then L in /appearance › Ghostty shaders)`
      : `${choice.reason} · Ghostty still lists NMSh’s trail (its update was refused); open /appearance › Ghostty shaders`};
}

function chooseWithoutPending(settings: CursorSettings, facts: HostCursorFacts): BackendChoice {
  const native = nativeBackendFor(facts);
  const all = {motion: true, effect: true, idle: true};
  const nothing = {motion: false, effect: false, idle: false};
  const none = {motion: false, effect: false};
  if (settings.renderer === 'portable') return {backend: PORTABLE_BACKEND, reason: 'Portable (chosen)', nativeHandles: none, portableDraws: all, ...(native ? {native} : {})};
  if (!native) {
    if (settings.renderer === 'native') return {backend: PORTABLE_BACKEND, reason: 'Host native is not available in this terminal; no effects are drawn', nativeHandles: none, portableDraws: nothing};
    return {backend: PORTABLE_BACKEND, reason: 'Portable (this terminal has no native cursor effects)', nativeHandles: none, portableDraws: all};
  }
  // A Kitty trail shader NMSh wrote after review counts as set up: Kitty draws that trail, so Portable must not draw a second one.
  const integrated = facts.integrated || Boolean(facts.kittyTrail) || Boolean(facts.ghosttyTrail);
  if (!integrated) {
    return {backend: PORTABLE_BACKEND, native, nativeHandles: none,
      reason: settings.renderer === 'native' ? `${native.label} needs setup (shown before anything changes); no effects are drawn until then` : `Portable · ${native.label} is available after setup`,
      portableDraws: settings.renderer === 'native' ? nothing : all};
  }
  const motion = !isOff(settings.motion) && supports(native, 'motion', settings.motion);
  // Kitty's shader trails draw only while its cursor_trail runs, which NMSh's Kitty fragment turns on with a motion.
  const effect = !isOff(settings.effect) && supports(native, 'effect', settings.effect) && (native.id !== 'kitty' || !isOff(settings.motion));
  const forced = settings.renderer === 'native';
  const fallback = !forced && ((!isOff(settings.motion) && !motion) || (!isOff(settings.effect) && !effect) || !isOff(settings.idleEffect));
  const style = facts.kittyTrail ? ` · ${KITTY_TRAIL_LABELS[facts.kittyTrail] ?? 'custom'} trail shader`
    : facts.ghosttyTrail ? ` · ${GHOSTTY_TRAIL_LABELS[facts.ghosttyTrail] ?? 'studio'} trail shader` : '';
  return {backend: native, native, nativeHandles: {motion, effect},
    reason: `${native.label}${style}${fallback ? ' with Portable fallback for what it does not draw' : ''}`,
    portableDraws: forced ? nothing : {motion: !motion, effect: !effect, idle: true}};
}

/** How one value of one feature is delivered, or why it cannot be. */
export type Availability =
  | {available: true; via: 'none' | 'portable' | 'native' | 'native-pending' | 'portable-fallback'; suffix: string}
  | {available: false; reason: string};

const FEATURE_WORD: Record<CursorFeature, string> = {motion: 'motion', effect: 'effect', idleEffect: 'idle effect'};

/**
 * Whether a value can actually work under the effective renderer. Forced Host
 * native offers only what the host backend draws; Auto offers everything and
 * says plainly when a native host is active but Portable draws it instead.
 */
export function availabilityOf(feature: CursorFeature, value: string, renderer: CursorRenderer, facts: HostCursorFacts): Availability {
  if (isOff(value)) return {available: true, via: 'none', suffix: ''};
  if (renderer === 'portable') return {available: true, via: 'portable', suffix: ''};
  const native = nativeBackendFor(facts);
  if (renderer === 'native') {
    if (!native) return {available: false, reason: 'Host native is not available in this terminal.'};
    if (!supports(native, feature, value)) return {available: false, reason: `${native.host ?? native.label} Native does not provide this ${FEATURE_WORD[feature]}.`};
    return facts.integrated || facts.ghosttyTrail ? {available: true, via: 'native', suffix: ''} : {available: true, via: 'native-pending', suffix: `after ${native.host} setup`};
  }
  if (native && (facts.integrated || facts.kittyTrail || facts.ghosttyTrail)) return supports(native, feature, value) ? {available: true, via: 'native', suffix: ''} : {available: true, via: 'portable-fallback', suffix: 'Portable fallback'};
  return {available: true, via: 'portable', suffix: ''};
}

/** The values of a feature that can work right now, in their registry order. */
export function availableValues<T extends string>(feature: CursorFeature, values: readonly T[], renderer: CursorRenderer, facts: HostCursorFacts): T[] {
  return values.filter(value => availabilityOf(feature, value, renderer, facts).available);
}

/** Why a feature offers nothing beyond Off/None under this renderer (undefined when something works). */
export function unavailableReason<T extends string>(feature: CursorFeature, values: readonly T[], renderer: CursorRenderer, facts: HostCursorFacts): string | undefined {
  if (availableValues(feature, values, renderer, facts).some(value => !isOff(value))) return undefined;
  const sample = values.find(value => !isOff(value));
  const result = sample ? availabilityOf(feature, sample, renderer, facts) : undefined;
  return result && !result.available ? result.reason : undefined;
}

/** The facts the app currently knows; Setup and Settings rows read them without owning host detection. */
let currentFacts: HostCursorFacts | undefined;
let factsProvider: () => HostCursorFacts = () => ({host: 'other', caretColor: 'host-controlled', integrated: false});
export function setCursorHostProvider(provider: (() => HostCursorFacts) | undefined): void { factsProvider = provider ?? (() => ({host: 'other', caretColor: 'host-controlled', integrated: false})); currentFacts = undefined; }
export function currentCursorHost(): HostCursorFacts { return currentFacts ?? factsProvider(); }
export function setCursorHostFacts(facts: HostCursorFacts | undefined): void { currentFacts = facts; }
