import {colorLevel} from '../presentation/capabilities.js';
import type {PromptContext} from '../shell/ShellContext.js';
import type {PromptConfiguration} from './configuration.js';
import {buildContextParts, buildContextRail, buildInlineContextPrefix, buildRightContext} from './prompt.js';
import {railPresentation, type RailPresentation} from './railLayout.js';
import {planScreen, regionOf, type ScreenPlan} from '../app/screenPlan.js';
import {displayWidth, repeatToWidth, stripAnsi, truncateAnsi} from '../util/text.js';
import {paintDivider} from '../chroma/treatment.js';
import {GLYPHS} from '../ui/glyphs.js';

const RESET = '\u001b[0m';
export interface PreparedRail {presentation: RailPresentation; content: string[]; time: number}

/** Facts arrive resolved. This projection never requests or collects a value. */
export function prepareRail(context: PromptContext, columns: number, configuration: PromptConfiguration, time = 0): PreparedRail {
  const enabled = configuration.provider === 'nmsh' && configuration.contextRail.mode !== 'off';
  const parts = buildContextParts(context, columns, configuration, time);
  const budget = railPresentation(configuration, enabled ? configuration.contextRail.rows : 0, columns, parts);
  const content = enabled && !(budget.width === 0 && configuration.contextRail.mode === 'auto') ? buildContextRail(context, budget.width, configuration, time) : [];
  return {content, time, presentation: railPresentation(configuration, content.length, columns, parts)};
}

/** Pure final composition over ScreenPlan-owned rows/cells, shared by preview and live. */
export function paintRailComposition(rows: string[], plan: ScreenPlan, prepared: PreparedRail,
  context: PromptContext, columns: number, configuration: PromptConfiguration, time = 0): void {
  const geometry = plan.rail;
  if (!geometry || plan.panelActive) return;
  const p = geometry.presentation;
  const contentRows = time === prepared.time ? prepared.content : buildContextRail(context, p.width, configuration, time);
  const width = Math.max(0, columns);
  const divider = (cells: number) => `${paintDivider(repeatToWidth(GLYPHS.separator, Math.max(0, cells)), configuration.presentation, time)}${RESET}`;
  const fill = (content: string, rule = false, mirrored = false) => {
    const text = truncateAnsi(content, width);
    const padding = Math.max(0, width - displayWidth(text));
    const space = rule ? divider(padding) : ' '.repeat(padding);
    return mirrored ? `${space}${text}${RESET}` : `${text}${RESET}${space}`;
  };
  const input = regionOf(plan, 'input');
  const prompt = regionOf(plan, 'prompt');
  const native = buildContextParts(context, width, configuration, time);
  const nativeRow = (left: string, rail: string | undefined, rule: boolean, includeRight = true) => {
    let right = includeRight ? native.right : '';
    if (p.relation === 'right' && !p.width && !prompt && displayWidth(left) + displayWidth(right) + 2 > width) right = '';
    // At zero Rail width, inline input retains its full measured editor budget.
    const limit = p.relation === 'right' && p.width ? Math.max(0, p.column - p.gap) : width - (right ? displayWidth(right) + 1 : 0);
    const main = truncateAnsi(left, limit);
    let result = main;
    if (rail !== undefined && p.width) {
      const space = Math.max(0, p.column - displayWidth(result));
      const ruleCells = rule && !p.inside ? Math.max(0, space - p.gap) : 0;
      result += RESET + divider(ruleCells) + ' '.repeat(space - ruleCells);
      const fitted = truncateAnsi(rail, p.width);
      result += p.mirrored ? ' '.repeat(Math.max(0, p.width - displayWidth(fitted))) + fitted : fitted;
    }
    const remaining = Math.max(0, width - displayWidth(result) - displayWidth(right));
    result += RESET + (rule && !(p.relation === 'right' && !p.inside) ? divider(remaining) : ' '.repeat(remaining)) + right + RESET;
    return truncateAnsi(result, width);
  };
  if (prompt) rows[prompt.top] = nativeRow(native.left, undefined,
    p.inside ? p.anchor === 'prompt' : configuration.placement === 'header');
  for (const region of plan.regions) if (region.kind === 'railGap' || region.kind === 'railEdge' || region.kind === 'contextRail') rows[region.top] = '';
  for (const slot of geometry.slots) {
    const content = contentRows[slot.index] ?? '';
    const rule = p.inside && p.anchor === 'rail' && slot.top === geometry.edgeRow;
    if (p.relation === 'vertical') rows[slot.top] = !content && !rule ? '' : fill(content, rule, p.mirrored);
    else {
      const main = slot.top === prompt?.top ? native.left : slot.top >= (input?.top ?? Infinity) && slot.top < (input?.top ?? 0) + (input?.height ?? 0) ? rows[slot.top] ?? '' : '';
      rows[slot.top] = nativeRow(main, content, rule || p.inside && p.anchor === 'prompt' && slot.top === prompt?.top, slot.top === (prompt?.top ?? input?.top));
    }
  }
  if (p.relation === 'right' && !p.inside && p.width) {
    for (const region of plan.regions) if (region.kind === 'composerBorder' || region.kind === 'separator')
      rows[region.top] = divider(Math.max(0, p.column - p.gap));
  }
  if (p.inside && (p.anchor === 'above' || plan.regions.some(region => region.kind === 'railEdge' && region.top === geometry.edgeRow)))
    rows[geometry.edgeRow] = divider(width);
  const finish = () => { if (colorLevel() === 'none') for (let row = geometry.start; row < geometry.end; row++) rows[row] = stripAnsi(rows[row] ?? ''); };
  finish();
}

