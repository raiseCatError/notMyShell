import type {Key} from '../terminal/keys.js';
import type {PromptConfiguration, WelcomeProviderId} from '../prompt/configuration.js';
import {WELCOME_PROVIDERS} from '../output/WelcomeProviders.js';
import {tabCycleDelta} from '../ui/PanelShell.js';
import {renderStudioLayout, studioLabel, studioMuted, studioWrap, type StudioEntry} from '../ui/StudioLayout.js';
import {renderControlRows, renderValueControl} from '../ui/controls.js';
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
  captured?: string[]; previewTop?: number; previewLeft?: number; preview?: WelcomeComposition;
  choices?: {kind: 'logo' | 'layout' | 'effect' | 'preset'; selected: number};
}
export function createWelcomeEditor(config: PromptConfiguration, now = Date.now()): WelcomeEditor {
  return {draft: structuredClone(config.welcomeStudio), original: structuredClone(config.welcomeStudio), provider: config.welcome,
    presets: structuredClone(config.welcomePresets), selected: 0, preset: 0, paused: false, elapsed: 0, started: now,
    narrow: false, reduced: false, theme: false, before: false, includePath: false};
}
const FIELDS = ['Provider', 'Logo', 'Asset path / picker', 'Fit', 'Alpha', 'Layout', 'Title', 'Greeting', 'Density', 'Border', 'Palette', 'Custom RGB', 'Still image effect', 'Links',
  ...FACTS.map(f => `Fact: ${f}${['hostname', 'user', 'path', 'git'].includes(f) ? ' (private, opt in)' : ''}`),
  'Preset', 'Save preset', 'Duplicate preset', 'Reset layout', 'Import JSON file', 'Export JSON file', 'Export private path'] as const;
const SECTIONS = [
  {label: 'Logo & image', fields: [0, 1, 2, 3, 4]},
  {label: 'Typography & greeting', fields: [6, 7, 13]},
  {label: 'Layout & position', fields: [5, 8, 9]},
  {label: 'Theme & palette', fields: [10, 11]},
  {label: 'Facts/modules', fields: Array.from({length: FACTS.length}, (_, i) => i + 14)},
  {label: 'Animation', fields: [12]},
  {label: 'Presets', fields: [24, 25, 26, 27, 28, 29, 30]},
] as const;
const FIELD_ORDER = SECTIONS.flatMap(section => [...section.fields]);
const sectionOf = (field: number) => Math.max(0, SECTIONS.findIndex(section => (section.fields as readonly number[]).includes(field)));
const choiceValues = (s: WelcomeEditor) => s.choices?.kind === 'preset' ? [...WELCOME_PRESETS, ...s.presets].map(p => p.name)
  : s.choices?.kind === 'layout' ? [...LAYOUTS] : s.choices?.kind === 'logo' ? [...LOGOS] : [...EFFECTS];

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
  if (state.choices) {
    const choices = choiceValues(state);
    if (key.kind === 'escape' || key.kind === 'interrupt') { state.choices = undefined; return; }
    if (key.kind === 'up' || key.kind === 'down') state.choices.selected = (state.choices.selected + (key.kind === 'up' ? -1 : 1) + choices.length) % choices.length;
    if (key.kind !== 'enter') return;
    const {kind, selected} = state.choices;
    state.choices = undefined;
    if (kind === 'preset') { state.preset = selected; state.draft = structuredClone([...WELCOME_PRESETS, ...state.presets][selected]!.model); return 'asset'; }
    if (kind === 'layout') state.draft.layout = LAYOUTS[selected]!;
    else if (kind === 'effect') state.draft.effect = EFFECTS[selected]!;
    else state.draft.logo = LOGOS[selected]!;
    state.draft.customized = true;
    return kind === 'logo' ? 'asset' : undefined;
  }
  if (key.kind === 'escape' || key.kind === 'interrupt') return 'close';
  const tab = tabCycleDelta(key);
  if (tab) { state.selected = SECTIONS[(sectionOf(state.selected) + tab + SECTIONS.length) % SECTIONS.length]!.fields[0]!; return; }
  if (key.kind === 'up' || key.kind === 'down') { state.selected = FIELD_ORDER[(FIELD_ORDER.indexOf(state.selected) + (key.kind === 'up' ? -1 : 1) + FIELD_ORDER.length) % FIELD_ORDER.length]!; return; }
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
      case 'g': {
        const kind = state.selected === 1 ? 'logo' : state.selected === 5 ? 'layout' : state.selected === 12 ? 'effect' : state.selected === 24 ? 'preset' : undefined;
        if (kind) state.choices = {kind, selected: kind === 'preset' ? state.preset : kind === 'logo' ? LOGOS.indexOf(state.draft.logo) : kind === 'layout' ? LAYOUTS.indexOf(state.draft.layout) : EFFECTS.indexOf(state.draft.effect)};
        return;
      }
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
/** Field-specific guidance belongs beside the editor, never in startup's composition. */
function fieldHelp(s: WelcomeEditor): string {
  if (s.selected >= 14 && s.selected <= 23) return ['hostname', 'user', 'path', 'git'].includes(FACTS[s.selected - 14]!)
    ? 'Private fact · opt in to show it at startup. Enter toggles this module.' : 'A typed fact from NMSh; no shell command is run. Enter toggles this module.';
  return ({0: 'Choose the startup provider. External providers retain their own layout.',
    1: 'G opens the logo library. Images use the shared graphics service with a portable fallback.',
    2: 'Enter types a local asset path. O opens the file browser. Originals are never changed.',
    3: 'Fit the original image into its allocated area.', 4: 'Choose how transparent image pixels are presented.',
    5: 'G opens layout choices. The preview shows the current draft.',
    6: 'Edit the title; Enter applies to the draft, S saves for the next startup.',
    7: 'Write a greeting for your next session.', 8: 'Compact keeps the welcome small; expanded gives it space.',
    9: 'A text frame around the welcome card.', 10: 'Follow the theme or choose a welcome palette.',
    11: 'Enter six RGB digits for the custom palette.', 12: 'G opens animation choices. Space pauses; R replays. M tests a still frame.',
    13: 'Space-separated links shown in the welcome card.',
    24: 'G browses built-in and saved presets. Applying changes only the draft; S saves.',
    25: 'Name this draft as a reusable local preset (up to 12).', 26: 'Keep another copy under a new name.',
    27: 'Enter resets the draft to built-in defaults. S saves; Esc leaves saved settings unchanged.',
    28: 'Import a local JSON preset into the draft. Unknown fields are refused; no code is run.',
    29: 'Export JSON to a new file. Existing files are never overwritten. Asset bytes are never included.',
    30: 'Private asset paths are omitted by default. Include one only for your own use.'} as Record<number, string>)[s.selected] ?? '';
}

