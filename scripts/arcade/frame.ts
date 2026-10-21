/**
 * One deterministic Vespyr Arcade frame, for visual review:
 *
 *   npx tsx scripts/arcade/frame.ts [--game <id>] [--keys down,down,enter,w] [--advance 1200] [--reduced] [--nocolor] [--safe]
 *                                   [--cols 120 --rows 36] [--records '{"run":{"best":1240}}'] [--hub '{"favorites":["sudoku"]}']
 *
 * The clock, seed and date are fixed and the scores live in a throwaway directory (never your own arcade.json), so the
 * same arguments draw the same frame. Keys are applied in order, each followed by `--step` ms of frames; then `--advance`
 * ms more. Run directly, it draws the frame on the alternate screen and holds it until a key; `scripts/arcade/shots.ts`
 * imports `arcadeFrame` to photograph frames.
 */
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ArcadeSession} from '../../src/arcade/ArcadeSession.js';
import {ARCADE_GAMES, findGame} from '../../src/arcade/registry.js';
import {ArcadeStore, ARCADE_FILE} from '../../src/arcade/scores.js';
import type {Key} from '../../src/terminal/keys.js';

export interface FrameOptions {
  columns: number;
  rows: number;
  game?: string;
  keys?: string[];
  step?: number;
  advance?: number;
  reduced?: boolean;
  nocolor?: boolean;
  safe?: boolean;
  seed?: number;
  today?: string;
  records?: Record<string, unknown>;
  hub?: Record<string, unknown>;
}

const NAMED: Record<string, Key> = {
  up: {kind: 'up'}, down: {kind: 'down'}, left: {kind: 'left'}, right: {kind: 'right'}, enter: {kind: 'enter'}, esc: {kind: 'escape'},
  tab: {kind: 'complete'}, space: {kind: 'text', value: ' '}, backspace: {kind: 'backspace'}, comma: {kind: 'text', value: ','},
};

/** The ANSI rows of one frame. */
export function arcadeFrame(options: FrameOptions): string[] {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '.', 'arcade-frame-'));
  try {
    if (options.records || options.hub) writeFileSync(join(dir, ARCADE_FILE), JSON.stringify({version: 2, games: options.records ?? {}, ...(options.hub ? {hub: options.hub} : {})}));
    let now = 1_760_000_000_000;
    const store = new ArcadeStore({directory: dir, now: () => now});
    const session = new ArcadeSession({
      store, now: () => now, seed: () => options.seed ?? 42, today: () => options.today ?? '2026-10-21',
      motion: () => ({reduced: Boolean(options.reduced), effects: options.reduced ? 'subtle' : 'normal'}),
      color: () => (options.nocolor ? 'none' : 'truecolor'), safeGlyphs: () => Boolean(options.safe),
    }, ARCADE_GAMES, {columns: options.columns, rows: options.rows}, options.game ? findGame(options.game) : undefined);
    const tick = (ms: number) => { for (let left = ms; left > 0; left -= 33) { now += Math.min(33, left); session.frame(Math.min(33, left)); } };
    for (const name of options.keys ?? []) { session.key(NAMED[name] ?? {kind: 'text', value: name}); tick(options.step ?? 120); }
    tick(options.advance ?? 300);
    const rows = session.render().rows;
    session.dispose();
    return rows;
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };
  const flag = (name: string): boolean => args.includes(`--${name}`);
  const rows = arcadeFrame({
    columns: Number(option('cols') ?? process.stdout.columns ?? 120), rows: Number(option('rows') ?? process.stdout.rows ?? 36),
    ...(option('game') ? {game: option('game')!} : {}), keys: (option('keys') ?? '').split(',').filter(Boolean),
    step: Number(option('step') ?? 120), advance: Number(option('advance') ?? 300), reduced: flag('reduced'), nocolor: flag('nocolor'), safe: flag('safe'),
    ...(option('records') ? {records: JSON.parse(option('records')!)} : {}), ...(option('hub') ? {hub: JSON.parse(option('hub')!)} : {}),
  });
  process.stdout.write(`\u001b[?1049h\u001b[?25l\u001b[H\u001b[2J${rows.map((row, index) => `\u001b[${index + 1};1H${row}`).join('')}`);
  const finish = () => { process.stdout.write('\u001b[?25h\u001b[?1049l'); process.exit(0); };
  if (process.stdin.isTTY) { process.stdin.setRawMode(true); process.stdin.once('data', finish); }
  setTimeout(finish, Number(option('hold') ?? 60_000));
}