/** Preview compiles the same regions and painter, with an explicit synthetic input. */
export function railCompositionPreview(context: PromptContext, columns: number, configuration: PromptConfiguration, time = 0): string[] {
  const prepared = prepareRail(context, columns, configuration, time);
  const p = prepared.presentation;
  const parts = buildContextParts(context, columns, configuration, time);
  const plan = planScreen({rows: 16, inputRows: 1, suggestions: 0, running: false, detached: false, hasOutput: false,
    contextPlacement: configuration.placement, composerLayout: configuration.composerLayout, composerPosition: configuration.composerPosition,
    composerDividers: configuration.composerDividers, hasVisibleContext: Boolean(parts.left || parts.right), transcriptRows: 0,
    railPresentation: prepared.presentation});
  const rows = Array<string>(plan.rows).fill('');
  const input = regionOf(plan, 'input');
  if (input) {
    const prefix = configuration.composerLayout === 'oneLine' ? buildInlineContextPrefix(context, p.editorColumns, configuration) : `${GLYPHS.prompt} `;
    rows[input.top] = `${prefix}echo hello`;
    if (configuration.composerLayout === 'oneLine' && p.relation !== 'right') {
      const line = rows[input.top]!;
      const right = buildRightContext(context, columns - displayWidth(line) - 2, configuration, time);
      if (right) rows[input.top] += RESET + ' '.repeat(Math.max(0, columns - displayWidth(line) - displayWidth(right))) + right + RESET;
    }
  }
  const rule = `${paintDivider(repeatToWidth(GLYPHS.separator, columns), configuration.presentation, time)}${RESET}`;
  for (const region of plan.regions) {
    if (region.kind === 'composerBorder' || region.kind === 'separator') rows[region.top] = rule;
    if (region.kind === 'prompt') rows[region.top] = `${parts.left}${RESET}${' '.repeat(Math.max(0, columns-displayWidth(parts.left)-displayWidth(parts.right)))}${parts.right}`;
  }
  paintRailComposition(rows, plan, prepared, context, columns, configuration, time);
  const visible = plan.regions.filter(region => ['prompt','input','separator','composerBorder','contextRail','railGap','railEdge'].includes(region.kind));
  return visible.length ? rows.slice(Math.min(...visible.map(r=>r.top)), Math.max(...visible.map(r=>r.top+r.height))) : [];
}
