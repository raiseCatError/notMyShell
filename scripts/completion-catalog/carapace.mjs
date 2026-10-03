// Static extractor for carapace-sh/carapace-bin completers (MIT).
//
// Reads Go source as text and recognizes only literal cobra declarations:
//   var xCmd = &cobra.Command{Use: "...", Short: "...", Aliases: []string{...}, Hidden: true}
//   parent.AddCommand(child, ...)
//   x.Flags()/PersistentFlags().<Kind>[P|S]("long", ["short",] default, "description")
//   "flag": carapace.ActionValues("a", "b") / ActionValuesDescribed("a", "desc", ...) / ActionFiles() / ActionDirectories()
//   PositionalCompletion(carapace.ActionValues(...))
// Callbacks, computed values and anything else are skipped and counted.
// Nothing is compiled or executed.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

const STRING = '"((?:[^"\\\\]|\\\\.)*)"';
const unquote = value => value.replace(/\\(.)/gu, '$1');
const clean = value => value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 300);

/** The `{...}` body starting at `open` (index of '{'), respecting strings and backquotes. */
function block(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' || char === '`') {
      const close = char;
      for (index += 1; index < text.length && text[index] !== close; index += 1) if (close === '"' && text[index] === '\\') index += 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return text.slice(open + 1, index);
  }
  return '';
}

function stringField(body, field) {
  const match = new RegExp(`(?:^|\\n)\\s*${field}:\\s*(?:${STRING}|\`([^\`]*)\`)`, 'u').exec(body);
  return match ? unquote(match[1] ?? match[2] ?? '') : undefined;
}

function literalValues(argumentsText) {
  return [...argumentsText.matchAll(new RegExp(STRING, 'gu'))].map(match => unquote(match[1]));
}

/** Extract one completer directory into an NMSh node tree (or undefined). */
export function extractCompleter(directory, stats) {
  const cmdDir = join(directory, 'cmd');
  let files;
  try { files = readdirSync(cmdDir).filter(name => name.endsWith('.go') && !name.endsWith('_test.go')).sort(); } catch { return undefined; }
  const commands = new Map();
  const children = [];
  const sources = files.map(name => readFileSync(join(cmdDir, name), 'utf8'));
  for (const source of sources) {
    for (const match of source.matchAll(/var\s+(\w+)\s*=\s*&cobra\.Command\s*\{/gu)) {
      const body = block(source, match.index + match[0].length - 1);
      const use = stringField(body, 'Use');
      if (!use) continue;
      const aliases = /Aliases:\s*\[\]string\{([^}]*)\}/u.exec(body);
      commands.set(match[1], {
        name: use.split(/\s+/u)[0],
        aliases: aliases ? literalValues(aliases[1]) : [],
        description: clean(stringField(body, 'Short') ?? ''),
        hidden: /(?:^|\n)\s*Hidden:\s*true/u.test(body),
        options: new Map(),
        choices: new Map(),
        positional: [],
      });
    }
  }
  for (const source of sources) {
    for (const match of source.matchAll(/(\w+)\.AddCommand\(([^)]*)\)/gu)) {
      for (const child of match[2].split(',').map(item => item.trim()).filter(Boolean)) children.push([match[1], child]);
    }
    for (const match of source.matchAll(new RegExp(`(\\w+)\\.(Persistent)?Flags\\(\\)\\.([A-Z]\\w*?)([PS]?)\\(${STRING}((?:,\\s*${STRING})?)\\s*,([^\\n]*?),\\s*${STRING}\\s*\\)`, 'gu'))) {
      const command = commands.get(match[1]);
      if (!command) { stats.skipped += 1; continue; }
      const long = unquote(match[5]);
      const shorthandMatch = match[6] ? new RegExp(STRING, 'u').exec(match[6]) : null;
      const shorthand = shorthandMatch ? unquote(shorthandMatch[1]) : undefined;
      // carapace's S suffix: the "long" name is itself a single-dash (non-POSIX) flag.
      const names = match[4] === 'S' ? [`-${long}`] : [`--${long}`, ...(shorthand ? [`-${shorthand}`] : [])];
      const takesValue = !/^(Bool|Count)/u.test(match[3]);
      command.options.set(long, {names, description: clean(unquote(match[9])), takesValue, persistent: Boolean(match[2])});
    }
    for (const match of source.matchAll(/carapace\.Gen\((\w+)\)\.FlagCompletion\(carapace\.ActionMap\{/gu)) {
      const command = commands.get(match[1]);
      const body = block(source, match.index + match[0].length - 1);
      for (const entry of body.matchAll(new RegExp(`${STRING}\\s*:\\s*carapace\\.(ActionValues|ActionValuesDescribed|ActionFiles|ActionDirectories)\\(([^()]*)\\)`, 'gu'))) {
        if (!command) continue;
        const flag = unquote(entry[1]);
        const values = literalValues(entry[3]);
        if (entry[2] === 'ActionFiles') command.choices.set(flag, {t: 'files'});
        else if (entry[2] === 'ActionDirectories') command.choices.set(flag, {t: 'folders'});
        else if (entry[2] === 'ActionValuesDescribed') command.choices.set(flag, {c: pairs(values)});
        else command.choices.set(flag, {c: values.map(value => [value])});
      }
      stats.dynamicFlags += (body.match(/:\s*carapace\.Action(?!Values\(|ValuesDescribed\(|Files\(|Directories\()/gu) ?? []).length
        + (body.match(/:\s*action\./gu) ?? []).length;
    }
    for (const match of source.matchAll(/carapace\.Gen\((\w+)\)\.PositionalCompletion\(\s*carapace\.(ActionValues|ActionValuesDescribed)\(([^()]*)\)/gu)) {
      const command = commands.get(match[1]);
      if (!command) continue;
      const values = literalValues(match[3]);
      command.positional.push(match[2] === 'ActionValuesDescribed' ? pairs(values) : values.map(value => [value]));
    }
  }
  const root = commands.get('rootCmd');
  if (!root) return undefined;
  const childMap = new Map();
  for (const [parent, child] of children) {
    if (!commands.has(child) || child === parent) continue;
    childMap.set(parent, [...(childMap.get(parent) ?? []), child]);
  }
  const build = (variable, seen) => {
    const command = commands.get(variable);
    if (!command || command.hidden || seen.has(variable)) return undefined;
    const next = new Set(seen).add(variable);
    const node = {n: [command.name, ...command.aliases].filter(name => /^[^\s\u0000-\u001f]{1,128}$/u.test(name))};
    if (!node.n.length) return undefined;
    if (command.description) node.d = command.description;
    const subs = (childMap.get(variable) ?? []).map(child => build(child, next)).filter(Boolean).sort((a, b) => a.n[0].localeCompare(b.n[0]));
    if (subs.length) { node.s = subs; stats.subcommands += subs.length; }
    const options = [...command.options.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([long, option]) => {
      const converted = {n: option.names};
      if (option.description) converted.d = option.description;
      const choices = command.choices.get(long);
      if (choices) converted.a = [choices];
      else if (option.takesValue) converted.a = [{}];
      if (option.persistent) converted.p = 1;
      return converted;
    });
    if (options.length) { node.o = options; stats.options += options.length; }
    if (command.positional.length) node.a = command.positional.map(choices => ({c: choices}));
    return node;
  };
  return build('rootCmd', new Set());
}

function pairs(values) {
  const out = [];
  for (let index = 0; index + 1 < values.length; index += 2) out.push(values[index + 1] ? [values[index], clean(values[index + 1])] : [values[index]]);
  return out;
}