export function renderWelcomeEditor(s: WelcomeEditor, columns: number, height: number, facts: WelcomeFacts, caps: WelcomeCapabilities, now: number,
  paint?: (frame: WelcomeComposition) => string[]): string[] {
  s.preview = undefined; s.previewTop = undefined; s.previewLeft = undefined;
  const v = values(s);
  const section = sectionOf(s.selected);
  const gallery = s.choices;
  const picker = s.picker;
  let entries: StudioEntry[];
  let selected: number;
  let title = 'Welcome Studio';
  let subtitle = 'Unsaved draft · S saves for next startup or /clear';
  if (picker) {
    title += ' › Open asset'; subtitle = welcomeText(picker.directory);
    entries = picker.entries.map(e => ({group: 'Local files · PNG / JPEG / WebP / GIF / APNG / ANSI / text', label: welcomeText(e.name), render: () => `${e.directory ? 'Folder  ' : 'Image   '}${welcomeText(e.name)}`}));
    if (!entries.length) entries = [{group: 'Local files', label: 'No supported assets in this folder', render: () => 'No supported assets in this folder'}];
    selected = picker.entries.length ? picker.selected : -1;
  } else if (gallery) {
    title += ` › Choose ${gallery.kind}`;
    subtitle = 'Enter applies to draft · Esc keeps current values';
    const presets = [...WELCOME_PRESETS, ...s.presets];
    entries = choiceValues(s).map((label, i) => ({group: gallery.kind === 'preset' ? i < WELCOME_PRESETS.length ? 'Built-in layouts' : 'Your saved layouts' : 'Choices', label,
      value: gallery.kind === 'preset' ? `${presets[i]!.model.logo} · ${presets[i]!.model.layout}` : undefined}));
    selected = gallery.selected;
  } else if (s.input) {
    title += ` › ${s.input.kind === 'preset' ? 'Name preset' : s.input.kind === 'import' || s.input.kind === 'export' ? `${s.input.kind} JSON` : FIELDS[s.selected]}`;
    subtitle = 'Editing draft · Enter applies · Esc restores field';
    const input = s.input;
    entries = [{group: input.kind === 'export' ? `New file · ${s.includePath ? 'includes private path' : 'private path omitted'} · no asset bytes` : 'Text entry', label: input.kind,
      render: width => `${studioWrap(input.value, Math.max(1, width - 1)).at(-1) ?? ''}_`}];
    selected = 0;
  } else {
    entries = FIELD_ORDER.map(index => ({group: SECTIONS[sectionOf(index)]!.label, label: FIELDS[index]!,
      value: (index >= 14 && index <= 23 || index === 9) ? renderValueControl('bool', v[index]!) : v[index]}));
    selected = FIELD_ORDER.indexOf(s.selected);
  }
  const core = s.input ? [['Enter', ['export', 'import'].includes(s.input.kind) ? s.input.kind : 'apply'], ['Esc', 'cancel']] as const
    : picker || gallery ? [['↑↓', 'select'], ['Enter', picker ? 'open' : 'apply'], ['Esc', 'back']] as const
    : [['↑↓', 'select'], ['Tab', 'section'], ['←→', 'change'], ['Enter', 'edit'], ['S', 'save'], ['P', 'full preview'],
      ...(s.selected === 2 ? [['O', 'browse']] as const : [1, 5, 12, 24].includes(s.selected) ? [['G', 'choose']] as const : []), ['Esc', 'back']] as const;
  const controls: Array<readonly [string, string]> = [...core];
  if (!s.input && !picker && !gallery && height >= 30) controls.splice(controls.length - 1, 0, ['Space', 'pause'], ['R', 'replay'], ['W', 'width'], ['C', 'density'], ['T', 'theme'], ['M', 'still'], ['B', 'before']);
  let origin = {x: 0, y: 0};
  const rows = renderStudioLayout({title, subtitle, entries, selected, controls,
    ...(!s.input && !picker && !gallery ? {tabs: {labels: SECTIONS.map(section => section.label), selected: section}} : {}),
    notice: s.message ?? caps.asset?.reason,
    detailOrigin: (x, y) => { origin = {x, y}; },
    details: (width, room) => {
      if (picker) return [studioLabel('Asset browser'), ...studioWrap(picker.entries[picker.selected]?.path ?? picker.directory, width).map(studioMuted), '', ...studioWrap('Enter opens a folder or selects an image. Only local supported assets are listed; originals stay unchanged.', width).map(studioMuted)];
      if (s.input) return [studioLabel(s.input.kind === 'export' ? 'Export review' : s.input.kind === 'import' ? 'Import a layout' : 'Field editor'),
        ...studioWrap(s.input.kind === 'export' ? `Enter creates a new JSON file. ${s.includePath ? 'Includes private asset path.' : 'Private path omitted.'} No image bytes are exported.` : s.input.kind === 'import' ? 'Enter reads a bounded local JSON file into the draft. S saves imported settings.' : fieldHelp(s), width).map(studioMuted)];
      let model = s.before ? s.original : s.draft;
      if (gallery) {
        model = structuredClone(s.draft);
        if (gallery.kind === 'preset') model = [...WELCOME_PRESETS, ...s.presets][gallery.selected]!.model;
        else if (gallery.kind === 'layout') model.layout = LAYOUTS[gallery.selected]!;
        else if (gallery.kind === 'logo') model.logo = LOGOS[gallery.selected]!;
        else model.effect = EFFECTS[gallery.selected]!;
      }
      const label = `Live preview · ${s.before ? 'before' : 'draft'} · ${s.paused ? 'paused' : now - s.started >= 5000 ? 'settled' : 'playing'}${s.reduced ? ' · still' : ''}`;
      const result = [studioLabel(label)];
      const frame = composeWelcome(model, facts, {columns: s.narrow ? Math.min(40, width) : width, rows: Math.max(0, room - 1)},
        {...caps, ...(gallery && model.assetPath !== s.draft.assetPath ? {asset: undefined} : {}), reducedMotion: caps.reducedMotion || s.reduced, ...(s.theme ? {accent: {red: 90, green: 180, blue: 210}, chroma: {red: 230, green: 150, blue: 70}} : {})}, s.paused ? s.elapsed : now - s.started);
      s.preview = frame; s.previewTop = origin.y + 1; s.previewLeft = origin.x;
      const preview = s.provider === 'none' ? ['No startup welcome.'] : s.provider !== 'vespyr'
        ? s.captured?.map(row => caps.color ? row : row.replace(/\x1b\[[0-9;]*m/gu, '')) ?? ['External provider preview loading…']
        : paint?.(frame) ?? frame.rows.map(row => row.ansi);
      result.push(...preview.slice(0, Math.max(0, room - 1)));
      if (room - result.length >= 3) result.push('', ...studioWrap(fieldHelp(s), width).map(studioMuted));
      if (room - result.length >= 3) result.push(...renderControlRows([['P', 'startup preview · any key returns'], ['Space', 'pause'], ['R', 'replay'], ['W', 'width'], ['T', 'theme'], ['M', 'still'], ['B', 'before']], width));
      return result;
    },
  }, columns, height);
  return rows;
}
