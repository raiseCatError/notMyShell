import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration, WelcomeProviderId} from '../prompt/configuration.js';
import {WELCOME_PROVIDERS} from '../output/WelcomeProviders.js';
import {framePanel, selectedRowBand} from '../ui/PanelShell.js';
import {renderControlRows} from '../ui/controls.js';
import {truncateAnsi} from '../util/text.js';
import {composeWelcome, type WelcomeCapabilities, type WelcomeFacts, type WelcomeComposition} from './compose.js';
import {ALPHAS, DEFAULT_WELCOME_STUDIO, EFFECTS, FACTS, FITS, LAYOUTS, LOGOS, PALETTES, WELCOME_PRESETS, normalizeWelcomeStudio, welcomeText, type SavedWelcomePreset, type WelcomeStudio} from './model.js';
import type {AssetEntry} from './assets.js';

export interface WelcomeEditor {
  draft: WelcomeStudio; original: WelcomeStudio; provider: WelcomeProviderId;
  presets: SavedWelcomePreset[]; selected: number; preset: number;
  input?: {kind: string; value: string; before: WelcomeStudio; selected: number};
  picker?: {directory: string; entries: AssetEntry[]; selected: number};
  message?: string; paused: boolean; elapsed: number; started: number;
  narrow: boolean; reduced: boolean; theme: boolean; before: boolean; includePath: boolean;
  captured?: string[]; previewTop?: number; preview?: WelcomeComposition;
}
export function createWelcomeEditor(config: PromptConfiguration, now = Date.now()): WelcomeEditor {
  return {draft: structuredClone(config.welcomeStudio), original: structuredClone(config.welcomeStudio), provider: config.welcome,
    presets: structuredClone(config.welcomePresets), selected: 0, preset: 0, paused: false, elapsed: 0, started: now,
    narrow: false, reduced: false, theme: false, before: false, includePath: false};
}
const FIELDS = ['Provider', 'Logo', 'Asset path / picker', 'Fit', 'Alpha', 'Layout', 'Title', 'Greeting', 'Density', 'Border', 'Palette', 'Custom RGB', 'Still image effect', 'Links',
  ...FACTS.map(f => `Fact: ${f}${['hostname', 'user', 'path', 'git'].includes(f) ? ' (private, opt in)' : ''}`),
  'Preset', 'Save preset', 'Duplicate preset', 'Reset layout', 'Import JSON file', 'Export JSON file', 'Export private path'] as const;
