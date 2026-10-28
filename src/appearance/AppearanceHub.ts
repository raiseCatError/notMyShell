import {welcomeProvider} from '../output/WelcomeProviders.js';
import type {SurfaceRoute} from '../motion/renderRouting.js';
import type {HostAppearancePlan} from './hostAppearance.js';
import {stripTerminalControls} from '../util/terminalControls.js';
import {truncateAnsi} from '../util/text.js';
import {chromaPreviewNote} from './chromaNotes.js';
import type {Key} from '../terminal/keys.js';
import type {MotionSettings, PromptConfiguration} from '../prompt/configuration.js';
import {MOTION_ITEMS, MOTION_LABELS, MOTION_ROWS, MOTION_TUNING_ITEMS, type MotionItem} from '../motion/motionRows.js';
import {renderValueControl} from '../ui/controls.js';
import {renderStudioLayout, renderStudioReview, studioLabel, studioMuted, studioWrap, type StudioEntry} from '../ui/StudioLayout.js';
import {BLUR_MODES, handleAppearanceKey, type AppearanceState} from './AppearancePanel.js';
import {cursorLabel} from '../cursor/CursorPanel.js';
import {renderMotionPreview, type MotionPreview} from '../motion/MotionPreview.js';
import type {MotionGate} from '../motion/transitions.js';
import {librarySummary} from './themeLibrary.js';
import {providerLabel} from '../prompt/PromptPanel.js';
import {BRIDGE_TARGETS, BRIDGE_TARGET_LABELS, effectiveMode} from '../themeBridge/model.js';

/**
 * /appearance: the visual hub. NMSh rows summarize and open the canonical
 * surfaces (/prompt, /cursor, UI chrome, /chroma) or the general Motion
 * screen; nothing is edited twice. Host window rows keep the existing
 * opacity/blur editing where the host supports it, and say who controls them
 * where it does not, so the hub is useful in every terminal.
 */
export type HubDestination = 'theme' | 'prompt' | 'cursor' | 'chrome' | 'chroma' | 'themeBridge' | 'kittyShaders' | 'glslShaders' | 'welcome';

export interface AppearanceHubState {
  view: 'hub' | 'motion' | 'motionAdvanced' | 'routing';
  selected: number;
  /** Host window editing (the existing AppearanceState), when the host has appearance integration. */
  host?: AppearanceState;
  hostName: string;
  hostGuidance?: string;
  /** Host values were changed and not saved yet. */
  hostDirty: boolean;
  confirmation?: {plan: HostAppearancePlan; offset: number; rowCount?: number; shown?: boolean};
  backgroundInput?: string;
  hostMessage?: string;
  canRestoreHost?: boolean;
  /** When the Motion preview last started (row selected, value changed, R); one run, never a loop. */
  previewStart?: number;
  /** Present in Kitty: the Kitty shaders row's summary (the row exists only there). */
  kittyShaders?: string;
  /** Present in Ghostty: the Ghostty shaders row's summary (the row exists only there). */
  ghosttyShaders?: string;
  /** Who draws each animated surface now (read-only; refreshed by the app whenever the hub renders). */
  routes?: SurfaceRoute[];
  routeSelected?: number;
}

export type HubAction = {kind: 'close'} | {kind: 'open'; destination: HubDestination} | {kind: 'motion'; motion: MotionSettings} | {kind: 'saveHost'} | {kind: 'confirmHost'} | {kind: 'restoreHost'};

/** Compact launcher: each row opens its canonical editor (/theme, /prompt, /cursor, UI chrome, /chroma, Motion, /theme-bridge). */
const BASE_ROWS: Array<{id: HubDestination | 'motion' | 'routing'; label: string}> = [
  {id: 'theme', label: 'Theme Studio'}, {id: 'prompt', label: 'Prompt'}, {id: 'cursor', label: 'Cursor & effects'}, {id: 'chrome', label: 'UI chrome'},
  {id: 'chroma', label: 'Chroma'}, {id: 'motion', label: 'Motion'}, {id: 'themeBridge', label: 'Theme Bridge'}, {id: 'routing', label: 'Effects routing'}, {id: 'welcome', label: 'Welcome'},
];
/** The launcher rows for this host: Kitty or Ghostty adds its shader studio after Cursor & effects. */
const hubRows = (state: AppearanceHubState) => state.kittyShaders !== undefined
  ? [...BASE_ROWS.slice(0, 3), {id: 'kittyShaders' as const, label: 'Kitty shaders'}, ...BASE_ROWS.slice(3)]
  : state.ghosttyShaders !== undefined ? [...BASE_ROWS.slice(0, 3), {id: 'glslShaders' as const, label: 'Ghostty shaders'}, ...BASE_ROWS.slice(3)] : BASE_ROWS;

