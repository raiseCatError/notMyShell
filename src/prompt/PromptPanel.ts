import {moduleDefinition} from '../context/modules.js';
import {handleModulesManagerKey, modulesItemCount, modulesManagerControls, renderModulesManager, type ModulesManagerState} from './ModulesPanel.js';
import {railNeedsPromptConversion} from './railLayout.js';
import {chromaPreviewNote} from '../appearance/chromaNotes.js';
import {gradientEditorControls, gradientEditorKey, renderGradientEditorRows, type GradientEditorState} from '../ui/GradientEditor.js';
export {parseStopInput, type GradientEditorState} from '../ui/GradientEditor.js';
import {DIVIDER_LINES_HELP, dividerLinesLabel, SEMANTIC_MODES, SEMANTIC_MODE_LABELS, TREATMENT_DIRECTION_LABELS} from '../chroma/treatment.js';
import {getCurrentGlyphMode} from '../ui/glyphs.js';
import {PROMPT_SYMBOL_IDS, promptSymbolGlyph, promptSymbolLabel, separatorLabel, validateGlyph} from './glyphChoices.js';
import {CATPPUCCIN_ACCENTS, CATPPUCCIN_ACCENT_LABELS, THEME_FAMILIES} from '../appearance/themeFamilies.js';
import {FAMILY_IDS, familyOf, selectFamily, variantLabel, variantOptions} from '../appearance/themeSelection.js';
import {
  applyNativeGapChoice,
  CONNECTOR_FADE_STYLES,
  GIT_COLOR_MODES,
  GIT_CONNECTOR_FADES,
  GIT_GEOMETRIES,
  type GitConnectorFade,
  type GitGeometry,
  NATIVE_PALETTE_IDS,
  type ConnectorFadeStyle,
  type GitColorMode,
  nativeGapChoice,
  type NativeGapChoice,
  type PromptConfiguration, type ContextRailSettings, DEFAULT_CONTEXT_RAIL,
  type NativePaletteId,
  type PromptProviderId,
  modulePlacement, applyModulePlacement,
  MODULE_SURFACES, MODULE_SURFACE_LABELS, THEME_PALETTE_IDS,
  ON_COMMAND_MODULES,
} from './configuration.js';
import {NATIVE_PROMPT_THEMES, RICH_GIT_SHOWCASE} from './prompt.js';
import {fadeColorChoices, POWERLINE_EDGE_STYLES, POWERLINE_SHAPES, PROMPT_STYLES, PROMPT_STYLE_LABELS, type ConnectorFadeColors, type PowerlineEdgeStyle, type PowerlineShape} from './powerline.js';
import {PROMPT_STYLE_NOTES, STYLE_OPTION_LABELS, STYLE_PROFILE_OPTIONS, type ProfiledStyle} from './styles.js';
import {VIBRANCE_LABELS, VIBRANCE_LEVELS, parseHexColor} from '../chroma/color.js';
import {
  MAX_CUSTOM_STOPS, MIN_CUSTOM_STOPS, motionHasDirection, PRESET_STOPS, TREATMENT_CURVE_LABELS, TREATMENT_CURVES, TREATMENT_DIRECTIONS,
  TREATMENT_GEOMETRIES, TREATMENT_GEOMETRY_LABELS, TREATMENT_INFLUENCES, TREATMENT_MOTION_LABELS, TREATMENT_MOTIONS, TREATMENT_PRESET_LABELS,
  TREATMENT_PRESETS, TREATMENT_SCOPE_LABELS, TREATMENT_SCOPES, TREATMENT_SPEED_LABELS, TREATMENT_SPEEDS, treatmentInfluence, treatmentSwatch,
} from '../chroma/treatment.js';
import {isReducedMotion} from '../presentation/environment.js';
import {colorEscape} from '../chroma/escape.js';
import {renderControlRows} from '../ui/controls.js';
import {cycleTab, renderTabStrip, tabCycleDelta} from '../ui/PanelShell.js';
import type {StarshipStatus} from './starship.js';
import {STARSHIP_MODULES, type StarshipConfigProposal} from './StarshipConfigAdapter.js';
import type {Powerlevel10kStatus} from './powerlevel10k.js';
import {powerlevel10kZshrcPath, type ConfiguratorPreparation} from './Powerlevel10kConfigurator.js';
import type {Key} from '../terminal/keys.js';
import {focusForeground, foreground, UI_COLORS, type RgbColor, lazyForeground} from '../ui/palette.js';
import {displayWidth, labelColumnWidth, padCells, stripAnsi, truncateAnsi} from '../util/text.js';
import {renderTaskProgress, type TaskProgress} from '../status/TaskProgress.js';
import {providerRowText, type ProviderDescriptor} from '../providers/providers.js';

export type PromptPanelStep = 'railInsideConfirm' | 'provider' | 'starship' | 'starshipModules' | 'starshipConfirm' | 'powerlevel10k' | 'p10kConfirm' | 'p10kReady' | 'p10kResult' | 'layout' | 'appearance' | 'modules' | 'gradient' | 'installConfirm' | 'installProgress' | 'installResult' | 'installDetails';

export interface PromptPanelState extends ModulesManagerState {
  onboarding: boolean;
  step: PromptPanelStep;
  selectedIndex: number;
  draft: PromptConfiguration;
  /** The configuration currently in effect; the draft is only a preview until saved. */
  saved?: PromptConfiguration;
  starshipStatus?: StarshipStatus;
  p10kStatus?: Powerlevel10kStatus;
  p10kPreparation?: ConfiguratorPreparation;
  p10kResult?: string[];
  message?: string;
  railConfirmReturn?: {step: PromptPanelStep; selectedIndex: number};
  task?: TaskProgress;
  starshipModules?: boolean[];
  starshipProposal?: StarshipConfigProposal;
  /** The palette the Chroma quick control turned Off, restored when it turns Chroma back On (panel-local, never saved). */
  chromaRestore?: PromptConfiguration['presentation']['preset'];
  /** NMSh appearance top view: Main Prompt (default) or Rich Git. */
  view?: PromptView;
  /** `tabs`: ←/→ switch views; `rows` (default): ←/→ edit the selected row. */
  focus?: 'tabs' | 'rows';
  gradient?: GradientEditorState;
  /** Typing a custom glyph: the row being edited, the typed text, and a factual validation note. */
  glyphEdit?: {rowId: string; buffer: string; note?: string};
}

export type PromptView = 'main' | 'git' | 'chroma' | 'rail';
export const PROMPT_VIEWS = ['Main Prompt', 'Rich Git', 'Chroma', 'Context Rail'] as const;
const PROMPT_VIEW_IDS: readonly PromptView[] = ['main', 'git', 'chroma', 'rail'];

const PRIMARY = lazyForeground(UI_COLORS.primary);
const SECONDARY = lazyForeground(UI_COLORS.secondary);
const ACCENT = lazyForeground(UI_COLORS.accent);
const BOLD = '\u001B[1m';
const SUBTLE = lazyForeground(UI_COLORS.subtle);
const ERROR = lazyForeground(UI_COLORS.failure);
const INVERSE = '\u001B[7m';
const RESET = '\u001B[0m';
const GAP_CHOICES: readonly NativeGapChoice[] = ['off', 'compact', 'normal', 'wide'];
/** Prompt providers on the shared provider descriptor (#134). */
export const PROMPT_PROVIDERS: readonly ProviderDescriptor<PromptProviderId>[] = [
  {id: 'nmsh', family: 'prompt', label: 'NMSh Native', kind: 'native', description: 'built-in themes, geometry, and modules'},
  {id: 'starship', family: 'prompt', label: 'Starship', kind: 'external', executable: 'starship', description: 'use its themes/configuration'},
  {id: 'powerlevel10k', family: 'prompt', label: 'Powerlevel10k', kind: 'external', description: 'use your ~/.p10k.zsh left prompt'},
  {id: 'ohMyPosh', family: 'prompt', label: 'Oh My Posh', kind: 'external', executable: 'oh-my-posh', description: 'render with oh-my-posh; no shell rc change'},
  {id: 'none', family: 'prompt', label: 'None', kind: 'none', description: 'composer only: no prompt row or modules; the input marker stays'},
];
export const PROVIDER_ORDER: readonly PromptProviderId[] = PROMPT_PROVIDERS.map(provider => provider.id);

