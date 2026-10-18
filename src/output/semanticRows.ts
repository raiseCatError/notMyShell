import {colorLevel} from '../presentation/capabilities.js';
import {GLYPHS, getCurrentGlyphMode} from '../ui/glyphs.js';
import {foreground, UI_COLORS} from '../ui/palette.js';
import {truncateText} from '../util/text.js';
import type {SemanticResult} from './semantic.js';
import type {WrappedRow} from './viewport.js';

/**
 * How a Semantic Output reading is drawn inside its block (#386): one overview row, then, when the reading lists
 * failures or diagnostics, a disclosure row and (open) the items. The rows are derived presentation: never stored
 * transcript lines, never in raw search, selection or /copy (which copy the output as it was).
 */

const RESET = '\u001b[0m';
const inert = (text: string) => text.replace(/[\u0000-\u001f\u007f-\u009f\p{Cf}\p{Zl}\p{Zp}]/gu, '·');

function itemLabel(result: SemanticResult): string {
  const total = result.items.length + result.omitted;
  if (result.kind === 'tests') return `${total.toLocaleString('en-US')} failing test${total === 1 ? '' : 's'}`;
  return `${total.toLocaleString('en-US')} diagnostic${total === 1 ? '' : 's'}`;
}

export function semanticRows(result: SemanticResult, open: boolean, width: number, owner: {lineIndex: number; commandIndex: number; startId: number}): WrappedRow[] {
  const color = colorLevel() !== 'none';
  const paint = (role: keyof typeof UI_COLORS) => color ? foreground(UI_COLORS[role]) : '';
  const passed = result.outcome === 'passed';
  const icon = passed ? GLYPHS.success : GLYPHS.failure;
  const base = {lineIndex: owner.lineIndex, commandIndex: owner.commandIndex, isSemantic: true as const};
  const overviewPlain = truncateText(`  ${icon} ${result.source} · ${result.overview}${result.complete ? '' : ' · from the end of the output'}`, width);
  const rows: WrappedRow[] = [{...base, plain: overviewPlain,
    ansi: `${paint(passed ? 'success' : 'failure')}${overviewPlain.slice(0, 2 + icon.length + 1)}${RESET}${paint('secondary')}${overviewPlain.slice(2 + icon.length + 1)}${RESET}`}];
  if (!result.items.length) return rows;
  const marker = open ? (getCurrentGlyphMode() === 'nerd' ? '⌄' : 'v') : GLYPHS.selection;
  const disclosure = truncateText(`  ${marker} ${itemLabel(result)}${open ? '' : ' · click or Actions to show'}`, width);
  rows.push({...base, plain: disclosure, ansi: `${paint('subtle')}${disclosure}${RESET}`, semanticToggle: owner.startId});
  if (!open) return rows;
  for (const item of result.items) {
    const mark = item.tone === 'failure' ? GLYPHS.failure : '!';
    const plain = truncateText(`    ${mark} ${inert(item.text)}`, width);
    rows.push({...base, plain, ansi: `${paint(item.tone === 'failure' ? 'failure' : 'warning')}${plain.slice(0, 4 + mark.length)}${RESET}${plain.slice(4 + mark.length)}`});
  }
  if (result.omitted) {
    const plain = truncateText(`    … ${result.omitted.toLocaleString('en-US')} more in the output below`, width);
    rows.push({...base, plain, ansi: `${paint('subtle')}${plain}${RESET}`});
  }
  return rows;
}
