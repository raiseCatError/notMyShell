import {shellQuote} from '../host/terminalHost.js';
import {resolveZsh} from './zshExecutable.js';
import { spawn } from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseShellKnowledge} from './ShellKnowledge.js';

export type CommandType = 'executable' | 'builtin' | 'alias' | 'function' | 'reserved' | 'unknown';

export class SemanticService {
  private child: ReturnType<typeof spawn>;
  private pending = new Map<number, (result: CommandType) => void>();
  private nextId = 0;
  public cache = new Map<string, CommandType>();
  private buffer = '';
  private zdotdir: string;
  private generation = 0;
  private shellNames?: Map<string, CommandType>;
  private shellNamesComplete = false;

  applyShellKnowledge(text: string): void {
    this.generation++;
    this.shellNames = parseShellKnowledge(text);
    this.shellNamesComplete = text.split('\n').includes('complete');
    this.cache.clear();
    for (const [name, type] of this.shellNames) this.cache.set(name, type);
    for (const resolve of this.pending.values()) resolve('unknown');
    this.pending.clear();
  }

  constructor(cwd: string) {
    const shell = resolveZsh();
    const home = process.env.HOME || '';
    this.zdotdir = mkdtempSync(join(tmpdir(), 'nmsh-semantic-'));

    writeFileSync(join(this.zdotdir, '.zshenv'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshenv'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshenv'))}
fi
`);

    writeFileSync(join(this.zdotdir, '.zprofile'), `
if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zprofile'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zprofile'))}
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

if [[ -n ${shellQuote(home)} && -f ${shellQuote(join(home, '.zshrc'))} ]]; then
  ZDOTDIR=${shellQuote(home)} source ${shellQuote(join(home, '.zshrc'))}
fi

# Re-enforce clean environment
unsetopt zle
PROMPT=""
RPROMPT=""
PS1=""
`);

    const env: NodeJS.ProcessEnv = { ...process.env, ZDOTDIR: this.zdotdir, TERM: 'dumb' };
    delete env.TERM_PROGRAM;
    delete env.TERM_PROGRAM_VERSION;

    // Use detached: true for setsid-style isolation to prevent TTIN/TTOU and controlling terminal access
    this.child = spawn(shell, ['-i'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
      detached: true
    });

    const handleDead = () => {
      this.kill();
    };

    this.child.on('error', handleDead);
    this.child.on('exit', handleDead);
    this.child.on('close', handleDead);

    this.child.stdin!.on('error', () => { /* ignore EPIPE */ });

    this.child.stdin!.write(`
while builtin read -r id mode cmd; do
  res=$(builtin whence -w -- "$cmd" 2>/dev/null)
  if [[ $mode == plain && ( $res == *': alias' || $res == *': function' ) ]]; then
    if (( $+builtins[$cmd] )); then
      res="$cmd: builtin"
    elif builtin whence -p -- "$cmd" >/dev/null 2>&1; then
      res="$cmd: command"
    else
      res=''
    fi
  fi
  if [[ -z "$res" ]]; then
    builtin printf '%s none\\n' "$id"
  else
    builtin printf '%s %s\\n' "$id" "\${res#*: }"
  fi
done\n`);

    this.child.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString('utf8');
      if (Buffer.byteLength(this.buffer) > 65536) { this.kill(); return; }
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

  private isDead = false;

  async classifyCommand(cmd: string): Promise<CommandType> {
    if (!cmd || cmd.trim().length === 0) return 'unknown';
    // Only classify the first word if it has spaces
    cmd = cmd.split(' ')[0];
    
    if (this.cache.has(cmd)) {
      return this.cache.get(cmd)!;
    }
    if (this.isDead || !this.child.stdin?.writable) return 'unknown';
    if (cmd.length > 1024 || this.pending.size >= 128) return 'unknown';

    const id = this.nextId++;
    const generation = this.generation;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.kill();
        resolve('unknown');
      }, 1500);
      this.pending.set(id, (res) => {
        clearTimeout(timer);
        if (generation !== this.generation) { resolve('unknown'); return; }
        if (this.cache.size >= 8192) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cmd, res);
        resolve(res);
      });
      // Safety: cmd should not contain newlines or null bytes
      const safeCmd = cmd.replace(/[\r\n\0]/g, '');
      try {
        const mode = this.shellNamesComplete && !this.shellNames?.has(cmd) ? 'plain' : 'configured';
        this.child.stdin!.write(`${id} ${mode} ${safeCmd}\n`);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve('unknown');
      }
    });
  }
  
  kill() {
    this.isDead = true;
    try {
      this.child.stdin?.end();
    } catch (e) { /* ignore */ }
    this.child.kill('SIGKILL');
    if (this.child.pid) {
      try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* Already gone. */ }
    }
    for (const resolve of this.pending.values()) {
      resolve('unknown');
    }
    this.pending.clear();
    
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