export function providerLabel(provider: PromptProviderId): string {
  return PROMPT_PROVIDERS.find(descriptor => descriptor.id === provider)?.label ?? provider;
}

/**
 * One editable appearance row. Rows are derived from the draft, so a style
 * shows only controls that change it and a hidden row can never be edited.
 */
export interface AppearanceRow {
  id: string;
  label: string;
  value(configuration: PromptConfiguration): string;
  /** ←/→; undefined for rows opened with Enter. */
  change?(configuration: PromptConfiguration, delta: number): void;
  note?(configuration: PromptConfiguration): string | undefined;
  /** Enter opens a sub-editor instead of saving. */
  opens?: 'modules' | 'gradient';
  /** Enter starts typing a one-glyph value (custom separator or prompt symbol). */
  edit?: {get(configuration: PromptConfiguration): string | undefined; set(configuration: PromptConfiguration, glyph: string): void};
}

const cycleKey = <T>(values: readonly T[], current: T, delta: number): T => cycle(values, current, delta);
const optionLabel = (value: string | number) => typeof value === 'number' ? String(value) : STYLE_OPTION_LABELS[value] ?? value;

/** Rows for one style profile field, cycling only that style's valid options. */
function profileRow<S extends ProfiledStyle, K extends keyof typeof STYLE_PROFILE_OPTIONS[S] & string>(style: S, key: K, label: string,
  format: (value: string | number) => string = optionLabel): AppearanceRow {
  return {
    id: `${style}.${key}`, label,
    value: configuration => format((configuration.nmsh.styleProfiles[style] as unknown as Record<string, string | number>)[key]!),
    change: (configuration, delta) => {
      const profile = configuration.nmsh.styleProfiles[style] as unknown as Record<string, string | number>;
      const options = (STYLE_PROFILE_OPTIONS[style] as unknown as Record<string, readonly (string | number)[]>)[key]!;
      profile[key] = cycleKey(options, profile[key]!, delta);
    },
  };
}

const cells = (value: string | number) => `${value} ${value === 1 ? 'cell' : 'cells'}`;

const POWERLINE_ROWS: readonly AppearanceRow[] = [
  {id: 'start', label: 'Start', value: c => edgeStyleLabel(c.nmsh.startStyle), change: (c, d) => { c.nmsh.startStyle = cycle(POWERLINE_EDGE_STYLES, c.nmsh.startStyle, d); }},
  {id: 'connector', label: 'Connector', value: c => SHAPE_LABELS[c.nmsh.connector], change: (c, d) => { c.nmsh.connector = cycle(POWERLINE_SHAPES, c.nmsh.connector, d); }},
  {id: 'connectorFade', label: 'Connector fade', value: c => connectorFadeLabel(c.nmsh.connectorFade),
    change: (c, d) => { c.nmsh.connectorFade = cycle(CONNECTOR_FADE_STYLES, c.nmsh.connectorFade, d); }},
  {id: 'fadeColors', label: 'Fade colors', value: c => fadeColorsLabel(c.nmsh.connectorFadeColors),
    change: (c, d) => { c.nmsh.connectorFadeColors = cycle(fadeColorChoices(c.nmsh.gapEnabled, c.gap), c.nmsh.connectorFadeColors, d); }},
  {id: 'gap', label: 'Gap', value: c => gapLabel(nativeGapChoice(c)), change: (c, d) => applyNativeGapChoice(c, cycle(GAP_CHOICES, nativeGapChoice(c), d))},
  {id: 'end', label: 'End', value: c => edgeStyleLabel(c.nmsh.endStyle), change: (c, d) => { c.nmsh.endStyle = cycle(POWERLINE_EDGE_STYLES, c.nmsh.endStyle, d); }},
  {id: 'padding', label: 'Padding', value: c => cells(c.spacing), change: (c, d) => { c.spacing = cycle([0, 1, 2, 3], c.spacing, d); }},
];

/** The style-scoped custom separator glyph; switching styles keeps each style's own glyph. */
function customSeparatorRow(style: 'minimal' | 'breadcrumb' | 'outline'): AppearanceRow {
  return {id: `${style}.customSeparator`, label: '  Glyph', value: c => c.nmsh.styleProfiles[style].customSeparator ?? 'Enter to type one',
    note: () => 'one character, 1–2 cells',
    edit: {get: c => c.nmsh.styleProfiles[style].customSeparator, set: (c, glyph) => { c.nmsh.styleProfiles[style].customSeparator = glyph; }}};
}

const PROMPT_SYMBOL_ROW: AppearanceRow = {id: 'promptSymbol', label: 'Prompt symbol', value: c => promptSymbolLabel(c.promptSymbol, c.promptSymbolCustom),
  change: (c, d) => { c.promptSymbol = cycle(PROMPT_SYMBOL_IDS, c.promptSymbol, d); },
  note: c => getCurrentGlyphMode() === 'safe' && promptSymbolGlyph(c.promptSymbol, c.promptSymbolCustom, true) !== promptSymbolGlyph(c.promptSymbol, c.promptSymbolCustom, false)
    ? `Safe glyphs show ${promptSymbolGlyph(c.promptSymbol, c.promptSymbolCustom, false)}` : undefined};
const PROMPT_SYMBOL_GLYPH_ROW: AppearanceRow = {id: 'promptSymbolCustom', label: '  Glyph', value: c => c.promptSymbolCustom ?? 'Enter to type one',
  note: () => 'one character, 1–2 cells', edit: {get: c => c.promptSymbolCustom, set: (c, glyph) => { c.promptSymbolCustom = glyph; }}};

/** Theme family, then its variant and (Catppuccin) accent, indented under it. */
function themeRows(configuration: PromptConfiguration): AppearanceRow[] {
  const family = familyOf(configuration.nmsh.palette);
  const variants = variantOptions(family);
  return [
    {id: 'themeFamily', label: 'Theme family', value: c => THEME_FAMILIES.find(item => item.id === familyOf(c.nmsh.palette))!.label,
      change: (c, d) => {
        const next = selectFamily(c, cycle(FAMILY_IDS, familyOf(c.nmsh.palette), d));
        c.nmsh = next.nmsh;
        if (next.customTheme) c.customTheme = next.customTheme;
      }},
    ...(variants.length > 1 ? [{id: 'themeVariant', label: `  ${variantLabel(configuration)}`,
      value: (c: PromptConfiguration) => variantOptions(familyOf(c.nmsh.palette)).find(option => option.id === c.nmsh.palette)?.label ?? c.nmsh.palette,
      change: (c: PromptConfiguration, d: number) => { c.nmsh.palette = cycle(variantOptions(familyOf(c.nmsh.palette)).map(option => option.id), c.nmsh.palette, d); }}] : []),
    ...(family === 'catppuccin' ? [{id: 'themeAccent', label: '  Accent', value: (c: PromptConfiguration) => CATPPUCCIN_ACCENT_LABELS[c.nmsh.accent],
      change: (c: PromptConfiguration, d: number) => { c.nmsh.accent = cycle(CATPPUCCIN_ACCENTS, c.nmsh.accent, d); }}] : []),
    ...(family === 'custom' ? [{id: 'themeStudio', label: '  Edit colors', value: (c: PromptConfiguration) => `${c.customTheme?.name ?? 'Custom'} · /theme ›`,
      note: () => 'clone, edit, import and export in /theme'}] : []),
  ];
}

/** Gallery entries for the current family: NMSh themes, or the selected family's variants. */
export function galleryPalettes(configuration: PromptConfiguration): NativePaletteId[] {
  return variantOptions(familyOf(configuration.nmsh.palette)).map(option => option.id);
}

