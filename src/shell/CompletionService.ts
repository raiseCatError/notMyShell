import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface CompletionCandidate {
  name: string;
  insertion: string;
  description: string;
}

export class CompletionService {
  private activeRequest: ReturnType<typeof execFile> | undefined;

  async suggest(input: string, cwd: string): Promise<CompletionCandidate[]> {
    if (!input || input.trim().length === 0) return [];
    
    if (this.activeRequest) {
      this.activeRequest.kill();
    }

    return new Promise((resolve) => {
      const script = join(__dirname, 'capture.zsh');
      const proc = execFile('zsh', [script, input], { cwd, env: process.env }, (error, stdout) => {
        if (error && error.signal === 'SIGTERM') {
          resolve([]);
          return;
        }
        if (!stdout) {
          resolve([]);
          return;
        }

        const lines = stdout.split('\n').filter(l => l.trim().length > 0);
        const candidates: CompletionCandidate[] = [];
        
        const lastSpace = input.lastIndexOf(' ');
        const base = lastSpace === -1 ? '' : input.substring(0, lastSpace + 1);

        for (const line of lines) {
          const splitIndex = line.indexOf(' -- ');
          if (splitIndex !== -1) {
            const name = line.substring(0, splitIndex).trim();
            const desc = line.substring(splitIndex + 4).trim();
            candidates.push({ name, insertion: base + name, description: desc });
          } else {
            const name = line.trim();
            candidates.push({ name, insertion: base + name, description: '' });
          }
        }
        resolve(candidates);
      });
      this.activeRequest = proc;
    });
  }
}
