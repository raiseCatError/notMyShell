import {inspectCommand, type InspectorContext} from './CommandKnowledge.js';
import {truncateText} from '../util/text.js';
export {inspectCommand};

/** Plain presentation is deterministic and safe under all glyph/color policies. */
export function renderInspector(context: InspectorContext | undefined, width: number): string[] {
  if (!context || width < 1) return [];
  const title = `${context.kind === 'option' ? 'flag' : context.kind}: ${context.value}`;
  if (width < 32) return [truncateText(`${title} - ${context.description}`, width)];
  return [truncateText(`Inspect ${title}`, width),
    truncateText(`${context.description}${context.usage ? ` | ${context.usage}` : ''}`, width)];
}