/** Each style's own controls, shown only when they can change that style. */
export function styleRows(configuration: PromptConfiguration): AppearanceRow[] {
  const profiles = configuration.nmsh.styleProfiles;
  switch (configuration.nmsh.style) {
    case 'powerline': return POWERLINE_ROWS.filter(row =>
      // A fade lives in a gap: with the gap Off neither the fade nor its colors can show.
      (row.id !== 'connectorFade' || configuration.nmsh.gapEnabled)
      && (row.id !== 'fadeColors' || (configuration.nmsh.gapEnabled && configuration.nmsh.connectorFade !== 'off')));
    case 'soft': return [profileRow('soft', 'cap', 'Caps'), profileRow('soft', 'layout', 'Layout'),
      ...(profiles.soft.layout === 'separated' ? [profileRow('soft', 'gap', 'Gap', cells)] : []),
      profileRow('soft', 'padding', 'Padding', cells), profileRow('soft', 'fill', 'Fill')];
    case 'minimal': return [profileRow('minimal', 'separator', 'Separator', value => separatorLabel(String(value), profiles.minimal.customSeparator)),
      ...(profiles.minimal.separator === 'custom' ? [customSeparatorRow('minimal')] : []),
      profileRow('minimal', 'spacing', 'Spacing', cells), profileRow('minimal', 'emphasis', 'Bold')];
    case 'outline': return [profileRow('outline', 'cap', 'Outline'), profileRow('outline', 'layout', 'Layout'),
      ...(profiles.outline.layout === 'separated' ? [profileRow('outline', 'gap', 'Gap', cells)] : [
        profileRow('outline', 'divider', '  Divider', value => separatorLabel(String(value), profiles.outline.customSeparator)),
        ...(profiles.outline.divider === 'custom' ? [customSeparatorRow('outline')] : [])]),
      profileRow('outline', 'padding', 'Padding', cells)];
    case 'breadcrumb': return [profileRow('breadcrumb', 'separator', 'Separator', value => separatorLabel(String(value), profiles.breadcrumb.customSeparator)),
      ...(profiles.breadcrumb.separator === 'custom' ? [customSeparatorRow('breadcrumb')] : []),
      profileRow('breadcrumb', 'anchor', 'Anchor'), profileRow('breadcrumb', 'spacing', 'Spacing', cells)];
    case 'compact': return [profileRow('compact', 'ends', 'Ends'), profileRow('compact', 'padding', 'Padding', cells),
      profileRow('compact', 'seams', 'Seams')];
    case 'ribbon': return [profileRow('ribbon', 'slant', 'Slant'), profileRow('ribbon', 'ends', 'Ends'),
      profileRow('ribbon', 'padding', 'Padding', cells), profileRow('ribbon', 'band', 'Band')];
  }
}

/** Main Prompt rows: theme, style and vibrance, the style's own controls, then icons and modules. */
export function appearanceRows(configuration: PromptConfiguration): AppearanceRow[] {
  // Prompt None keeps only the input marker (plus the theme, which still styles NMSh UI).
  if (configuration.provider === 'none') return [...themeRows(configuration), PROMPT_SYMBOL_ROW, ...(configuration.promptSymbol === 'custom' ? [PROMPT_SYMBOL_GLYPH_ROW] : [])];
  return [
    ...themeRows(configuration),
    {id: 'textColors', label: 'Text colors', value: c => c.nmsh.textColors === 'neutral' ? 'Neutral' : 'Theme',
      change: c => { c.nmsh.textColors = c.nmsh.textColors === 'neutral' ? 'theme' : 'neutral'; },
      note: c => c.nmsh.textColors === 'neutral' ? 'Neutral: the theme\'s fills, connectors and accent stay; text is a steady neutral' : 'Theme: the theme\'s own text colors'},
    {id: 'style', label: 'Style', value: c => PROMPT_STYLE_LABELS[c.nmsh.style], change: (c, d) => { c.nmsh.style = cycle(PROMPT_STYLES, c.nmsh.style, d); },
      note: c => PROMPT_STYLE_NOTES[c.nmsh.style]},
    {id: 'vibrance', label: 'Vibrance', value: c => VIBRANCE_LABELS[c.nmsh.vibrance], change: (c, d) => { c.nmsh.vibrance = cycle(VIBRANCE_LEVELS, c.nmsh.vibrance, d); }},
    ...styleRows(configuration),
    {id: 'icons', label: 'Icons', value: c => c.nmsh.icons === 'off' ? 'Off' : 'On', change: c => { c.nmsh.icons = c.nmsh.icons === 'off' ? 'nerd' : 'off'; }},
    PROMPT_SYMBOL_ROW,
    ...(configuration.promptSymbol === 'custom' ? [PROMPT_SYMBOL_GLYPH_ROW] : []),
    {id: 'modules', label: 'Modules', value: c => `${c.modules.filter(module => module.visible).length} of ${c.modules.length} shown ›`, opens: 'modules'},
  ];
}

export function appearanceModulesRow(configuration: PromptConfiguration): number {
  return appearanceRows(configuration).findIndex(row => row.id === 'modules');
}

/** Chroma rows; everything after Palette hides while Chroma is Off, and timing rows hide while static. */
export function chromaRows(configuration: PromptConfiguration): AppearanceRow[] {
  const p = configuration.presentation;
  const rows: AppearanceRow[] = [{id: 'preset', label: 'Palette', value: c => TREATMENT_PRESET_LABELS[c.presentation.preset],
    change: (c, d) => {
      c.presentation.preset = cycle(TREATMENT_PRESETS, c.presentation.preset, d);
      // Custom always has stops to edit: seed from the Lavender family.
      if (c.presentation.preset === 'custom' && c.presentation.customStops.length < MIN_CUSTOM_STOPS) c.presentation.customStops = [...PRESET_STOPS.lavender];
    },
    note: c => c.provider !== 'nmsh' ? 'external prompts keep their own colors' : undefined}];
  if (p.preset === 'off') return rows;
  if (p.preset === 'custom') rows.push({id: 'gradient', label: 'Custom gradient', value: c => `${c.presentation.customStops.length} stops ›`, opens: 'gradient'});
  rows.push(
    {id: 'influence', label: 'Influence', value: c => TREATMENT_INFLUENCES.find(entry => entry.id === treatmentInfluence(c.presentation))!.label,
      change: (c, d) => {
        const ids = TREATMENT_INFLUENCES.map(entry => entry.id);
        const next = cycle(ids, treatmentInfluence(c.presentation), d);
        c.presentation.intensity = TREATMENT_INFLUENCES.find(entry => entry.id === next)!.intensity;
        if (next === 'full') c.presentation.semantic = 'override';
      }},
    {id: 'semantic', label: '  Semantic colors', value: c => SEMANTIC_MODE_LABELS[c.presentation.semantic ?? 'preserve'],
      change: (c, d) => { c.presentation.semantic = cycle(SEMANTIC_MODES, c.presentation.semantic ?? 'preserve', d); },
      note: c => (c.presentation.semantic ?? 'preserve') === 'override' ? 'symbols and readable text keep success, failure and Git meaning' : 'success, failure and Git state keep their colors'},
    {id: 'scope', label: 'Applies to', value: c => TREATMENT_SCOPE_LABELS[c.presentation.scope ?? 'prompt'],
      change: (c, d) => { c.presentation.scope = cycle(TREATMENT_SCOPES, c.presentation.scope ?? 'prompt', d); }},
    {id: 'rules', label: 'Divider lines', value: c => dividerLinesLabel(c.presentation.rules !== false),
      change: c => { c.presentation.rules = c.presentation.rules === false; }, note: () => DIVIDER_LINES_HELP},
    {id: 'geometry', label: 'Gradient layout', value: c => TREATMENT_GEOMETRY_LABELS[c.presentation.geometry],
      change: (c, d) => { c.presentation.geometry = cycle(TREATMENT_GEOMETRIES, c.presentation.geometry, d); }},
    {id: 'motion', label: 'Motion', value: c => TREATMENT_MOTION_LABELS[c.presentation.motion],
      change: (c, d) => { c.presentation.motion = cycle(TREATMENT_MOTIONS, c.presentation.motion, d); },
      note: c => c.presentation.motion !== 'static' && (c.presentation.reducedMotion || c.presentation.effectsOff || isReducedMotion())
        ? 'held still: Reduced Motion / Decorative effects Off' : undefined},
  );
  if (p.motion !== 'static') {
    rows.push(
      {id: 'speed', label: 'Speed', value: c => TREATMENT_SPEED_LABELS[c.presentation.speed ?? 'normal'],
        change: (c, d) => { c.presentation.speed = cycle(TREATMENT_SPEEDS, c.presentation.speed ?? 'normal', d); }},
      {id: 'curve', label: 'Ramp', value: c => TREATMENT_CURVE_LABELS[c.presentation.curve ?? 'linear'],
        change: (c, d) => { c.presentation.curve = cycle(TREATMENT_CURVES, c.presentation.curve ?? 'linear', d); }},
    );
    if (motionHasDirection(p.motion)) rows.push({id: 'direction', label: 'Motion direction', value: c => TREATMENT_DIRECTION_LABELS[c.presentation.direction ?? 'forward'],
      change: (c, d) => { c.presentation.direction = cycle(TREATMENT_DIRECTIONS, c.presentation.direction ?? 'forward', d); }});
  }
  // Only meaningful when some module actually has explicit colors.
  if (configuration.modules.some(module => module.foreground || module.background)) {
    rows.push({id: 'customColors', label: 'Custom module colors', value: c => c.presentation.customColors ? 'Chroma too' : 'Kept as set',
      change: c => { c.presentation.customColors = !c.presentation.customColors; }});
  }
  return rows;
}

