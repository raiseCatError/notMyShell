import {spawnSync} from 'node:child_process';

/**
 * Output post-processing on NMSh's own terminal while a foreground program owns it.
 *
 * Node's raw mode (libuv UV_TTY_MODE_RAW) keeps OPOST and explicitly turns on
 * ONLCR, so the kernel rewrites every bare LF NMSh writes as CR LF. NMSh's own
 * frames never depend on that, but a program's bytes forwarded in passthrough
 * do: a TUI in raw mode (cfmakeraw: OPOST off) uses a bare LF to move down one
 * row in the same column. Rewritten, every such move also returned to column 1
 * (measured with agy in Ghostty: typed characters overwrote its prompt marker
 * and suggestion prefixes, and the cursor jumped on each redraw). While a
 * program owns the terminal, output processing is therefore off, so its bytes
 * reach the terminal exactly as written, as from a plain shell.
 */
export class TerminalOutputProcessing {
  private raw = false;

  constructor(private readonly stty: (args: string[]) => void = defaultStty) {}

  /** `true`: pass bytes through untouched (the program owns the terminal); `false`: NMSh's raw-mode default. */
  set(raw: boolean, force = false): void {
    if (raw === this.raw && !force) return;
    this.raw = raw;
    this.stty([raw ? '-opost' : 'opost']);
  }

  /** Something else (setRawMode) re-applied the terminal's settings; they now have output processing on. */
  reapplied(): void {
    this.raw = false;
  }

  get passingThrough(): boolean {
    return this.raw;
  }
}

function defaultStty(args: string[]): void {
  if (!process.stdin.isTTY) return;
  // stty acts on its standard input, the terminal NMSh is drawing on. Synchronous so that the next bytes
  // written to the terminal already pass untouched. Failure leaves the terminal as it was.
  try { spawnSync('stty', args, {stdio: ['inherit', 'ignore', 'ignore'], timeout: 2000}); } catch { /* unchanged */ }
}