/** One plain sentence per row, shown beside the list: what the row changes, in everyday words. */
const ROW_HELP: Record<string, string> = {
  'Theme Studio': 'Colors for NMSh, and optionally for your terminal and other tools.',
  Prompt: 'The line shown in front of your commands.',
  'Cursor & effects': 'Cursor shape and color, plus trails and effects when it moves.',
  shaders: 'GPU effects your terminal draws itself: cursor trails, glow and shine.',
  'UI chrome': "Colors of NMSh's own panels, borders and highlights.",
  Chroma: "Gentle color motion across NMSh's interface.",
  Motion: 'Small animations when commands start, finish or fail.',
  'Theme Bridge': 'Share your theme with other command-line tools.',
  'Effects routing': 'Shows whether each effect is drawn by your terminal (GPU) or by NMSh.',
  Welcome: 'The greeting and logo shown when NMSh starts.',
  Opacity: 'How see-through the window is. Lower it to see your desktop behind the text.',
  'Blur mode': 'Blurs what shows through the window. It needs opacity below 100%.',
  Blur: 'How strongly the desktop behind the window is blurred.',
  Background: "The window's background color. Inherit keeps your terminal's own color.",
};

export function createAppearanceHub(hostName: string, host?: AppearanceState, hostGuidance?: string): AppearanceHubState {
  return {view: 'hub', selected: 0, ...(host ? {host} : {}), hostName, ...(hostGuidance ? {hostGuidance} : {}), hostDirty: false};
}

/** Host rows that exist for this host (opacity, blur mode, and blur strength for Numeric). */
function hostRowCount(state: AppearanceHubState): number {
  if (!state.host) return 0;
  return BLUR_MODES[state.host.blurModeIndex] === 'Numeric' ? 4 : 3;
}

