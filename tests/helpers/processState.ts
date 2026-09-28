import {spawnSync} from 'node:child_process';

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A `sleep` duration unique to this test run, so its process can be found. `tag` must be digits. */
export function uniqueSleep(tag: number | string): string {
  return `30.${process.pid}${tag}`;
}

/**
 * ps state of the process running exactly `sleep <duration>`: `S+` while it is
 * the terminal's foreground job, `T` while stopped, '' when there is none.
 */
export function sleepState(duration: string): string {
  const pid = spawnSync('pgrep', ['-f', `^sleep ${escapeRegex(duration)}$`], {encoding: 'utf8'}).stdout.trim().split('\n')[0];
  if (!pid) return '';
  return spawnSync('ps', ['-o', 'stat=', '-p', pid], {encoding: 'utf8'}).stdout.trim();
}

export const inForeground = (duration: string) => { const state = sleepState(duration); return state.includes('+') && !state.includes('T'); };
export const stopped = (duration: string) => sleepState(duration).includes('T');
