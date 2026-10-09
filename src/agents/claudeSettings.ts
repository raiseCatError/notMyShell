import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {EFFORT_LEVELS} from './sessions/claudeAdapter.js';

/**
 * The effort level Claude Code would start with for a launch identity and directory, read passively from the settings
 * files Claude documents (user, then project, then local; later wins). Only `effortLevel` is read; nothing is written.
 * Managed (organization) settings and environment overrides are not consulted, so the result is labelled "from Claude
 * settings", never presented as the level in effect.
 */
export async function settingsEffort(configDir: string | undefined, cwd: string): Promise<string | undefined> {
  const user = join(configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'settings.json');
  let found: string | undefined;
  for (const path of [user, join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json')]) {
    try {
      const text = await readFile(path, 'utf8');
      if (text.length > 1024 * 1024) continue;
      const value = (JSON.parse(text) as {effortLevel?: unknown}).effortLevel;
      if (typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value)) found = value;
    } catch { /* absent or unreadable: no fact */ }
  }
  return found;
}
