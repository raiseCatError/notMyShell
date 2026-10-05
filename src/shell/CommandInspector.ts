import {inspectCommand, type InspectorContext} from './CommandKnowledge.js';
import type {CommandSource} from './SemanticService.js';
import {TOOLS} from '../tools/catalog.js';
import {slashCommands} from '../commands/slashCommands.js';
import {truncateText} from '../util/text.js';
export {inspectCommand};

/** The curated optional tool an executable name belongs to, if any. */
function curatedTool(name: string | undefined): string | undefined {
  const tool = name ? TOOLS.find(item => item.executable === name) : undefined;
  if (!tool) return undefined;
  return tool.providerFamily ? `optional external ${tool.providerFamily} provider (${tool.label})` : `optional external tool (${tool.label})`;
}

/**
 * What a command word really resolves to in the user's zsh, in plain words.
 * zsh stays authoritative: NMSh never claims a Native `ls` or similar, and an
 * alias shows only the name it starts with, never its body.
 */
export function describeCommandSource(word: string, source: CommandSource | undefined): string {
  if (!source) return 'Resolving in your zsh…';
  const path = source.path;
  switch (source.kind) {
    case 'alias': {
      const target = source.aliasTarget;
      const tool = curatedTool(target);
      return target
        ? `alias → ${target}${path ? ` · ${path}` : ''}${tool ? ` · ${tool}` : ''} (run \`alias ${word}\` to see it)`
        : `alias (definition not shown; run \`alias ${word}\`)`;
    }
    case 'function': return `shell function${path ? ` · shadows executable ${path}` : ''}`;
    case 'builtin': return `zsh builtin${path ? ` · an executable ${path} also exists` : ''}`;
    case 'reserved': return 'zsh reserved word';
    case 'executable': {
      const tool = curatedTool(word);
      return `executable${path ? ` · ${path}` : ''}${tool ? ` · ${tool}` : ''}`;
    }
    case 'missing': return 'not found in your zsh (no alias, function, builtin or executable)';
    default: return 'unknown to your zsh';
  }
}

/** Slash text is an NMSh command, not a shell command. */
export function describeSlashCommand(text: string): string | undefined {
  const name = text.trim().split(/\s+/u)[0];
  const command = slashCommands.find(item => item.name === name || item.name.startsWith(`${name} `));
  return command && command.name.split(' ')[0] === name ? `NMSh slash command · ${command.description}` : undefined;
}

/** Plain presentation is deterministic and safe under all glyph/color policies. */
export function renderInspector(context: InspectorContext | undefined, width: number, source?: string): string[] {
  if (!context || width < 1) return [];
  const title = `${context.kind === 'option' ? 'flag' : context.kind}: ${context.value}`;
  if (width < 32) return [truncateText(`${title} - ${source ?? context.description}`, width)];
  return [truncateText(`Inspect ${title}`, width),
    truncateText(`${context.description}${context.usage ? ` | ${context.usage}` : ''}`, width),
    ...(source ? [truncateText(`Source: ${source}`, width)] : [])];
}
