import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, type IPty } from 'node-pty';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShellProtocolDecoder, type ShellMarker } from './ShellProtocol.js';

interface SessionEvents {
  data: [string];
  prompt: [ShellMarker];
  exit: [{ exitCode: number; signal?: number }];
}

export class ShellSession extends EventEmitter<SessionEvents> {
  private readonly pty: IPty;
  private readonly protocol: ShellProtocolDecoder;
  private zdotdir: string;
  private ready = false;

  constructor(cwd: string, columns: number, rows: number) {
    super();
    const token = randomBytes(12).toString('hex');
    this.protocol = new ShellProtocolDecoder(token);

    // Create a temporary ZDOTDIR for bootstrap
    const zdotdir = mkdtempSync(join(tmpdir(), 'nmsh-zdotdir-'));
    const home = process.env.HOME || '';

    // Proxy .zshenv
    writeFileSync(join(zdotdir, '.zshenv'), `
if [[ -f "${home}/.zshenv" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshenv"
fi
`);

    // Proxy .zprofile
    writeFileSync(join(zdotdir, '.zprofile'), `
if [[ -f "${home}/.zprofile" ]]; then
  ZDOTDIR="${home}" source "${home}/.zprofile"
fi
`);

    // Proxy .zshrc
    writeFileSync(join(zdotdir, '.zshrc'), `
# Prevent UI plugins from fighting during bootstrap
unsetopt zle
export POWERLEVEL9K_DISABLE_PROMPT=true
export XDG_CACHE_HOME="\${XDG_CACHE_HOME:-\$HOME/.cache}/nmsh-disabled"

# Suppress fastfetch via TERM
local nmsh_orig_term=\$TERM
if [[ "\$TERM" == "xterm-ghostty" ]]; then
  export TERM="xterm-256color"
fi

if [[ -f "${home}/.zshrc" ]]; then
  ZDOTDIR="${home}" source "${home}/.zshrc"
fi

export TERM=\$nmsh_orig_term

# NMSh specific setup
export NMSH_ACTIVE=1
PROMPT=''
RPROMPT=''
PS2=''
unsetopt zle prompt_cr prompt_sp

function nmsh_precmd {
  local nmsh_status=$?
  stty -echo 2>/dev/null
  printf '\\e]777;nmsh;${token};%d;%s\\a' "\$nmsh_status" "\$PWD"
}

function nmsh_preexec {
  stty echo 2>/dev/null
}

precmd_functions=(nmsh_precmd)
preexec_functions=(nmsh_preexec)

# Background cleanup handled by Node.js
`);

    this.zdotdir = zdotdir;

    this.pty = spawn('/bin/zsh', ['-i'], {
      name: process.env.TERM || 'xterm-256color',
      cols: Math.max(2, columns),
      rows: Math.max(2, rows),
      cwd,
      env: {
        ...process.env,
        ZDOTDIR: zdotdir,
        TERM: process.env.TERM || 'xterm-256color',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      } as Record<string, string>,
    });

    this.pty.onData(data => this.receive(data));
    this.pty.onExit(event => {
      this.cleanup();
      this.emit('exit', event);
    });
  }

  private cleanup(): void {
    if (this.zdotdir) {
      try {
        rmSync(this.zdotdir, { recursive: true, force: true });
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.zdotdir = '';
    }
  }

  submit(command: string): void {
    this.pty.write(`${command}\r`);
  }

  write(data: string): void {
    this.pty.write(data);
  }

  interrupt(): void {
    this.pty.write('\u0003');
  }

  endInput(): void {
    this.pty.write('\u0004');
  }

  resize(columns: number, rows: number): void {
    this.pty.resize(Math.max(2, columns), Math.max(2, rows));
  }

  kill(): void {
    this.cleanup();
    this.pty.kill();
  }

  private receive(data: string): void {
    for (const event of this.protocol.push(data)) {
      if (event.kind === 'data') {
        if (this.ready) this.emit('data', event.data);
      } else if (!this.ready) {
        this.ready = true;
        this.emit('prompt', event.marker);
      } else {
        this.emit('prompt', event.marker);
      }
    }
  }
}
