import {posixQuote} from '../shell/adapters/ShellAdapter.js';

/**
 * Recipe placeholders: `{{name}}` in a step marks a value asked for when the recipe is used. The value is put into
 * the command as ONE shell word, quoted for the shell that will run it, so it can never add an option, a second
 * command or an expansion. Nothing is taken from the environment, and nothing but the person's answer fills a
 * placeholder.
 */
export const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]{0,31})\}\}/gu;
export const MAX_VALUE_LENGTH = 500;

/** The placeholder names in these steps, in order of first use. */
export function placeholdersIn(steps: readonly string[]): string[] {
  const names: string[] = [];
  for (const step of steps) for (const match of step.matchAll(PLACEHOLDER)) if (!names.includes(match[1]!)) names.push(match[1]!);
  return names;
}

/**
 * A placeholder inside quotes would end up quoted twice. Returns the first such placeholder's name, or undefined.
 * The scan follows shell quoting: single quotes, double quotes and backslashes (a backtick or `$( )` is not tracked,
 * which can only miss, never invent, a problem).
 */
export function quotedPlaceholder(step: string): string | undefined {
  let quote: '"' | '\'' | undefined;
  for (let index = 0; index < step.length; index += 1) {
    const char = step[index]!;
    if (quote === '\'') {
      if (char === '\'') quote = undefined;
      else if (step.startsWith('{{', index)) { const match = /^\{\{([A-Za-z][A-Za-z0-9_]{0,31})\}\}/u.exec(step.slice(index)); if (match) return match[1]; }
      continue;
    }
    if (char === '\\') { index += 1; continue; }
    if (quote === '"') { if (char === '"') { quote = undefined; continue; } }
    else if (char === '"' || char === '\'') { quote = char; continue; }
    if (quote && step.startsWith('{{', index)) { const match = /^\{\{([A-Za-z][A-Za-z0-9_]{0,31})\}\}/u.exec(step.slice(index)); if (match) return match[1]; }
  }
  return undefined;
}

/** Why an answer cannot be used as a command argument, or undefined when it can. */
export function valueProblem(value: string): string | undefined {
  if (!value) return 'Enter a value.';
  if (value.length > MAX_VALUE_LENGTH) return `Keep it under ${MAX_VALUE_LENGTH} characters.`;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return 'It cannot contain line breaks or control characters.';
  if (value.startsWith('-')) return 'It cannot start with "-": the command would read it as an option. Use ./ in front of a file name.';
  return undefined;
}

/** The steps with every placeholder replaced by its quoted value; a placeholder with no value is an error, never left in. */
export function expandSteps(steps: readonly string[], values: Readonly<Record<string, string>>, quote: (value: string) => string = posixQuote): {ok: true; steps: string[]} | {ok: false; reason: string} {
  const expanded: string[] = [];
  for (const step of steps) {
    let missing: string | undefined;
    const text = step.replace(PLACEHOLDER, (_match, name: string) => {
      const value = values[name];
      if (value === undefined || valueProblem(value)) { missing ??= name; return ''; }
      return quote(value);
    });
    if (missing) return {ok: false, reason: `No usable value for {{${missing}}}.`};
    expanded.push(text);
  }
  return {ok: true, steps: expanded};
}
