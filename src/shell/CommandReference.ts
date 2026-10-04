import {BundledCatalog, type CatalogArg, type CatalogNode, type CatalogOption} from './BundledCatalog.js';
import {completionSpecDirectory} from './CompletionService.js';
import {DeclarativeSpecSource, type DeclarativeSpec} from './CompletionSources.js';
import {localKnowledge} from './CommandKnowledge.js';

/**
 * Read-only command knowledge shared by completion, the inspector and Ask:
 * one lookup over the same facts completion uses (custom specs first, then
 * the bundled catalog, then NMSh's few local facts). Lookups stay lazy: a
 * question about `git push` inflates only git's entries. Nothing here runs a
 * command or guesses from a name; a command it has no facts for is unknown.
 */

export interface ArgFact {name?: string; description?: string; optional: boolean; variadic: boolean; choices?: string[]; path?: 'files' | 'folders'}
export interface OptionFact {names: string[]; description?: string; args: ArgFact[]; persistent: boolean}
export interface SubcommandFact {names: string[]; description?: string}

export interface CommandFacts {
  /** The resolved command path, e.g. ['git', 'push']. */
  path: string[];
  description?: string;
  subcommands: SubcommandFact[];
  /** Own options first, then persistent options inherited from parents. */
  options: OptionFact[];
  args: ArgFact[];
  /** Where the facts came from. */
  source: 'spec' | 'catalog' | 'local';
}

const arg = (value: CatalogArg): ArgFact => ({
  ...(value.n ? {name: value.n} : {}), ...(value.d ? {description: value.d} : {}),
  optional: value.o === 1, variadic: value.v === 1,
  ...(value.c?.length ? {choices: value.c.map(([choice]) => choice)} : {}), ...(value.t ? {path: value.t} : {}),
});
const option = (value: CatalogOption): OptionFact => ({names: value.n, ...(value.d ? {description: value.d} : {}), args: (value.a ?? []).map(arg), persistent: value.p === 1});

function specNode(spec: DeclarativeSpec): CatalogNode {
  return {n: Array.isArray(spec.name) ? spec.name : [spec.name], ...(spec.description ? {d: spec.description} : {}),
    ...(spec.subcommands?.length ? {s: spec.subcommands.map(specNode)} : {}),
    ...(spec.options?.length ? {o: spec.options.map(item => ({n: Array.isArray(item.name) ? item.name : [item.name], ...(item.description ? {d: item.description} : {})}))} : {})};
}

export class CommandReference {
  constructor(private readonly catalog: BundledCatalog = new BundledCatalog(),
    private readonly specs: DeclarativeSpecSource | undefined = new DeclarativeSpecSource(completionSpecDirectory())) {}

  /** Whether any source has facts for this command name. */
  knows(command: string): boolean {
    return Boolean(this.rootNode(command)) || Boolean(localKnowledge(command, command, true));
  }

  private rootNode(command: string): {node: CatalogNode; source: 'spec' | 'catalog'} | undefined {
    const spec = this.specs?.load().get(command);
    if (spec) return {node: specNode(spec), source: 'spec'};
    const node = this.catalog.root(command);
    return node ? {node, source: 'catalog'} : undefined;
  }

  /**
   * Facts for the longest known prefix of `words` (["git", "push", "origin"]
   * resolves git push). `rest` is what did not name a subcommand.
   */
  lookup(words: readonly string[]): {facts: CommandFacts; rest: string[]} | undefined {
    const [command, ...tail] = words;
    if (!command) return undefined;
    const root = this.rootNode(command);
    if (!root) {
      const local = localKnowledge(command, command, true);
      return local ? {facts: {path: [command], description: local.description, subcommands: [], options: [], args: [], source: 'local'}, rest: [...tail]} : undefined;
    }
    let node = this.catalog.resolve(root.node);
    const path = [command];
    const inherited: OptionFact[] = [];
    let index = 0;
    for (; index < tail.length; index += 1) {
      const next = node.s?.find(child => child.n.includes(tail[index]!));
      if (!next) break;
      inherited.push(...(node.o ?? []).filter(item => item.p === 1).map(option));
      node = this.catalog.resolve(next);
      path.push(tail[index]!);
    }
    const own = (node.o ?? []).map(option);
    const seen = new Set(own.flatMap(item => item.names));
    const facts: CommandFacts = {path, ...(node.d ? {description: node.d} : {}),
      subcommands: (node.s ?? []).map(child => ({names: child.n, ...(child.d ? {description: child.d} : {})})),
      options: [...own, ...inherited.filter(item => !item.names.some(name => seen.has(name)))],
      args: (node.a ?? []).map(arg), source: root.source};
    if (!facts.description && path.length === 1) {
      const local = localKnowledge(command, command, true);
      if (local) facts.description = local.description;
    }
    return {facts, rest: tail.slice(index)};
  }

  /** One option of a resolved command (its own or inherited). */
  option(facts: CommandFacts, name: string): OptionFact | undefined {
    const bare = name.split('=')[0]!;
    return facts.options.find(item => item.names.includes(bare));
  }
}

/** Usage built only from facts: `git push [options] [remote] [branch]`. Undefined when nothing beyond the name is known. */
export function syntaxOf(facts: CommandFacts): string | undefined {
  const parts = [...facts.path];
  if (facts.subcommands.length) parts.push('<subcommand>');
  if (facts.options.length) parts.push('[options]');
  for (const item of facts.args) {
    const name = `${item.name ?? 'arg'}${item.variadic ? ' ...' : ''}`;
    parts.push(item.optional ? `[${name}]` : `<${name}>`);
  }
  return parts.length > facts.path.length ? parts.join(' ') : undefined;
}

/** An option's names and its argument placeholder: `-u, --set-upstream`. */
export function optionLabel(item: OptionFact): string {
  const value = item.args[0];
  return `${item.names.join(', ')}${value ? ` <${value.name ?? 'value'}>` : ''}`;
}

/** A small shared instance: lookups are lazy and bounded by the catalog's own LRU. */
let shared: CommandReference | undefined;
export function commandReference(): CommandReference {
  shared ??= new CommandReference();
  return shared;
}
