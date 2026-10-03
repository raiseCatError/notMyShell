import {getIconStyle, GLYPHS, moduleIcon, powerlineShapeGlyphs, setIconStyle, type GlyphMode} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth} from '../util/text.js';

/** Glyphs from the production registry, drawn in one glyph mode. */
function samples(mode: GlyphMode): Array<{label: string; text: string}> {
  const previous = getIconStyle();
  setIconStyle(mode);
  try {
    const wedge = powerlineShapeGlyphs('wedge');
    const rounded = powerlineShapeGlyphs('rounded');
    const icon = (id: Parameters<typeof moduleIcon>[0], name: string) => `${moduleIcon(id)}${moduleIcon(id) ? ' ' : ''}${name}`;
    return [
      {label: 'Powerline', text: `${wedge.open}${wedge.join}${rounded.open}${rounded.close}`},
      {label: 'Branch', text: `${moduleIcon('gitBranch') || GLYPHS.branch}${moduleIcon('gitBranch') ? ' ' : ''}main`},
      {label: 'Node', text: icon('node', 'node')},
      {label: 'Python', text: icon('python', 'py')},
      {label: 'Go', text: icon('go', 'go')},
      {label: 'Docker', text: icon('docker', 'docker')},
      {label: 'Status', text: `${GLYPHS.success} ${GLYPHS.failure}`},
      {label: 'Arrows', text: `${GLYPHS.selection} ${GLYPHS.jumpDown}`},
      {label: 'Prompt', text: GLYPHS.prompt},
    ];
  } finally { setIconStyle(previous); }
}

/**
 * The Terminal step's font diagnostic: the same NMSh glyphs in Nerd Font and
 * Safe/ASCII, column-aligned so the two can be compared at a glance. Boxes,
 * question marks or ragged columns in the Nerd row mean the font is missing them.
 */
export function glyphDiagnosticRows(selected: GlyphMode): string[] {
  const nerd = samples('nerd');
  const safe = samples('safe');
  const widths = nerd.map((item, index) => Math.max(displayWidth(item.label), displayWidth(item.text), displayWidth(safe[index]!.text)) + 2);
  const subtle = foreground(UI_COLORS.subtle);
  const primary = foreground(UI_COLORS.primary);
  const accent = foreground(UI_COLORS.accent);
  const reset = '\u001B[0m';
  const cell = (text: string, width: number) => `${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}`;
  const line = (mode: GlyphMode, name: string, items: Array<{text: string}>) =>
    `${mode === selected ? `${accent}›` : ' '} ${subtle}${cell(name, 11)}${reset}${primary}${items.map((item, index) => cell(item.text, widths[index]!)).join('')}${reset}`;
  return [
    `  ${subtle}${cell('', 11)}${nerd.map((item, index) => cell(item.label, widths[index]!)).join('')}${reset}`,
    line('nerd', 'Nerd Font', nerd),
    line('safe', 'Safe/ASCII', safe),
    `  ${subtle}Boxes, question marks or uneven columns in the Nerd Font row mean your font lacks those glyphs: choose Safe.${reset}`,
  ];
}
