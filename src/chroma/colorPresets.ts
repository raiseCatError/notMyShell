/**
 * The named presets every custom-color editor offers (idle visuals, live activity, cursor effects).
 * Each runs bright to deep: young to old for particles, start to end for gradients.
 */
export const COLOR_PRESET_IDS = ['lavender', 'purple', 'blue', 'cyan', 'teal', 'green', 'amber', 'orange', 'rose', 'white'] as const;
export type ColorPresetId = typeof COLOR_PRESET_IDS[number];

export const COLOR_PRESET_LABELS: Readonly<Record<ColorPresetId, string>> = {lavender: 'Lavender', purple: 'Purple', blue: 'Blue', cyan: 'Cyan',
  teal: 'Teal', green: 'Green', amber: 'Amber', orange: 'Orange', rose: 'Rose', white: 'White'};

export const COLOR_PRESET_STOPS: Readonly<Record<ColorPresetId, readonly string[]>> = {
  lavender: ['#e4d6ff', '#c5a4fa', '#a67cf3', '#6c4bb3'],
  purple: ['#e2c6ff', '#b785f5', '#7944bf', '#31104f'],
  blue: ['#cfe2ff', '#7fb0ff', '#3a76f0', '#16398a'],
  cyan: ['#d4fbff', '#7ee5f5', '#22b6d4', '#0c566e'],
  teal: ['#c8f6ea', '#6cdac1', '#1ea38c', '#0a4f46'],
  green: ['#d0ffd2', '#7ae69c', '#24a46b', '#103d30'],
  amber: ['#fff0c0', '#ffd166', '#efa11f', '#774806'],
  orange: ['#ffdfc0', '#ffa95f', '#ef6a1d', '#772b07'],
  rose: ['#ffd6e5', '#ff9dc0', '#e6578f', '#781e44'],
  white: ['#ffffff', '#e7e9ef', '#c5c9d3', '#8b909d'],
};

/** The preset these stops are, if any (case-insensitive). */
export function colorPresetOf(stops: readonly string[]): ColorPresetId | undefined {
  const key = stops.join(',').toLowerCase();
  return COLOR_PRESET_IDS.find(id => COLOR_PRESET_STOPS[id].join(',') === key);
}
