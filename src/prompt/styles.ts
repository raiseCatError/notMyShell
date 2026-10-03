/**
 * Native prompt styles and their independent, persisted profiles. Powerline
 * keeps its long-standing storage (the Main Prompt geometry fields and the
 * root gap/spacing), so existing configurations render exactly as before;
 * every other style owns a small profile under `nmsh.styleProfiles`, so
 * switching styles never discards another style's customization.
 */

export type PromptStyle = 'powerline' | 'soft' | 'minimal' | 'outline' | 'breadcrumb' | 'compact' | 'ribbon';
export const PROMPT_STYLES: readonly PromptStyle[] = ['powerline', 'soft', 'minimal', 'outline', 'breadcrumb', 'compact', 'ribbon'];
export const PROMPT_STYLE_LABELS: Record<PromptStyle, string> = {
  powerline: 'Powerline', soft: 'Soft', minimal: 'Minimal', outline: 'Outline', breadcrumb: 'Breadcrumb', compact: 'Compact', ribbon: 'Ribbon',
};
export const PROMPT_STYLE_NOTES: Record<PromptStyle, string> = {
  powerline: 'filled segments with shaped joins',
  soft: 'filled pills or one capsule',
  minimal: 'colored text, no fills',
  outline: 'outlined segments, no fills',
  breadcrumb: 'a trail with one filled anchor',
  compact: 'dense filled cells, no gaps',
  ribbon: 'one band, colored text',
};

export function normalizePromptStyle(value: unknown): PromptStyle {
  return PROMPT_STYLES.includes(value as PromptStyle) ? value as PromptStyle : 'powerline';
}

/** Styles drawn without filled module backgrounds (text treatments). */
export function isTextStyle(style: PromptStyle): boolean {
  return style === 'minimal' || style === 'outline' || style === 'breadcrumb';
}

export interface SoftProfile {cap: 'rounded' | 'slant' | 'square'; layout: 'separated' | 'connected'; gap: number; padding: number; fill: 'filled' | 'subtle'}
export interface MinimalProfile {separator: 'space' | 'dot' | 'pipe' | 'slash' | 'chevron'; spacing: number; emphasis: 'none' | 'first' | 'all'}
export interface OutlineProfile {cap: 'rounded' | 'square' | 'angle'; layout: 'separated' | 'connected'; gap: number; padding: number}
export interface BreadcrumbProfile {separator: 'chevron' | 'slash' | 'dot'; anchor: 'first' | 'last' | 'none'; spacing: number}
export interface CompactProfile {ends: 'flat' | 'rounded' | 'wedge'; padding: number; seams: 'none' | 'thin'}
export interface RibbonProfile {slant: 'forward' | 'backward'; ends: 'slanted' | 'pointed' | 'flat'; padding: number; band: 'deep' | 'neutral'}

export interface StyleProfiles {
  soft: SoftProfile;
  minimal: MinimalProfile;
  outline: OutlineProfile;
  breadcrumb: BreadcrumbProfile;
  compact: CompactProfile;
  ribbon: RibbonProfile;
}
export type ProfiledStyle = keyof StyleProfiles;

/**
 * Defaults seeded from the legacy shared gap/spacing, matching how Soft,
 * Minimal and Outline rendered before they had their own settings.
 */