/** Deliberately bounded Rail controls over the existing theme library and style painter. */
type RailChoice = 'relation' | 'direction' | 'integration' | 'spacing' | 'dividerAnchor';
function railChoice<K extends RailChoice>(id: string, label: string, field: K,
  choices: readonly (readonly [NonNullable<ContextRailSettings[K]>, string])[]): AppearanceRow {
  return {id, label,
    value: c => choices.find(([value]) => value === (c.contextRail[field] ?? DEFAULT_CONTEXT_RAIL[field]))?.[1] ?? choices[0]![1],
    change: (c, d) => {
      const values = choices.map(([value]) => value);
      c.contextRail[field] = cycle(values, c.contextRail[field] ?? DEFAULT_CONTEXT_RAIL[field]!, d);
    }};
}

export function contextRailRows(configuration: PromptConfiguration): AppearanceRow[] {
  const rows: AppearanceRow[] = [
    {id: 'railMode', label: 'Mode', value: c => ({auto: 'Auto', always: 'Always', off: 'Off'})[c.contextRail.mode],
      change: (c, d) => { c.contextRail.mode = cycle(['auto', 'always', 'off'], c.contextRail.mode, d); }},
    {id: 'railRows', label: 'Rows', value: c => String(c.contextRail.rows), change: c => { c.contextRail.rows = c.contextRail.rows === 1 ? 2 : 1; }},
    railChoice('railRelation', 'Relation', 'relation', [['vertical','Vertical'],['right','Right of Prompt']]),
    railChoice('railDirection', 'Direction', 'direction', [['followMain','Follow Main'],['forward','Forward'],['mirrored','Mirrored']]),
    {...railChoice('railIntegration', 'Integration', 'integration', [['auto','Auto'],['outside','Outside'],['inside','Inside']]),
      note: c => railNeedsPromptConversion(c) ? 'Requires Main Prompt: Inside; confirm on save' : 'horizontal dividers only'},
    railChoice('railSpacing', 'Spacing', 'spacing', [['attached','Attached'],['gap','Gap'],['spacious','Spacious']]),
    {...railChoice('railAnchor', 'Divider Anchor', 'dividerAnchor', [['prompt','Prompt Level'],['rail','Rail Level'],['above','Above Group']]),
      note: c => !c.composerDividers ? 'no dividers: effective Prompt Level'
        : c.contextRail.integration === 'outside' ? 'used with Inside integration'
        : c.composerPosition === 'top' && c.contextRail.relation !== 'right' ? 'horizontal outer boundary faces below the Top group' : 'independent of spacing'},
    {id: 'railTheme', label: 'Theme', value: c => c.contextRail.theme === 'followMain' ? 'Follow Main' : 'Choose theme',
      change: c => { c.contextRail.theme = c.contextRail.theme === 'followMain' ? 'choose' : 'followMain'; c.contextRail.palette ??= c.nmsh.palette; c.contextRail.themeId ??= c.nmsh.themeId; }},
  ];
  if (configuration.contextRail.theme === 'choose') {
    const choices = [...THEME_PALETTE_IDS.filter(id => id !== 'custom').map(palette => ({palette, themeId: undefined as string | undefined, label: NATIVE_PROMPT_THEMES[palette].label})),
      ...configuration.themes.map(asset => ({palette: 'custom' as const, themeId: asset.id, label: asset.theme.name}))];
    rows.push({id: 'railPalette', label: '  Chosen theme',
      value: c => choices.find(choice => choice.palette === c.contextRail.palette && (choice.palette !== 'custom' || choice.themeId === c.contextRail.themeId))?.label ?? 'Lavender Native',
      change: (c, d) => {
        const current = choices.findIndex(choice => choice.palette === c.contextRail.palette && (choice.palette !== 'custom' || choice.themeId === c.contextRail.themeId));
        const next = choices[(Math.max(0, current) + d + choices.length) % choices.length]!;
        c.contextRail.palette = next.palette;
        if (next.themeId) c.contextRail.themeId = next.themeId; else delete c.contextRail.themeId;
      }});
  }
  rows.push({id: 'railStyle', label: 'Style', value: c => c.contextRail.style === 'followMain' ? 'Follow Main' : PROMPT_STYLE_LABELS[c.contextRail.style],
    change: (c, d) => { c.contextRail.style = cycle(['followMain', 'soft', 'minimal', 'compact'], c.contextRail.style, d); }},
  {id: 'railOverflow', label: 'Overflow', value: () => 'Priority', note: () => 'compact, then drop lower-priority context'});
  if (configuration.provider !== 'nmsh') rows[0]!.note = () => 'available with NMSh Native; settings are retained';
  return rows;
}

function viewRows(state: PromptPanelState): AppearanceRow[] {
  return state.view === 'rail' ? contextRailRows(state.draft) : state.view === 'chroma' ? chromaRows(state.draft) : appearanceRows(state.draft);
}

/** Rich Git's own settings; each edits inline with ←/→ (Space also toggles Enabled). */
const RICH_GIT_ROWS = ['gitEnabled', 'gitColors', 'gitGeometry', 'gitConnectorFade'] as const;

/** Enter on the Main Prompt Modules row opens the module manager. */
export function onModulesRow(state: PromptPanelState): boolean {
  return state.step === 'appearance' && (state.view ?? 'main') === 'main' && state.focus !== 'tabs'
    && appearanceRows(state.draft)[state.selectedIndex]?.opens === 'modules';
}

/** Enter on the Chroma Custom gradient row opens the stop editor. */
export function onGradientRow(state: PromptPanelState): boolean {
  return state.step === 'appearance' && state.view === 'chroma' && state.focus !== 'tabs'
    && chromaRows(state.draft)[state.selectedIndex]?.opens === 'gradient';
}

export function openGradientEditor(state: PromptPanelState): void {
  state.gradient = {stops: [...state.draft.presentation.customStops], index: 0};
  state.step = 'gradient';
  state.selectedIndex = 0;
}

/** Leave the stop editor, keeping valid stops in the draft (still unsaved until Enter in the panel). */
export function closeGradientEditor(state: PromptPanelState): void {
  const gradient = state.gradient;
  if (gradient && gradient.stops.length >= MIN_CUSTOM_STOPS) {
    state.draft.presentation.customStops = [...gradient.stops];
    state.draft.presentation.preset = 'custom';
  }
  state.gradient = undefined;
  state.step = 'appearance';
  state.view = 'chroma';
  state.selectedIndex = Math.max(0, chromaRows(state.draft).findIndex(row => row.opens === 'gradient'));
}

