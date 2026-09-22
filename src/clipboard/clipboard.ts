import {spawn} from 'node:child_process';

export interface CopyStats {
  characters: number;
  lines: number;
}

export function copyStats(text: string): CopyStats {
  const characters = Array.from(text).length;
  if (characters === 0) return {characters: 0, lines: 0};
  const withoutOneTrailingNewline = text.replace(/\r?\n$/u, '');
  return {
    characters,
    lines: withoutOneTrailingNewline.split(/\r?\n/u).length,
  };
}

export function copyFeedback(stats: CopyStats, index = 1): string {
  const characterWord = stats.characters === 1 ? 'character' : 'characters';
  const lineWord = stats.lines === 1 ? 'line' : 'lines';
  const target = index === 1 ? 'Copied to clipboard' : `Copied response ${index} to clipboard`;
  return `${target} · ${stats.characters.toLocaleString()} ${characterWord} · ${stats.lines.toLocaleString()} ${lineWord}`;
}

export async function writeClipboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('pbcopy', [], {stdio: ['pipe', 'ignore', 'pipe']});
    let error = '';
    child.stderr.on('data', chunk => {
      error += String(chunk);
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(error.trim() || `pbcopy exited with code ${code}`));
    });
    child.stdin.end(text);
  });
}
