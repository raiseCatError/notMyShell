import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export interface GhosttySettings {
  opacity: number;
  blurMode: BlurMode;
  blurStrength: number;
}

export type BlurMode = 'Off' | 'Numeric' | 'Glass Regular' | 'Glass Clear';

export async function readGhosttySettings(): Promise<GhosttySettings> {
  return { opacity: 0.82, blurMode: 'Numeric', blurStrength: 20 };
}

export type SaveResult = {success: true; hostPath: string; fragmentPath: string} | {success: false; error: string};

export async function detectGhosttyConfigPath(): Promise<string | null> {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config.ghostty'),
    path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config'),
    path.join(xdg, 'ghostty', 'config.ghostty'),
    path.join(xdg, 'ghostty', 'config')
  ];
  
  for (const p of candidates) {
    if (await fileExists(p)) return p;
  }
  return null;
}

export async function saveGhosttySettings(settings: GhosttySettings): Promise<SaveResult> {
  try {
    const configPath = await detectGhosttyConfigPath();
    if (!configPath) return {success: false, error: 'No Ghostty configuration file found (checked macOS and XDG standard paths)'};
    
    const nmshDir = path.join(os.homedir(), '.config', 'nmsh');
    await fs.mkdir(nmshDir, { recursive: true });
    const fragmentPath = path.join(nmshDir, 'ghostty-appearance.conf');
    
    let fragmentContent = `background-opacity = ${settings.opacity}\n`;
    if (settings.blurMode === 'Off') {
      fragmentContent += `background-blur = false\n`;
    } else if (settings.blurMode === 'Numeric') {
      fragmentContent += `background-blur = ${settings.blurStrength}\n`;
    } else if (settings.blurMode === 'Glass Regular') {
      fragmentContent += `background-blur = macos-glass-regular\n`;
    } else if (settings.blurMode === 'Glass Clear') {
      fragmentContent += `background-blur = macos-glass-clear\n`;
    }

    await fs.writeFile(fragmentPath, fragmentContent, 'utf8');

    const currentConfig = await fs.readFile(configPath, 'utf8');
    
    // Ghostty allows absolute path with relative-to-home ? modifier, but standard absolute works too.
    // The user requested exactly `config-file = ?/path`
    const includeLine = `config-file = ?${fragmentPath}`;
    
    if (!currentConfig.includes(includeLine)) {
      await fs.copyFile(configPath, configPath + '.nmsh.bak');
      await fs.appendFile(configPath, `\n${includeLine}\n`, 'utf8');
    }
    
    return {success: true, hostPath: configPath, fragmentPath};
  } catch (e: any) {
    return {success: false, error: e.message || String(e)};
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}
