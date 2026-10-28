import {readHostAppearance} from './hostAppearance.js';
export type {BlurMode, HostAppearanceSettings as GhosttySettings, AppearanceSaveResult as SaveResult} from './hostAppearance.js';

/** Discovery and inspection never mutate host files. Legacy callers share the same canonical reader. */
export async function detectGhosttyConfigPath(): Promise<string | null> {
  const result = readHostAppearance('ghostty');
  return result.settings ? result.hostPath : null;
}
export async function readGhosttySettings() {
  const result = readHostAppearance('ghostty');
  if (!result.settings) throw new Error(result.problems.join(' '));
  return result.settings;
}
