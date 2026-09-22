import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export class HistoryService {
  private history: string[] = [];

  constructor() {
    this.reload();
  }

  reload(): void {
    try {
      const atuin = execFileSync('atuin', ['history', 'list', '--cmd-only'], { encoding: 'utf-8' });
      this.history = atuin.split('\n').filter(line => line.trim().length > 0).reverse();
      return;
    } catch {
      // Fallback to reading zsh history
    }

    try {
      const histFile = process.env.HISTFILE || join(homedir(), '.zsh_history');
      if (existsSync(histFile)) {
        const content = readFileSync(histFile, 'utf-8');
        const lines = content.split('\n');
        const parsed: string[] = [];
        for (const line of lines) {
          const match = line.match(/^:\s*\d+:\d+;(.*)/);
          if (match) {
            parsed.push(match[1]);
          } else if (line.trim().length > 0) {
            parsed.push(line);
          }
        }
        this.history = parsed;
      }
    } catch {
      // Ignore
    }
  }

  getAll(): string[] { return this.history; }
  
  suggest(prefix: string): string | undefined {
    if (!prefix || prefix.trim().length === 0) return undefined;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].startsWith(prefix) && this.history[i] !== prefix) {
        return this.history[i];
      }
    }
    return undefined;
  }
}