/** The shared stop editor; R resets to the saved Custom stops (or Lavender). */
export function handleGradientKey(key: Key, state: PromptPanelState): boolean {
  const gradient = state.gradient;
  if (!gradient) return false;
  return gradientEditorKey(gradient, key, () => state.saved?.presentation.customStops.length ? state.saved.presentation.customStops : PRESET_STOPS.lavender);
}

export function connectorFadeLabel(value: ConnectorFadeStyle): string {
  return value === 'follow' ? 'Follow connector' : value === 'off' ? 'Off' : SHAPE_LABELS[value];
}

export function fadeColorsLabel(value: ConnectorFadeColors): string {
  return value === 'previous' ? 'Previous' : value === 'next' ? 'Next' : 'Mixed';
}

export function gitGeometryLabel(value: GitGeometry): string {
  return value === 'follow' ? 'Follow main prompt' : SHAPE_LABELS[value];
}

export function gitConnectorFadeLabel(value: GitConnectorFade): string {
  return value === 'followMain' ? 'Follow main prompt' : value === 'followGeometry' ? 'Follow Rich Git geometry'
    : value === 'off' ? 'Off' : SHAPE_LABELS[value];
}

export function gitColorsLabel(value: GitColorMode): string {
  return value === 'semantic' ? 'Semantic' : value === 'followTheme' ? 'Follow theme' : 'Grayscale';
}

const SHAPE_LABELS: Record<PowerlineShape, string> = {
  wedge: 'Wedge', flat: 'Flat', rounded: 'Rounded', slash: 'Slant /', backslash: 'Slant \\',
};

export function edgeStyleLabel(value: PowerlineEdgeStyle): string {
  switch (value) {
    case 'fadeWedge': return 'Fading wedge';
    case 'fadeFlat': return 'Fading flat';
    case 'fadeRounded': return 'Fading rounded';
    case 'fadeSlash': return 'Fading slant';
    default: return SHAPE_LABELS[value];
  }
}

/** Catalog label; a module whose pack is not installed keeps its row (and settings) and says so. */
export function moduleLabel(id: PromptConfiguration['modules'][number]['id']): string {
  return moduleDefinition(id)?.label ?? `${id.slice(0, 40)} (missing pack)`;
}

function cycle<T>(values: readonly T[], current: T, delta: number): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + delta + values.length) % values.length]!;
}

function gapLabel(value: NativeGapChoice): string {
  return value === 'off' ? 'Off · connected' : value === 'compact' ? 'Compact' : value === 'normal' ? 'Normal' : 'Wide';
}

/**
 * Layout choices write the existing `composerLayout` and `placement` keys.
 * `placement` only matters in two-line mode: `header` draws the prompt row as
 * the composer's divider, `composer` adds a border and places it inside.
 * One-line leaves the stored placement untouched.
 */
export const LAYOUT_CHOICES = [
  {label: 'Two-line · prompt row is the divider', summary: 'two-line divider', composerLayout: 'twoLine', placement: 'header'},
  {label: 'Two-line · prompt inside bordered composer', summary: 'two-line inside', composerLayout: 'twoLine', placement: 'composer'},
  {label: 'One-line · prompt inline with input', summary: 'one-line', composerLayout: 'oneLine', placement: undefined},
] as const;

export function layoutChoiceIndex(configuration: PromptConfiguration): number {
  if (configuration.composerLayout === 'oneLine') return 2;
  return configuration.placement === 'composer' ? 1 : 0;
}

export function applyLayoutChoice(configuration: PromptConfiguration, index: number): void {
  const choice = LAYOUT_CHOICES[Math.max(0, Math.min(LAYOUT_CHOICES.length - 1, index))]!;
  configuration.composerLayout = choice.composerLayout;
  if (choice.placement) configuration.placement = choice.placement;
}

export function layoutLabel(configuration: PromptConfiguration): string {
  return LAYOUT_CHOICES[layoutChoiceIndex(configuration)]!.summary;
}

/** One-line summary of an effective configuration. */
export function describePromptConfiguration(configuration: PromptConfiguration): string {
  if (configuration.provider === 'none') return 'None · composer only';
  if (configuration.provider !== 'nmsh') return `${providerLabel(configuration.provider)} · ${layoutLabel(configuration)}`;
  const nmsh = configuration.nmsh;
  // Powerline geometry describes only Powerline; other styles name their own look.
  const geometry = nmsh.style === 'powerline' ? [
    `${edgeStyleLabel(nmsh.startStyle).toLowerCase()} start`,
    `${SHAPE_LABELS[nmsh.connector].toLowerCase()} joins`,
    `gap ${nativeGapChoice(configuration)}`,
    `${edgeStyleLabel(nmsh.endStyle).toLowerCase()} end`,
  ] : [`${PROMPT_STYLE_LABELS[nmsh.style].toLowerCase()} style`];
  return [
    NATIVE_PROMPT_THEMES[nmsh.palette].label,
    layoutLabel(configuration),
    ...geometry,
    `icons ${nmsh.icons === 'off' ? 'off' : 'on'}`,
    ...(nmsh.vibrance !== 'standard' ? [`${VIBRANCE_LABELS[nmsh.vibrance].toLowerCase()} vibrance`] : []),
    ...(configuration.presentation.preset !== 'off' ? [`${TREATMENT_PRESET_LABELS[configuration.presentation.preset]} Chroma`] : []),
  ].join(' · ');
}

export function promptDraftChanged(state: PromptPanelState): boolean {
  if (!state.saved) return false;
  const comparable = (configuration: PromptConfiguration) => JSON.stringify({...configuration, onboardingComplete: undefined});
  return comparable(state.draft) !== comparable(state.saved);
}

export function promptPanelControls(state: PromptPanelState): Array<[string, string]> {
  if (state.step === 'railInsideConfirm') return [['↑↓', 'move'], ['Enter', 'choose'], ['Esc', 'keep current']];
  if (state.step === 'installProgress') return [['Please wait', 'installation in progress']];
  if (state.step === 'installResult') return [['Enter', state.task?.state.status === 'failed' ? 'details' : 'continue'], ['D', 'details'], ['Esc', 'back']];
  if (state.step === 'installDetails') return [['Enter/Esc', 'back']];
  if (state.step === 'starshipModules') return [['↑↓', 'move'], ['Enter', 'edit'], ['Esc', 'back']];
  if (state.step === 'starshipConfirm') return [['↑↓', 'move'], ['Enter', 'choose'], ['Esc', 'cancel']];
  if (state.step === 'p10kResult') return [['Enter/Esc', 'back']];
  if (state.step === 'p10kConfirm' || state.step === 'p10kReady') return [['↑↓', 'move'], ['Enter', 'choose'], ['Esc', 'cancel']];
  const escape: [string, string] = ['Esc', state.onboarding ? 'skip' : 'cancel'];
  if (state.step === 'modules') return modulesManagerControls(state);
  if (state.step === 'gradient') {
    return state.gradient ? gradientEditorControls(state.gradient) : [['Esc', 'done']];
  }
  if (state.step === 'appearance') {
    if (state.focus === 'tabs') return [['←→', 'switch view'], ['↓', 'select'], ['Enter', 'save'], escape];
    return [['↑↓', 'move'], ['←→', 'change'], ['Enter', onModulesRow(state) ? 'edit modules' : onGradientRow(state) ? 'edit gradient' : 'save'], escape];
  }
  return [['↑↓', 'move'], ['Enter', 'choose'], escape];
}

export function promptPanelItemCount(state: PromptPanelState): number {
  switch (state.step) {
    case 'provider': return PROVIDER_ORDER.length;
    case 'powerlevel10k': return state.p10kStatus?.installed ? 4 : 2;
    case 'p10kConfirm': case 'p10kReady': return 2;
    case 'p10kResult': return 1;
    case 'starship': return state.starshipStatus?.installed ? 5 : 3;
    case 'starshipModules': return STARSHIP_MODULES.length;
    case 'railInsideConfirm': case 'starshipConfirm': return 2;
    case 'layout': return LAYOUT_CHOICES.length;
    case 'appearance': return (state.view ?? 'main') === 'git' ? RICH_GIT_ROWS.length : viewRows(state).length;
    case 'gradient': return state.gradient?.stops.length ?? 1;
    case 'modules': return modulesItemCount(state);
    case 'installConfirm': return 2;
    case 'installProgress': case 'installResult': case 'installDetails': return 1;
  }
  return 1;
}

