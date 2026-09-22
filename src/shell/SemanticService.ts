import { spawn } from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export type CommandType = 'executable' | 'builtin' | 'alias' | 'function' | 'reserved' | 'unknown';

export class SemanticService {
  private child: ReturnType<typeof spawn>;
  private pending = new Map<number, (result: CommandType) => void>();
  private nextId = 0;
  public cache = new Map<string, CommandType>();
  private buffer = '';
  private zdotdir: string;

  constructor(cwd: string) {
    const home = process.env.HOME || '';
    this.zdotdir = mkdtempSync(join(tmpdir(), 'nmsh-semantic-'));

    writeFileSync(join(this.zdotdir, '.zshenv'), `
if [[ -f "${home}/.zshenv" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshenv"
fi
`);

    writeFileSync(join(this.zdotdir, '.zprofile'), `
if [[ -f "${home}/.zprofile" ]]; then
  ZDOTDIR="${home}" source "${home}/.zprofile"
fi
`);

    writeFileSync(join(this.zdotdir, '.zshrc'), `
unsetopt zle
export POWERLEVEL9K_DISABLE_PROMPT=true
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache}/nmsh-disabled"
PROMPT=""
RPROMPT=""
PS1=""
PS2=""

if [[ -f "${home}/.zshrc" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshrc"
fi

# Re-enforce clean environment
unsetopt zle
PROMPT=""
RPROMPT=""
PS1=""
`);

    // Use detached: true for setsid-style isolation to prevent TTIN/TTOU and controlling terminal access
    this.child = spawn('zsh', ['-i'], {
      cwd,
      env: {
        ...process.env,
        ZDOTDIR: this.zdotdir,
      },
      stdio: ['pipe', 'pipe', 'ignore'],
      detached: true
    });

    this.child.stdin!.write(`
while read -r id cmd; do
  res=$(whence -w "$cmd" 2>/dev/null)
  if [[ -z "$res" ]]; then
    echo "$id none"
  else
    echo "$id \${res#*: }"
  fi
done\n`);

    this.child.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf8');
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const space = line.indexOf(' ');
        if (space === -1) continue;
        const idStr = line.substring(0, space);
        const result = line.substring(space + 1).trim();
        // no debug log
        const id = parseInt(idStr, 10);
        if (isNaN(id)) continue;

        let type: CommandType = 'unknown';
        if (result === 'command') type = 'executable';
        else if (result === 'builtin') type = 'builtin';
        else if (result === 'alias') type = 'alias';
        else if (result === 'function') type = 'function';
        else if (result === 'reserved') type = 'reserved';
        
        const resolve = this.pending.get(id);
        if (resolve) {
          this.pending.delete(id);
          resolve(type);
        }
      }
    });
  }

  async classifyCommand(cmd: string): Promise<CommandType> {
    if (!cmd || cmd.trim().length === 0) return 'unknown';
    // Only classify the first word if it has spaces
    cmd = cmd.split(' ')[0];
    
    if (this.cache.has(cmd)) {
      return this.cache.get(cmd)!;
    }

    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, (res) => {
        this.cache.set(cmd, res);
        resolve(res);
      });
      // Safety: cmd should not contain newlines or null bytes
      const safeCmd = cmd.replace(/[\r\n\0]/g, '');
      this.child.stdin!.write(`${id} ${safeCmd}\n`);
    });
  }
  
  kill() {
    this.child.stdin?.end();
    this.child.kill('SIGKILL');
    if (this.zdotdir) {
      try {
        rmSync(this.zdotdir, { recursive: true, force: true });
      } catch (e) {
        // ignore
      }
      this.zdotdir = '';
    }
  }
}