export function appearanceHubKey(state: AppearanceHubState, key: Key, configuration: PromptConfiguration, now = Date.now()): HubAction | undefined {
  const NMSH_ROWS = hubRows(state);
  if (state.confirmation) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.confirmation = undefined; return undefined; }
    if (key.kind === 'up' || key.kind === 'down') state.confirmation.offset = Math.max(0, Math.min((state.confirmation.rowCount ?? state.confirmation.plan.preview.length) - 1, state.confirmation.offset + (key.kind === 'up' ? -1 : 1)));
    // Enter confirms only a plan the person could see (not the 'Resize to review' stub).
    return key.kind === 'enter' && state.confirmation.shown !== false ? {kind: 'confirmHost'} : undefined;
  }
  if (state.backgroundInput !== undefined) {
    if (key.kind === 'escape' || key.kind === 'interrupt') state.backgroundInput = undefined;
    else if (key.kind === 'backspace') state.backgroundInput = state.backgroundInput.slice(0, -1);
    else if (key.kind === 'text') state.backgroundInput = (state.backgroundInput + key.value.replace(/[^#0-9a-f]/giu, '')).slice(0, 7);
    else if (key.kind === 'enter' && state.host) {
      if (!state.backgroundInput || /^#?[0-9a-f]{6}$/iu.test(state.backgroundInput)) {
        state.host.background = state.backgroundInput ? `#${state.backgroundInput.replace(/^#/u, '')}` : undefined;
        state.backgroundInput = undefined; state.hostDirty = true;
      } else state.hostMessage = 'Enter six RGB digits, or leave empty to inherit the host background.';
    }
    return undefined;
  }
  if (state.view === 'routing') {
    if (key.kind === 'up' || key.kind === 'down') state.routeSelected = Math.max(0, Math.min((state.routes?.length ?? 1) - 1, (state.routeSelected ?? 0) + (key.kind === 'up' ? -1 : 1)));
    if (key.kind === 'escape' || key.kind === 'interrupt' || key.kind === 'enter') { state.view = 'hub'; state.selected = NMSH_ROWS.findIndex(row => row.id === 'routing'); }
    return undefined;
  }
  if (state.view === 'motion' || state.view === 'motionAdvanced') {
    const advanced = state.view === 'motionAdvanced';
    // The Motion list: Rendering, the five effects, then Advanced (a child screen with the selected rendering's own tuning).
    const items: readonly MotionItem[] = advanced ? MOTION_TUNING_ITEMS : MOTION_ITEMS;
    const count = items.length + (advanced ? 0 : 1);
    if (key.kind === 'escape' || key.kind === 'interrupt') {
      if (advanced) { state.view = 'motion'; state.selected = MOTION_ITEMS.length; state.previewStart = now; return undefined; }
      state.view = 'hub'; state.selected = NMSH_ROWS.findIndex(row => row.id === 'motion'); return undefined;
    }
    if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + count) % count; state.previewStart = now; return undefined; }
    if (key.kind === 'text' && key.value.toLowerCase() === 'r') { state.previewStart = now; return undefined; }
    if (key.kind === 'left' || key.kind === 'right' || key.kind === 'enter') {
      const item = items[state.selected];
      if (!item) { if (key.kind !== 'left') { state.view = 'motionAdvanced'; state.selected = 0; state.previewStart = now; } return undefined; }
      const current = item.get(configuration.motion);
      const index = item.values.indexOf(current);
      const next = item.values[(index + (key.kind === 'left' ? -1 : 1) + item.values.length) % item.values.length]!;
      state.previewStart = now;
      return {kind: 'motion', motion: item.set(configuration.motion, next)};
    }
    return undefined;
  }
  if (state.host && state.hostDirty && key.kind === 'text' && key.value.toLowerCase() === 's') return {kind: 'saveHost'};
  if ((state.host || state.canRestoreHost) && key.kind === 'text' && key.value.toLowerCase() === 'r') return {kind: 'restoreHost'};
  const total = NMSH_ROWS.length + hostRowCount(state);
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'close'};
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + total) % total; return undefined; }
  if (state.selected < NMSH_ROWS.length) {
    if (key.kind !== 'enter' && key.kind !== 'right') return undefined;
    const row = NMSH_ROWS[state.selected]!;
    if (row.id === 'motion') { state.view = 'motion'; state.selected = 0; state.previewStart = now; return undefined; }
    if (row.id === 'routing') { state.view = 'routing'; return undefined; }
    return {kind: 'open', destination: row.id};
  }
  // Host rows: the existing opacity/blur editor, with Enter saving through the host integration.
  if (!state.host) return undefined;
  const backgroundIndex = NMSH_ROWS.length + hostRowCount(state) - 1;
  if (state.selected === backgroundIndex) {
    if (key.kind === 'enter') state.backgroundInput = '';
    return undefined;
  }
  if (key.kind === 'enter') return state.hostDirty ? {kind: 'saveHost'} : undefined;
  state.host.selectedIndex = state.selected - NMSH_ROWS.length;
  if ((key.kind === 'left' || key.kind === 'right') && handleAppearanceKey(key, state.host)) {
    state.hostDirty = true;
    state.selected = NMSH_ROWS.length + Math.min(state.host.selectedIndex, hostRowCount(state) - 1);
  }
  return undefined;
}

/** The Motion screen's preview for the selected row, or undefined outside it. */
export function hubMotionPreview(state: AppearanceHubState, configuration: PromptConfiguration, columns: number, gate: MotionGate, now: number): MotionPreview | undefined {
  if (state.view !== 'motion' && state.view !== 'motionAdvanced') return undefined;
  const item = (state.view === 'motion' ? MOTION_ITEMS : MOTION_TUNING_ITEMS)[state.selected];
  return renderMotionPreview(item?.preview ?? 'commandLaunch', configuration.motion, gate, columns, state.previewStart ?? now - 10_000, now);
}