/** Whether the panel itself handles this key (glyph typing owns Enter and Esc). */
export function promptPanelOwnsKey(state: PromptPanelState, key: Key): boolean {
  if (state.glyphEdit) return true;
  // The module manager owns Enter (details, confirmations) and Esc while a detail or confirmation is open.
  if (state.step === 'modules') return key.kind === 'enter' || ((key.kind === 'escape' || key.kind === 'interrupt') && Boolean(state.detail || state.confirm || state.search));
  return key.kind === 'enter' && state.step === 'appearance' && state.focus !== 'tabs' && Boolean(viewRows(state)[state.selectedIndex]?.edit);
}

function handleGlyphEdit(key: Key, state: PromptPanelState): boolean {
  const edit = state.glyphEdit;
  const row = viewRows(state).find(item => item.id === edit?.rowId);
  if (!edit || !row?.edit) { state.glyphEdit = undefined; return true; }
  if (key.kind === 'escape' || key.kind === 'interrupt') { state.glyphEdit = undefined; return true; }
  if (key.kind === 'enter') {
    const result = validateGlyph(edit.buffer);
    if (!result.ok) { edit.note = result.reason; return true; }
    row.edit.set(state.draft, result.glyph);
    state.glyphEdit = undefined;
    state.message = result.warning;
    return true;
  }
  if (key.kind === 'backspace') {
    const graphemes = [...new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(edit.buffer)].map(part => part.segment);
    edit.buffer = graphemes.slice(0, -1).join('');
  } else if (key.kind === 'text' || key.kind === 'paste') {
    // Controls never enter the buffer; validation reports anything else that does not fit.
    edit.buffer = (edit.buffer + key.value).replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').slice(0, 32);
  } else return true;
  const result = validateGlyph(edit.buffer);
  edit.note = edit.buffer ? (result.ok ? result.warning ?? `Preview: ${result.glyph} (${result.width} cell${result.width === 1 ? '' : 's'})` : result.reason) : undefined;
  return true;
}

/**
 * The theme gallery's Chroma quick control: flips the draft's one Chroma
 * setting (the palette, Off or not). Turning back On restores the palette it
 * turned Off, else the saved one, else Lavender.
 */
export function toggleChromaPreview(state: PromptPanelState): void {
  const presentation = state.draft.presentation;
  if (presentation.preset !== 'off') {
    state.chromaRestore = presentation.preset;
    presentation.preset = 'off';
  } else {
    const saved = state.saved?.presentation.preset;
    presentation.preset = state.chromaRestore ?? (saved && saved !== 'off' ? saved : 'lavender');
    if (presentation.preset === 'custom' && presentation.customStops.length < MIN_CUSTOM_STOPS) presentation.customStops = [...PRESET_STOPS.lavender];
  }
  state.message = undefined;
}

/** One row: state and the toggle first, the explanation only when it fits. Readable without color. */
export function chromaQuickControl(on: boolean, columns: number): string {
  const toggle = `${ACCENT}[C]${RESET} ${PRIMARY}${on ? 'Turn Off' : 'Turn On'}${RESET}`;
  const state = on ? `${BOLD}${PRIMARY}✦ Chroma ON${RESET}` : `${SECONDARY}Chroma OFF${RESET}`;
  const detail = `${SUBTLE} · ${on ? 'previews are colorized' : 'showing base theme colors'}${RESET}`;
  const hint = `${SUBTLE}  Chroma tab for details${RESET}`;
  for (const candidate of [`${state}${detail}   ${toggle}${hint}`, `${state}${detail}   ${toggle}`, `${state}   ${toggle}`]) {
    if (displayWidth(candidate) <= columns) return candidate;
  }
  return `${state}  ${toggle}`;
}

export function handlePromptPanelKey(key: Key, state: PromptPanelState): boolean {
  if (state.glyphEdit) return handleGlyphEdit(key, state);
  if (state.step === 'appearance' && (state.view ?? 'main') === 'main' && state.draft.provider === 'nmsh'
    && key.kind === 'text' && (key.value === 'c' || key.value === 'C')) {
    toggleChromaPreview(state);
    return true;
  }
  if (key.kind === 'enter' && state.step === 'appearance' && promptPanelOwnsKey(state, key)) {
    const row = viewRows(state)[state.selectedIndex]!;
    state.glyphEdit = {rowId: row.id, buffer: row.edit!.get(state.draft) ?? ''};
    return true;
  }
  if (state.step === 'appearance' && state.view === 'git' && state.focus !== 'tabs'
    && RICH_GIT_ROWS[state.selectedIndex] === 'gitEnabled' && key.kind === 'text' && key.value === ' ') {
    state.draft.nmsh.gitEnabled = !state.draft.nmsh.gitEnabled;
    state.message = undefined;
    return true;
  }
  if (state.step === 'gradient') {
    const handled = handleGradientKey(key, state);
    if (handled) state.message = undefined;
    return handled;
  }
  if (state.step === 'modules') {
    const before = state.message;
    const handled = handleModulesManagerKey(key, state);
    if (handled && state.message === before) state.message = undefined;
    if (handled || key.kind === 'enter') return handled;
  }
  // Tab / Shift+Tab switch the Main · Git · Chroma · Rail views from anywhere in them (a glyph being typed returned above).
  if (state.step === 'appearance' && tabCycleDelta(key)) {
    state.view = cycleTab(PROMPT_VIEW_IDS, state.view ?? 'main', tabCycleDelta(key)!);
    state.selectedIndex = 0;
    state.message = undefined;
    return true;
  }
  if (state.step === 'appearance' && state.focus === 'tabs') {
    if (key.kind === 'left' || key.kind === 'right') {
      state.view = cycleTab(PROMPT_VIEW_IDS, state.view ?? 'main', key.kind === 'left' ? -1 : 1);
      state.selectedIndex = 0;
    } else if (key.kind === 'down') state.focus = 'rows';
    else return false;
    state.message = undefined;
    return true;
  }
  // ↑ from the first appearance row reaches the view bar, as in /settings.
  if (key.kind === 'up' && state.step === 'appearance' && state.selectedIndex === 0) state.focus = 'tabs';
  else if (key.kind === 'up') state.selectedIndex = (state.selectedIndex - 1 + promptPanelItemCount(state)) % promptPanelItemCount(state);
  else if (key.kind === 'down') state.selectedIndex = (state.selectedIndex + 1) % promptPanelItemCount(state);
  else if (key.kind === 'left' || key.kind === 'right') {
    const delta = key.kind === 'left' ? -1 : 1;
    if (state.step === 'provider') state.selectedIndex = (state.selectedIndex + delta + PROVIDER_ORDER.length) % PROVIDER_ORDER.length;
    else if (state.step === 'layout') state.selectedIndex = (state.selectedIndex + delta + LAYOUT_CHOICES.length) % LAYOUT_CHOICES.length;
    else if (state.step === 'appearance' && state.view === 'git') {
      const nmsh = state.draft.nmsh;
      switch (RICH_GIT_ROWS[state.selectedIndex]) {
        case 'gitEnabled': nmsh.gitEnabled = !nmsh.gitEnabled; break;
        case 'gitColors': nmsh.gitColors = cycle(GIT_COLOR_MODES, nmsh.gitColors, delta); break;
        case 'gitGeometry': nmsh.gitGeometry = cycle(GIT_GEOMETRIES, nmsh.gitGeometry, delta); break;
        case 'gitConnectorFade': nmsh.gitConnectorFade = cycle(GIT_CONNECTOR_FADES, nmsh.gitConnectorFade, delta); break;
        default: return false;
      }
    } else if (state.step === 'appearance') {
      const row = viewRows(state)[state.selectedIndex];
      if (!row?.change) return false;
      row.change(state.draft, delta);
      // Rows can appear or vanish (e.g. Speed once Motion moves); keep the cursor on this row.
      const moved = viewRows(state).findIndex(candidate => candidate.id === row.id);
      if (moved !== -1) state.selectedIndex = moved;
    }
  } else return false;
  state.message = undefined;
  return true;
}

