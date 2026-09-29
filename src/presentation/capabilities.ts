/**
 * Terminal color capability for NMSh-owned UI. Only explicit signals lower the
 * level; without one NMSh keeps its truecolor behavior. Raw PTY output is never
 * affected: this applies to colors NMSh itself emits.
 */
export type ColorLevel = 'none' | 'truecolor';

export function colorLevel(env: NodeJS.ProcessEnv = process.env): ColorLevel {
  const override = env.NMSH_COLOR?.toLowerCase();
  if (override === '0' || override === 'none' || override === 'off') return 'none';
  if (override === 'truecolor') return 'truecolor';
  if (env.NO_COLOR) return 'none';
  if (env.TERM === 'dumb') return 'none';
  return 'truecolor';
}