export function renderAppearanceHub(state: AppearanceHubState, configuration: PromptConfiguration, columns: number, themeLabel: string, cursorBackend: string,
  preview?: {gate: MotionGate; now: number}, height?: number): string[] {
  const NMSH_ROWS = hubRows(state);
  if (state.confirmation) return renderStudioReview(state.confirmation, 'Review host configuration', columns, height);
  if (state.view === 'routing') {
    const routes = state.routes ?? [];
    return renderStudioLayout({title: 'Appearance › Effects routing', subtitle: 'Who draws each effect · configuration snapshot', stacked: height === undefined,
      entries: routes.length ? routes.map(route => ({group: 'Surfaces', label: route.label, value: route.route === 'native' ? 'Host GPU · written, unverified' : route.route === 'portable' ? 'Portable' : 'Off'})) : [{group: 'Routing', label: 'No routes available'}],
      selected: state.routeSelected ?? 0, controls: [['↑↓', 'select'], ['Enter', 'back'], ['Esc', 'back']],
      details: width => [studioLabel(routes[state.routeSelected ?? 0]?.label ?? 'Routing'), ...studioWrap(routes[state.routeSelected ?? 0]?.reason ?? 'No routes available.', width).map(studioMuted)],
    }, columns, height);
  }
  if (state.view === 'motion' || state.view === 'motionAdvanced') {
    const advanced = state.view === 'motionAdvanced';
    const rendering = configuration.motion.rendering === 'rich' ? 'Rich' : 'Clean';
    const items: readonly MotionItem[] = advanced ? MOTION_TUNING_ITEMS : MOTION_ITEMS;
    const entries: StudioEntry[] = items.map(item => ({group: advanced ? `${rendering} tuning` : 'General motion', label: item.label, value: `‹ ${item.labelOf(item.get(configuration.motion))} ›`}));
    if (!advanced) entries.push({group: 'Tuning', label: 'Advanced', value: `${rendering} tuning ›`});
    return renderStudioLayout({title: `Appearance › Motion${advanced ? ` › Advanced (${rendering})` : ''}`,
      subtitle: 'NMSh rows · Reduced Motion and Effects Off stop animation', entries, selected: state.selected,
      controls: [['↑↓', 'select'], ['←→', 'change'], ['Enter', 'open'], ['R', 'replay'], ['Esc', 'back']],
      details: (width, room) => {
        const shown = preview ? hubMotionPreview(state, configuration, width, preview.gate, preview.now) : undefined;
        const note = studioWrap(items[state.selected]?.note ?? `Intensity and speed for ${rendering} rendering; Enter opens them`, width).map(studioMuted);
        const sample = shown ? [studioLabel(`Preview · ${rendering}`), ...shown.rows] : [];
        return note.length + sample.length <= room ? [...note, ...sample] : note;
      },
    }, columns, height);
  }
  const cursor = configuration.cursor;
  const motion = configuration.motion;
  const anyMotion = MOTION_ROWS.some(row => motion[row.key] !== 'off');
  const summaries: Record<string, string> = {
    theme: [themeLabel, librarySummary(configuration.themes)].filter(Boolean).join(' · '),
    prompt: configuration.provider === 'none' ? 'None · composer only' : `${providerLabel(configuration.provider)} · ${configuration.nmsh.textColors === 'neutral' ? 'Neutral text' : 'Theme text'}`,
    themeBridge: (() => { const active = BRIDGE_TARGETS.filter(target => effectiveMode(configuration.themeBridge, target) !== 'independent');
      return active.length ? active.map(target => BRIDGE_TARGET_LABELS[target]).join(', ') : 'Off · every tool Independent'; })(),
    cursor: `${cursorLabel(cursor.shape)} · ${cursor.motion === 'off' ? 'no motion' : cursorLabel(cursor.motion)}${cursor.effect !== 'none' ? ` · ${cursorLabel(cursor.effect)}` : ''} · ${cursorBackend}`,
    chrome: configuration.uiChrome.source === 'theme' ? 'Follow theme' : 'Custom',
    chroma: configuration.presentation.preset === 'off' ? 'Off' : `${configuration.presentation.preset} · ${configuration.presentation.motion}`,
    welcome: welcomeProvider(configuration.welcome).label,
    kittyShaders: state.kittyShaders ?? '',
    glslShaders: state.ghosttyShaders ?? '',
    routing: (() => { const routes = state.routes ?? []; const count = (value: string) => routes.filter(route => route.route === value).length;
      return routes.length ? [count('native') ? `${count('native')} on host GPU` : '', `${count('portable')} Portable`, count('off') ? `${count('off')} off` : ''].filter(Boolean).join(' · ') : 'Who draws each effect'; })(),
    motion: anyMotion ? `${motion.rendering === 'rich' ? 'Rich' : 'Clean'} · Launch ${MOTION_LABELS[motion.commandLaunch]} · Context ${MOTION_LABELS[motion.contextTransitions]} · Events ${MOTION_LABELS[motion.eventFeedback]}` : 'Off',
  };
  const entries: StudioEntry[] = NMSH_ROWS.map(row => ({
    group: ['theme', 'prompt'].includes(row.id) ? 'Look' : ['cursor', 'kittyShaders', 'glslShaders'].includes(row.id) ? 'Cursor & effects' : row.id === 'welcome' ? 'Startup' : 'Interface & motion',
    label: row.label, value: summaries[row.id],
  }));
  if (state.host) {
    const host = state.host;
    const hostRows: Array<[string, string]> = [
      ['Opacity', `${'█'.repeat(Math.max(0, Math.min(10, Math.round(host.opacity * 10))))}${'░'.repeat(10 - Math.max(0, Math.min(10, Math.round(host.opacity * 10))))}  ${Math.round(host.opacity * 100)}%`],
      ['Blur mode', BLUR_MODES[host.blurModeIndex]!],
    ];
    if (BLUR_MODES[host.blurModeIndex] === 'Numeric') hostRows.push(['Blur', renderValueControl('number', String(host.blurStrength), host.blurStrength / 50)]);
    hostRows.push(['Background', state.backgroundInput !== undefined ? `RGB: ${state.backgroundInput}_` : stripTerminalControls(host.background ?? 'Inherit host color')]);
    entries.push(...hostRows.map(([label, value]) => ({group: `Window · ${stripTerminalControls(state.hostName)}`, label, value})));
  }
  const selectedEntry = entries[state.selected];
  const help = selectedEntry ? ROW_HELP[selectedEntry.label] ?? (/shaders$/u.test(selectedEntry.label) ? ROW_HELP.shaders : undefined) : undefined;
  return renderStudioLayout({title: 'Appearance', stacked: height === undefined, subtitle: state.host ? 'Enter opens a row · ←→ changes window values' : 'Enter opens a row',
    entries, selected: state.selected,
    // Blur shows through the transparent part of the window only; at 100% opacity there is nothing to blur.
    notice: [state.hostMessage ?? (state.hostDirty ? 'Unsaved host changes · S reviews, Enter writes and reloads the terminal' : undefined),
      state.host && state.host.opacity >= 1 && BLUR_MODES[state.host.blurModeIndex] !== 'Off' ? 'Blur shows only below 100% opacity: lower Opacity first.' : undefined].filter(Boolean).join(' · ') || undefined,
    controls: state.backgroundInput !== undefined ? [['Enter', 'apply RGB'], ['Esc', 'cancel']] : [
      ['↑↓', 'select'], ['Enter', 'open'], ...(state.host ? [['←→', 'adjust'], ['S', 'review']] as const : []),
      ...(state.host || state.canRestoreHost ? [['R', 'restore']] as const : []), ['Esc', 'close']],
    details: width => [studioLabel(selectedEntry?.label ?? 'Appearance'),
      ...studioWrap(selectedEntry?.value ?? '', width), ...(help ? ['', ...studioWrap(help, width)] : []), '',
      studioMuted(truncateAnsi(`Terminal  ${stripTerminalControls(state.hostName)}`, width)),
      ...studioWrap(state.host ? `Window settings: NMSh shows the exact change before writing, then reloads ${stripTerminalControls(state.hostName)} so it shows at once. R removes NMSh's window settings again.`
        : state.hostGuidance ?? `Opacity and blur are controlled by ${stripTerminalControls(state.hostName)}.`, width).map(studioMuted), '',
      ...studioWrap(`Chroma ${configuration.presentation.preset === 'off' ? 'OFF' : 'ON'} · ${chromaPreviewNote(configuration.presentation.preset !== 'off')}`, width).map(studioMuted)],
  }, columns, height ?? 72);
}