export type WelcomeEditorAction = 'close' | 'save' | 'asset' | 'picker' | 'import' | 'export' | 'provider' | undefined;
const cycle = <T>(values: readonly T[], current: T, delta: number): T => values[(values.indexOf(current) + delta + values.length) % values.length]!;
export function welcomeEditorKey(state: WelcomeEditor, key: Key, now = Date.now(), providers: readonly WelcomeProviderId[] = WELCOME_PROVIDERS.map(p => p.id)): WelcomeEditorAction {
  if (state.input) {
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.draft = state.input.before; state.selected = state.input.selected; state.input = undefined; return; }
    if (key.kind === 'backspace') state.input.value = state.input.value.slice(0, -1);
    if (key.kind === 'text') state.input.value = welcomeText(state.input.value + key.value, 4096);
    if (key.kind !== 'enter') return;
    const {kind, value} = state.input;
    if (kind === 'asset') { state.draft.assetPath = value; state.input = undefined; state.draft.customized = true; return 'asset'; }
    if (kind === 'import' || kind === 'export') return kind;
    if (kind === 'preset') {
      if (state.presets.length >= 12) { state.message = 'At most 12 saved presets.'; return; }
      state.presets.push({name: welcomeText(value || `Welcome ${state.presets.length + 1}`, 48), model: normalizeWelcomeStudio({...state.draft, customized: true})});
    } else if (kind === 'links') state.draft.links = value.split(' ').filter(Boolean);
    else if (kind === 'title' || kind === 'greeting' || kind === 'customColor') state.draft[kind] = value;
    state.draft = normalizeWelcomeStudio({...state.draft, customized: true}); state.input = undefined; return;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'close';
  if (key.kind === 'up' || key.kind === 'down') { state.selected = (state.selected + (key.kind === 'up' ? -1 : 1) + FIELDS.length) % FIELDS.length; return; }
  if (key.kind === 'text') {
    switch (key.value.toLowerCase()) {
      case 's': state.draft.customized = true; return 'save';
      case ' ': state.elapsed = state.paused ? state.elapsed : now - state.started; state.started = now - state.elapsed; state.paused = !state.paused; return;
      case 'r': state.elapsed = 0; state.started = now; state.paused = false; return;
      case 'w': state.narrow = !state.narrow; return;
      case 'c': state.draft.density = state.draft.density === 'compact' ? 'expanded' : 'compact'; state.draft.customized = true; return;
      case 't': state.theme = !state.theme; return;
      case 'm': state.reduced = !state.reduced; state.elapsed = 0; state.started = now; return;
      case 'b': state.before = !state.before; return;
      case 'o': if (state.selected === 2) return 'picker'; return;
    }
  }
  if (!['enter', 'left', 'right', 'tab'].includes(key.kind)) return;
  const delta = key.kind === 'left' ? -1 : 1;
  const m = state.draft;
  const input = (kind: string, value = '') => { state.input = {kind, value, before: structuredClone(m), selected: state.selected}; };
  switch (state.selected) {
    case 0: state.provider = cycle(providers, state.provider, delta); return 'provider';
    case 1: m.logo = cycle(LOGOS, m.logo, delta); break;
    case 2: input('asset', m.assetPath); return;
    case 3: m.fit = cycle(FITS, m.fit, delta); break;
    case 4: m.alpha = cycle(ALPHAS, m.alpha, delta); break;
    case 5: m.layout = cycle(LAYOUTS, m.layout, delta); break;
    case 6: input('title', m.title); return;
    case 7: input('greeting', m.greeting); return;
    case 8: m.density = m.density === 'compact' ? 'expanded' : 'compact'; break;
    case 9: m.border = !m.border; break;
    case 10: m.palette = cycle(PALETTES, m.palette, delta); break;
    case 11: input('customColor', m.customColor); return;
    case 12: m.effect = cycle(EFFECTS, m.effect, delta); break;
    case 13: input('links', m.links.join(' ')); return;
    case 24: {
      const presets = [...WELCOME_PRESETS, ...state.presets];
      state.preset = (state.preset + delta + presets.length) % presets.length;
      state.draft = structuredClone(presets[state.preset]!.model); return 'asset';
    }
    case 25: case 26: input('preset', state.selected === 26 ? 'Welcome copy' : 'My welcome'); return;
    case 27: state.draft = structuredClone(DEFAULT_WELCOME_STUDIO); state.draft.customized = true; return 'asset';
    case 28: input('import'); return;
    case 29: input('export'); return;
    case 30: state.includePath = !state.includePath; return;
    default: {
      const fact = FACTS[state.selected - 14];
      if (fact) m.modules = m.modules.includes(fact) ? m.modules.filter(f => f !== fact) : [...m.modules, fact];
    }
  }
  m.customized = true;
}
function values(s: WelcomeEditor): string[] {
  const m = s.draft;
  return [s.provider, m.logo, m.assetPath || 'Enter path; O browse', m.fit, m.alpha, m.layout, m.title, m.greeting, m.density, m.border ? 'On' : 'Off', m.palette, m.customColor, m.effect, m.links.join(' '),
    ...FACTS.map(f => m.modules.includes(f) ? 'On' : 'Off'), [...WELCOME_PRESETS, ...s.presets][s.preset]?.name ?? 'Vespyr', `${s.presets.length}/12 saved`, 'Copy current layout', 'Built-in defaults', 'Local JSON only', 'No bytes exported', s.includePath ? 'Include path (private)' : 'Omit path (default)'];
}
export function renderWelcomeEditor(s: WelcomeEditor, columns: number, height: number, facts: WelcomeFacts, caps: WelcomeCapabilities, now: number,
  paint?: (frame: WelcomeComposition) => string[]): string[] {
  const width = Math.max(1, columns - 4);
  const controls = renderControlRows(s.input ? [['Enter', 'apply'], ['Esc', 'cancel']] : s.picker ? [['↑↓', 'select'], ['Enter', 'open'], ['Esc', 'back']] :
    [['↑↓', 'select'], ['←→', 'change'], ['Enter', 'edit'], ['S', 'save'], ['P', 'full preview'], ['Esc', 'back'], ['Space', 'pause'], ['R', 'replay'], ['W', 'width'], ['C', 'density'], ['T', 'theme'], ['M', 'still'], ['B', 'before']], width);
  const notes = [caps.asset?.reason, s.message ?? (s.input ? 'Esc restores this field.' : 'Local assets only · originals unchanged')].filter((v): v is string => Boolean(v));
  const room = Math.max(0, height - controls.length - 5 - notes.length);
  const listSize = Math.min(5, Math.floor(room / 2));
  const previewSize = Math.max(0, room - listSize);
  let list: string[];
  if (s.input) list = [`${s.input.kind}: ${s.input.value}_`];
  else if (s.picker) {
    const p = s.picker, start = Math.max(0, p.selected - Math.floor(listSize / 2));
    list = p.entries.slice(start, start + listSize).map((e, i) => {
      const row = `${e.directory ? 'Folder: ' : ''}${welcomeText(e.name)}`;
      return start + i === p.selected ? selectedRowBand(row, width) : row;
    });
  } else {
    const start = Math.max(0, Math.min(FIELDS.length - listSize, s.selected - Math.floor(listSize / 2)));
    const v = values(s);
    list = FIELDS.slice(start, start + listSize).map((label, i) => {
      const row = `${label}: ${v[start + i]}`;
      return start + i === s.selected ? selectedRowBand(row, width) : row;
    });
  }
  const model = s.before ? s.original : s.draft;
  const frame = composeWelcome(model, facts, {columns: s.narrow ? Math.min(40, width) : width, rows: previewSize},
    {...caps, reducedMotion: caps.reducedMotion || s.reduced, ...(s.theme ? {accent: {red: 90, green: 180, blue: 210}, chroma: {red: 230, green: 150, blue: 70}} : {})}, s.paused ? s.elapsed : now - s.started);
  s.preview = frame;
  s.previewTop = list.length + notes.length + 3;
  let preview = s.provider === 'none' ? ['No startup welcome.'] : s.provider !== 'vespyr' ? s.captured?.slice(0, previewSize).map(r => caps.color ? r : r.replace(/\x1b\[[0-9;]*m/gu, '')) ?? ['External provider preview loading…'] : paint?.(frame) ?? frame.rows.map(r => r.ansi);
  if (!previewSize) preview = [];
  const rows = ['Welcome Studio', ...list, ...notes,
    `Preview · ${s.before ? 'before' : 'draft'} · ${s.paused ? 'paused' : now - s.started >= 5000 ? 'settled' : 'playing'}${s.reduced ? ' · still' : ''}`, ...preview, ...controls];
  return framePanel(rows.slice(0, Math.max(1, height - 2)).map(r => truncateAnsi(r, width)), columns).slice(0, height);
}
