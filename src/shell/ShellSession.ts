import {randomBytes} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {spawn, type IPty} from 'node-pty';
import {ShellProtocolDecoder, type ShellMarker} from './ShellProtocol.js';

interface SessionEvents {
  data: [string];
  prompt: [ShellMarker];
  exit: [{exitCode: number; signal?: number}];
}

export class ShellSession extends EventEmitter<SessionEvents> {
  private readonly pty: IPty;
  private readonly protocol: ShellProtocolDecoder;
  private ready = false;

  constructor(cwd: string, columns: number, rows: number) {
    super();
    const token = randomBytes(12).toString('hex');
    this.protocol = new ShellProtocolDecoder(token);
    this.pty = spawn('/bin/zsh', ['-f', '-i'], {
      name: process.env.TERM || 'xterm-256color',
      cols: Math.max(2, columns),
      rows: Math.max(2, rows),
      cwd,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        PAGER: 'cat',
        GIT_PAGER: 'cat',
      } as Record<string, string>,
    });

    this.pty.onData(data => this.receive(data));
    this.pty.onExit(event => this.emit('exit', event));

    const setup = [
      'stty -echo',
      "PROMPT=''",
      "RPROMPT=''",
      "PS2=''",
      'unsetopt zle prompt_cr prompt_sp',
      `function nmsh_precmd { local nmsh_status=$?; printf '\\e]777;nmsh;${token};%d;%s\\a' \"$nmsh_status\" \"$PWD\" }`,
      'precmd_functions=(nmsh_precmd)',
    ].join('; ');
    this.pty.write(`${setup}\r`);
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
