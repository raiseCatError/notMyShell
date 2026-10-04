import {spawnSync} from 'node:child_process';

/**
 * Optional TLDR examples through tealdeer's raw (markdown) output: practical
 * examples only, never installation state, identity or safety. Absent,
 * uncached or malformed pages simply mean "no examples".
 */

export interface TldrExample {description: string; command: string}

/** Parse a TLDR page: "- description:" followed by "`command`"; {{placeholders}} become <placeholders>. */
export function parseTldrPage(markdown: string, root: string, limit = 8): TldrExample[] {
  const examples: TldrExample[] = [];
  const lines = markdown.split('\n').map(line => line.trim());
  for (let index = 0; index < lines.length && examples.length < limit; index += 1) {
    const description = /^- (.+?):?$/u.exec(lines[index]!)?.[1];
    if (!description) continue;
    let next = index + 1;
    while (next < lines.length && !lines[next]) next += 1;
    const command = /^`([^`]+)`$/u.exec(lines[next] ?? '')?.[1];
    if (!command) continue;
    const rendered = command.replace(/\{\{(.+?)\}\}/gu, (_, name: string) => `<${name.replace(/[<>]/gu, '')}>`);
    // Only examples of this command: its own name first, nothing else.
    if (rendered.split(/\s+/u)[0] !== root || /[\u0000-\u001f\u007f]/u.test(rendered)) continue;
    examples.push({description: description.slice(0, 120), command: rendered.slice(0, 200)});
    index = next;
  }
  return examples;
}

/** Examples for a command path from an installed tldr client (bounded; no ANSI: raw output only). */
export function tldrExamples(tldr: string | undefined, path: readonly string[]): TldrExample[] {
  if (!tldr || !path.length || !path.every(word => /^[\w.+-]{1,64}$/u.test(word))) return [];
  const result = spawnSync(tldr, ['--raw', ...path], {encoding: 'utf8', timeout: 2000, maxBuffer: 256 * 1024, env: {...process.env, NO_COLOR: '1'}});
  if (result.status !== 0 || !result.stdout) return [];
  return parseTldrPage(result.stdout, path[0]!);
}