export function defaultStyleProfiles(legacyGap = 1, legacySpacing = 1): StyleProfiles {
  const gap = Math.max(0, Math.min(3, Math.trunc(legacyGap)));
  const spacing = Math.max(0, Math.min(3, Math.trunc(legacySpacing)));
  return {
    soft: {cap: 'rounded', layout: 'separated', gap: Math.max(1, gap), padding: spacing, fill: 'filled'},
    minimal: {separator: 'space', spacing: Math.max(2, gap + 1), emphasis: 'none'},
    outline: {cap: 'rounded', layout: 'separated', gap: Math.max(1, gap), padding: spacing},
    breadcrumb: {separator: 'chevron', anchor: 'first', spacing: 1},
    compact: {ends: 'flat', padding: 1, seams: 'none'},
    ribbon: {slant: 'forward', ends: 'slanted', padding: 1, band: 'deep'},
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const choose = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => values.includes(value as T) ? value as T : fallback;
const bounded = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;

export const STYLE_PROFILE_OPTIONS = {
  soft: {cap: ['rounded', 'slant', 'square'], layout: ['separated', 'connected'], gap: [1, 2, 3], padding: [0, 1, 2, 3], fill: ['filled', 'subtle']},
  minimal: {separator: ['space', 'dot', 'pipe', 'slash', 'chevron'], spacing: [1, 2, 3, 4], emphasis: ['none', 'first', 'all']},
  outline: {cap: ['rounded', 'square', 'angle'], layout: ['separated', 'connected'], gap: [0, 1, 2, 3], padding: [0, 1, 2, 3]},
  breadcrumb: {separator: ['chevron', 'slash', 'dot'], anchor: ['first', 'last', 'none'], spacing: [1, 2]},
  compact: {ends: ['flat', 'rounded', 'wedge'], padding: [0, 1], seams: ['none', 'thin']},
  ribbon: {slant: ['forward', 'backward'], ends: ['slanted', 'pointed', 'flat'], padding: [0, 1, 2], band: ['deep', 'neutral']},
} as const;

/** Missing profiles (older configs) are seeded from the legacy shared gap/spacing. */
export function normalizeStyleProfiles(value: unknown, legacyGap = 1, legacySpacing = 1): StyleProfiles {
  const defaults = defaultStyleProfiles(legacyGap, legacySpacing);
  const v = isRecord(value) ? value : {};
  const o = STYLE_PROFILE_OPTIONS;
  const soft = isRecord(v.soft) ? v.soft : {};
  const minimal = isRecord(v.minimal) ? v.minimal : {};
  const outline = isRecord(v.outline) ? v.outline : {};
  const breadcrumb = isRecord(v.breadcrumb) ? v.breadcrumb : {};
  const compact = isRecord(v.compact) ? v.compact : {};
  const ribbon = isRecord(v.ribbon) ? v.ribbon : {};
  return {
    soft: {cap: choose(o.soft.cap, soft.cap, defaults.soft.cap), layout: choose(o.soft.layout, soft.layout, defaults.soft.layout),
      gap: bounded(soft.gap, 1, 3, defaults.soft.gap), padding: bounded(soft.padding, 0, 3, defaults.soft.padding),
      fill: choose(o.soft.fill, soft.fill, defaults.soft.fill)},
    minimal: {separator: choose(o.minimal.separator, minimal.separator, defaults.minimal.separator),
      spacing: bounded(minimal.spacing, 1, 4, defaults.minimal.spacing), emphasis: choose(o.minimal.emphasis, minimal.emphasis, defaults.minimal.emphasis)},
    outline: {cap: choose(o.outline.cap, outline.cap, defaults.outline.cap), layout: choose(o.outline.layout, outline.layout, defaults.outline.layout),
      gap: bounded(outline.gap, 0, 3, defaults.outline.gap), padding: bounded(outline.padding, 0, 3, defaults.outline.padding)},
    breadcrumb: {separator: choose(o.breadcrumb.separator, breadcrumb.separator, defaults.breadcrumb.separator),
      anchor: choose(o.breadcrumb.anchor, breadcrumb.anchor, defaults.breadcrumb.anchor), spacing: bounded(breadcrumb.spacing, 1, 2, defaults.breadcrumb.spacing)},
    compact: {ends: choose(o.compact.ends, compact.ends, defaults.compact.ends), padding: bounded(compact.padding, 0, 1, defaults.compact.padding),
      seams: choose(o.compact.seams, compact.seams, defaults.compact.seams)},
    ribbon: {slant: choose(o.ribbon.slant, ribbon.slant, defaults.ribbon.slant), ends: choose(o.ribbon.ends, ribbon.ends, defaults.ribbon.ends),
      padding: bounded(ribbon.padding, 0, 2, defaults.ribbon.padding), band: choose(o.ribbon.band, ribbon.band, defaults.ribbon.band)},
  };
}

export const STYLE_OPTION_LABELS: Readonly<Record<string, string>> = {
  rounded: 'Rounded', slant: 'Slant', square: 'Square', separated: 'Separated', connected: 'Connected', filled: 'Filled', subtle: 'Subtle',
  space: 'Space', dot: 'Dot ·', pipe: 'Pipe │', slash: 'Slash /', chevron: 'Chevron ›', none: 'None', first: 'First module', all: 'All modules',
  angle: 'Angle', last: 'Last module', flat: 'Flat', wedge: 'Wedge', thin: 'Thin seams', forward: 'Forward /', backward: 'Backward \\',
  slanted: 'Slanted', pointed: 'Pointed', deep: 'Deep theme band', neutral: 'Neutral band',
};
