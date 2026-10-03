import {resolveHostCapabilities} from '../host/capabilities.js';

/** NMSh-owned colors; explicit settings win over host defaults. PTY SGR is untouched. */
export type ColorLevel = 'none' | 'ansi16' | 'ansi256' | 'truecolor';

export function colorLevel(env: NodeJS.ProcessEnv = process.env): ColorLevel {
  const override = env.NMSH_COLOR?.toLowerCase();
  if (override === '0' || override === 'none' || override === 'off') return 'none';
  if (override === '16') return 'ansi16';
  if (override === '256') return 'ansi256';
  if (override === 'truecolor') return 'truecolor';
  if (env.NO_COLOR) return 'none';
  if (env.TERM === 'dumb') return 'none';
  if (resolveHostCapabilities(env).truecolor) return 'truecolor';
  return /256color/u.test(env.TERM ?? '') ? 'ansi256' : 'ansi16';
}
