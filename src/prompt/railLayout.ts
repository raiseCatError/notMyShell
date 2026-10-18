import type {PromptConfiguration} from './configuration.js';
import {displayWidth} from '../util/text.js';

export type RailRow = {kind: 'content'; index: number} | {kind: 'gap'} | {kind: 'edge'};
export interface RailPresentation {
  relation: 'vertical' | 'right';
  inside: boolean;
  anchor: 'prompt' | 'rail' | 'above';
  mirrored: boolean;
  rows: number;
  gap: number;
  between: number;
  width: number;
  column: number;
  editorColumns: number;
}

/** Pure visual policy. Missing fields retain the original proof's geometry. */
export function railPresentation(configuration: PromptConfiguration, rows: number, columns: number,
  parts: {left: string; right: string} = {left: '', right: ''}): RailPresentation {
  const rail = configuration.contextRail;
  const relation = rail.relation ?? 'vertical';
  const inside = rows > 0 && mainSupportsRailInside(configuration)
    && (rail.integration === 'inside' || rail.integration === 'auto');
  const anchor = inside ? rail.dividerAnchor ?? 'prompt' : 'prompt';
  const gap = rail.spacing === 'spacious' ? (relation === 'right' ? 4 : 1) : rail.spacing === 'gap' ? 1 : 0;
  const between = relation === 'vertical' && rail.spacing === 'spacious' ? 1 : 0;
  const usable = Math.max(0, columns);
  const rightReserve = displayWidth(parts.right) + (parts.right ? 1 : 0);
  const protectedWidth = Math.max(24, displayWidth(parts.left) + (configuration.composerLayout === 'oneLine' ? 16 : 0));
  const width = relation === 'right' ? Math.max(0, Math.min(Math.floor(usable / 3), usable - protectedWidth - rightReserve - gap)) : usable;
  const column = relation === 'right' ? Math.max(0, usable - rightReserve - width) : 0;
  return {relation, inside, anchor, mirrored: rail.direction === 'mirrored', rows: Math.min(2, rows), gap, between,
    width, column, editorColumns: relation === 'right' && width && rows && (configuration.composerLayout === 'oneLine' || rows === 2)
      ? Math.max(1, column - gap) : usable};
}

/** Vertical spacing is explicitly represented; it is never a context module. */
export function verticalRailRows(p: RailPresentation, top: boolean): RailRow[] {
  const content: RailRow[] = [];
  for (let index = 0; index < p.rows; index++) {
    if (index && p.between) content.push({kind: 'gap'});
    content.push({kind: 'content', index});
  }
  const gap: RailRow[] = p.gap ? [{kind: 'gap'}] : [];
  const edge: RailRow[] = p.inside && p.anchor !== 'rail' ? [{kind: 'edge'}] : [];
  return top ? [...gap, ...content, ...edge] : [...edge, ...content, ...gap];
}


/** Existing Main Prompt Inside geometry: two lines between horizontal rules. */
export function mainSupportsRailInside(configuration: PromptConfiguration): boolean {
  return configuration.provider === 'nmsh' && configuration.composerLayout === 'twoLine'
    && configuration.placement === 'composer' && configuration.composerDividers;
}

export function railNeedsPromptConversion(configuration: PromptConfiguration): boolean {
  return configuration.provider === 'nmsh' && configuration.contextRail.integration === 'inside'
    && !mainSupportsRailInside(configuration);
}

/** Proposed geometry only. Neither the live configuration nor the draft is mutated. */
export function railPreviewConfiguration(configuration: PromptConfiguration): PromptConfiguration {
  const preview = structuredClone(configuration);
  if (railNeedsPromptConversion(preview)) {
    preview.composerLayout = 'twoLine';
    preview.placement = 'composer';
    preview.composerDividers = true;
  }
  return preview;
}