/**
 * `themePreviews` holds one live native prompt per palette, in
 * NATIVE_PALETTE_IDS order; it is shown only while editing appearance.
 */
export function renderPromptPanel(state: PromptPanelState, columns: number, preview: string[], themePreviews: string[] = [], rowsAvailable = Infinity,
  gitShowcase: string[] = [], chromaThemeStops?: readonly RgbColor[]): string[] {
  const title = state.standalone ? 'Modules' : state.onboarding ? 'Prompt setup' : 'Prompt settings';
  const rows = [`${PRIMARY}  ${title}${RESET}`];
  if (state.saved) rows.push(`${SUBTLE}  Current  ${SECONDARY}${describePromptConfiguration(state.saved)}${RESET}`);
  rows.push('');
  const item = (index: number, text: string) => `${focusForeground(index === state.selectedIndex)}${index === state.selectedIndex ? '›' : ' '} ${text}${RESET}`;
  if (railNeedsPromptConversion(state.draft)) rows.push(`${SECONDARY}  Requires Main Prompt: Inside · preview only${RESET}`, '');
  if (state.step === 'railInsideConfirm') {
    rows.push(`${PRIMARY}Context Rail Inside requires Main Prompt Inside geometry.${RESET}`);
    rows.push(`${SECONDARY}Change Main Prompt to two-line Inside with horizontal dividers?${RESET}`);
    rows.push(item(0, 'Change & Save'));
    rows.push(item(1, 'Cancel / Keep Current'));
  } else if (state.step === 'provider') {
    rows.push(`${PRIMARY}Choose your prompt${RESET}`);
    // Prompt providers report detection in their own steps, so the list carries no badge.
    PROMPT_PROVIDERS.forEach((provider, index) => rows.push(item(index,
      providerRowText(provider, {draft: state.draft.provider, saved: state.saved?.provider, status: 'none'}))));
  } else if (state.step === 'starship') {
    rows.push(`${PRIMARY}Starship${RESET}`);
    if (state.starshipStatus?.installed) {
      rows.push(`${SECONDARY}Detected ${state.starshipStatus.version ?? 'binary'}${RESET}`);
      rows.push(`${SECONDARY}Config ${state.starshipStatus.configPath}${state.starshipStatus.configExists ? '' : ' (defaults)'}${RESET}`);
      rows.push(item(0, 'Use existing configuration / defaults'));
      rows.push(item(1, 'Configure modules'));
      rows.push(item(2, 'Show preset setup command'));
      rows.push(item(3, 'Use NMSh for now'));
      rows.push(item(4, 'Back'));
    } else {
      rows.push(`${SECONDARY}Starship is not installed.${RESET}`);
      rows.push(item(0, process.platform === 'darwin' ? 'Install with Homebrew · brew install starship' : 'Install Starship using its official guide'));
      rows.push(item(1, 'Use NMSh for now'));
      rows.push(item(2, 'Back'));
    }
  } else if (state.step === 'starshipModules') {
    rows.push(`${PRIMARY}Starship modules${RESET}`);
    rows.push(`${SUBTLE}Edit supported modules using Starship's config command.${RESET}`);
    STARSHIP_MODULES.forEach((module, index) => rows.push(item(index,
      `${padCells(module, labelColumnWidth(STARSHIP_MODULES, columns, 2))}${state.starshipModules?.[index] ? 'Disabled' : 'Enabled'}`)));
  } else if (state.step === 'starshipConfirm') {
    const proposal = state.starshipProposal;
    rows.push(`${PRIMARY}Review Starship config change${RESET}`);
    if (proposal) {
      rows.push(`${SECONDARY}${proposal.path}${RESET}`);
      rows.push(`${SUBTLE}${proposal.module}: ${proposal.disabled ? 'disable' : 'enable'}${RESET}`);
      rows.push(...proposal.diff.map(line => `${SECONDARY}  ${stripAnsi(line).replace(/[\u0000-\u001f\u007f]/gu, '?')}${RESET}`));
      rows.push(`${SUBTLE}An existing file will be backed up before the change.${RESET}`);
    }
    rows.push(item(0, 'Apply reviewed change'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'powerlevel10k') {
    rows.push(`${PRIMARY}Powerlevel10k${RESET}`);
    const status = state.p10kStatus;
    if (status?.installed) {
      rows.push(`${SECONDARY}Theme ${status.themePath}${RESET}`);
      rows.push(`${SECONDARY}Config ${status.configPath}${status.configExists ? '' : ' (not found; p10k defaults)'}${RESET}`);
      rows.push(`${SUBTLE}Rendered in an isolated zsh; NMSh keeps the editor. Your left prompt is shown without its prompt character;${RESET}`);
      rows.push(`${SUBTLE}git state uses p10k's vcs_info fallback, and the right prompt is not shown yet.${RESET}`);
      rows.push(item(0, 'Use Powerlevel10k'));
      rows.push(item(1, 'Configure Powerlevel10k'));
      rows.push(item(2, 'Use NMSh for now'));
      rows.push(item(3, 'Back'));
    } else {
      rows.push(`${SECONDARY}Powerlevel10k was not found.${RESET}`);
      rows.push(`${SUBTLE}Install it yourself (e.g. brew install powerlevel10k), run p10k configure from /zsh, then reopen /prompt.${RESET}`);
      rows.push(item(0, 'Use NMSh for now'));
      rows.push(item(1, 'Back'));
    }
  } else if (state.step === 'p10kConfirm') {
    rows.push(`${PRIMARY}Run Powerlevel10k's official configurator?${RESET}`);
    rows.push(`${SECONDARY}The wizard may modify:${RESET}`);
    rows.push(`${SECONDARY}  ${state.p10kStatus?.configPath ?? '~/.p10k.zsh'}${RESET}`);
    rows.push(`${SECONDARY}  ${powerlevel10kZshrcPath()}${RESET}`);
    rows.push(`${SUBTLE}NMSh will hand terminal control to the wizard and restore it afterwards.${RESET}`);
    rows.push(item(0, 'Create backups and continue'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'p10kReady') {
    rows.push(`${PRIMARY}Powerlevel10k backup ready${RESET}`);
    for (const file of [state.p10kPreparation?.config, state.p10kPreparation?.zshrc]) {
      if (file) rows.push(`${SECONDARY}  ${file.path}: ${file.backup ?? 'not present before wizard'}${RESET}`);
    }
    rows.push(item(0, 'Launch official wizard'));
    rows.push(item(1, 'Cancel'));
  } else if (state.step === 'p10kResult') {
    rows.push(`${PRIMARY}Powerlevel10k configurator finished${RESET}`);
    rows.push(...(state.p10kResult ?? []).map(line => `${SECONDARY}  ${line}${RESET}`));
  } else if (state.step === 'installConfirm') {
    rows.push(`${PRIMARY}Run this command?${RESET}`);
    rows.push(`${SECONDARY}brew install starship${RESET}`);
    rows.push(item(0, 'Install Starship now'));
    rows.push(item(1, 'Back'));
  } else if (state.step === 'installProgress' || state.step === 'installResult') {
    rows.push(...(state.task ? renderTaskProgress(state.task.state) : [`${SUBTLE}No task is active.${RESET}`]));
  } else if (state.step === 'installDetails') {
    rows.push(`${PRIMARY}Installation details${RESET}`);
    const details = state.task?.state.details.trim() || state.task?.state.error || 'No diagnostic output was captured.';
    rows.push(...details.split(/\r?\n/u).slice(-Math.max(1, Math.min(12, rowsAvailable - 6))).map(line =>
      `${SECONDARY}  ${stripAnsi(line).replace(/[\u0000-\u001f\u007f]/gu, '?')}${RESET}`));
  } else if (state.step === 'layout') {
    rows.push(`${PRIMARY}Choose composer layout${RESET}`);
    const draftChoice = layoutChoiceIndex(state.draft);
    const savedChoice = state.saved ? layoutChoiceIndex(state.saved) : -1;
    LAYOUT_CHOICES.forEach((choice, index) => rows.push(item(index,
      `${choice.label}${index === draftChoice ? '  ●' : ''}${index === savedChoice ? '  ✓ saved' : ''}`)));
  } else if (state.step === 'gradient' && state.gradient) {
    const gradient = state.gradient;
    rows.push(...renderGradientEditorRows(gradient, 'Custom gradient'));
    const stops = gradient.stops.length >= MIN_CUSTOM_STOPS ? gradient.stops : state.draft.presentation.customStops;
    rows.push(`  ${SUBTLE}Gradient  ${RESET}${treatmentSwatch({...state.draft.presentation, preset: 'custom', customStops: stops}, Math.max(8, Math.min(40, columns - 14)))}${RESET}`);
  } else if (state.step === 'modules') {
    rows.push(...renderModulesManager(state, columns, undefined, Math.max(8, rowsAvailable - rows.length - preview.length - 6)));
  } else {
    const saved = state.saved?.nmsh;
    const value = (text: string, savedText: string | undefined) => savedText === undefined || savedText === text
      ? `‹ ${text} ›`
      : `‹ ${text} ›  ${SUBTLE}saved: ${savedText}`;
    const savedGap = state.saved ? gapLabel(nativeGapChoice(state.saved)) : undefined;
    const draft = state.draft.nmsh;
    const iconLabel = (mode: PromptConfiguration['nmsh']['icons']) => mode === 'off' ? 'Off' : 'On';
    const visibleModules = state.draft.modules.filter(module => module.visible).length;
    const view = state.view ?? 'main';
    const rowIndex = (index: number) => state.focus === 'tabs' ? -1 : index;
    const row = (index: number, text: string) => item(rowIndex(index), text);
    rows.push(renderTabStrip(PROMPT_VIEWS, PROMPT_VIEW_IDS.indexOf(view), columns, state.focus === 'tabs'), '');
    if (view === 'git') {
      const onOff = (enabled: boolean) => enabled ? 'On' : 'Off';
      const gitWidth = labelColumnWidth(['Enabled', 'Colors', 'Geometry', 'Connector fade'], columns, 2);
      rows.push(row(0, `${padCells('Enabled', gitWidth)}${value(onOff(draft.gitEnabled), saved && onOff(saved.gitEnabled))}`));
      rows.push(row(1, `${padCells('Colors', gitWidth)}${value(gitColorsLabel(draft.gitColors), saved && gitColorsLabel(saved.gitColors))}`));
      rows.push(row(2, `${padCells('Geometry', gitWidth)}${value(gitGeometryLabel(draft.gitGeometry), saved && gitGeometryLabel(saved.gitGeometry))}`));
      const gitFadeNote = !state.draft.nmsh.gapEnabled && draft.gitConnectorFade !== 'off' ? `  ${SUBTLE}applies with a gap` : '';
      rows.push(row(3, `${padCells('Connector fade', gitWidth)}${value(gitConnectorFadeLabel(draft.gitConnectorFade), saved && gitConnectorFadeLabel(saved.gitConnectorFade))}${gitFadeNote}`));
      if (gitShowcase.length) {
        rows.push('', draft.gitEnabled
          ? `${PRIMARY}Rich Git states${RESET}  ${SUBTLE}preview only${RESET}`
          : `${PRIMARY}Rich Git states${RESET}  ${SUBTLE}Rich Git is off · the prompt shows the branch only · dimmed sample${RESET}`);
        RICH_GIT_SHOWCASE.forEach((entry, index) => {
          const line = gitShowcase[index] ?? '';
          rows.push(`  ${SECONDARY}${padCells(entry.label, labelColumnWidth(RICH_GIT_SHOWCASE.map(item => item.label), columns, 2))}${RESET}${draft.gitEnabled ? line : `${SUBTLE}${stripAnsi(line)}`}${RESET}`);
        });
      }
    } else {
      // Main Prompt and Chroma: rows derived from the draft, so hidden controls cannot be edited.
      const savedConfiguration = state.saved;
      const labelWidth = labelColumnWidth(viewRows(state).map(entry => entry.label), columns, 2);
      viewRows(state).forEach((entry, index) => {
        const editing = state.glyphEdit?.rowId === entry.id ? state.glyphEdit : undefined;
        const text = editing ? `${editing.buffer}${INVERSE} ${RESET}` : entry.value(state.draft);
        const savedText = editing ? undefined : savedConfiguration ? entry.value(savedConfiguration) : undefined;
        const note = editing ? editing.note ?? 'type one character · Enter set · Esc cancel' : entry.note?.(state.draft);
        const body = entry.opens ? text : value(text, savedText);
        rows.push(row(index, `${padCells(entry.label, labelWidth)}${body}${note ? `  ${SUBTLE}${note}` : ''}`));
      });
      if (view === 'chroma' && state.draft.presentation.preset !== 'off') {
        rows.push(`  ${SUBTLE}Gradient  ${RESET}${treatmentSwatch(state.draft.presentation, Math.max(8, Math.min(40, columns - 14)), chromaThemeStops)}${RESET}`);
      }
    }
    if (themePreviews.length && view === 'chroma') {
      rows.push('');
      rows.push(`${PRIMARY}Palettes${RESET}  ${SUBTLE}● selected  ✓ saved · the showcase prompt in each${RESET}`);
      TREATMENT_PRESETS.forEach((id, index) => {
        const marker = state.draft.presentation.preset === id ? `${ACCENT}●` : `${SUBTLE}○`;
        const savedMark = state.saved?.presentation.preset === id ? '✓' : ' ';
        rows.push(`${marker} ${SECONDARY}${padCells(TREATMENT_PRESET_LABELS[id], labelColumnWidth(Object.values(TREATMENT_PRESET_LABELS), columns, 2, 20), 1)}${ACCENT}${savedMark}${RESET} ${themePreviews[index] ?? ''}${RESET}`);
      });
    }
    if (themePreviews.length && view === 'main') {
      rows.push('');
      rows.push(`${PRIMARY}Themes${RESET}  ${SUBTLE}● selected  ✓ saved${RESET}`);
      if (state.draft.provider === 'nmsh') rows.push(chromaQuickControl(state.draft.presentation.preset !== 'off', columns), `${SUBTLE}${chromaPreviewNote(state.draft.presentation.preset !== 'off')}${RESET}`);
      galleryPalettes(state.draft).forEach((id, index) => {
        const theme = NATIVE_PROMPT_THEMES[id];
        const marker = state.draft.nmsh.palette === id ? `${ACCENT}●` : `${SUBTLE}○`;
        const savedMark = saved?.palette === id ? '✓' : ' ';
        const label = padCells(theme.label, labelColumnWidth(galleryPalettes(state.draft).map(palette => NATIVE_PROMPT_THEMES[palette].label), columns, 2, 20), 1);
        rows.push(`${marker} ${SECONDARY}${label}${ACCENT}${savedMark}${RESET} ${themePreviews[index] ?? ''}${RESET}`);
      });
    }
  }
  if (state.message) rows.push(`${SECONDARY}${state.message}${RESET}`);
  if (preview.length) {
    rows.push('');
    const selectedLayout = state.step === 'layout'
      ? LAYOUT_CHOICES[state.selectedIndex]?.composerLayout ?? state.draft.composerLayout
      : state.draft.composerLayout;
    const status = promptDraftChanged(state) ? `${ACCENT}unsaved preview` : state.saved ? `${SUBTLE}matches current` : '';
    const chromaPreview = state.step === 'gradient' || (state.step === 'appearance' && state.view === 'chroma');
    rows.push(`${PRIMARY}${state.view === 'rail' ? 'Context Rail preview' : chromaPreview ? 'Chroma preview' : selectedLayout === 'oneLine' ? 'One-line preview' : 'Two-line preview'}${RESET}${status ? `  ${status}${RESET}` : ''}`);
    rows.push(...preview);
  }
  rows.push('');
  rows.push(...renderControlRows(promptPanelControls(state), columns));
  return rows.map(row => truncateAnsi(row, columns));
}
