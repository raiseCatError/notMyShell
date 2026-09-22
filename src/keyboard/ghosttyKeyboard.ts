import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export async function installGhosttyKeybinding(): Promise<{success: boolean; error?: string}> {
  try {
    const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const macConfig = path.join(os.homedir(), 'Library', 'Application Support', 'com.mitchellh.ghostty');
    const possiblePaths = [
      path.join(xdgConfig, 'ghostty', 'config'),
      path.join(xdgConfig, 'ghostty', 'config.ghostty'),
      path.join(macConfig, 'config'),
      path.join(macConfig, 'config.ghostty')
    ];
    let configPath: string | undefined;
    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        configPath = p;
        break;
      } catch {
        // ignore
      }
    }
    if (!configPath) return {success: false, error: 'Ghostty config not found'};

    const currentConfig = await fs.readFile(configPath, 'utf8');
    let newConfig = currentConfig;
    if (!newConfig.endsWith('\n') && newConfig.length > 0) newConfig += '\n';

    const bindings = [
      'keybind = cmd+a=text:\\x1b[97;9u',
      'keybind = cmd+up=text:\\x1b[1;9A',
      'keybind = cmd+down=text:\\x1b[1;9B',
      'keybind = cmd+shift+up=text:\\x1b[1;10A',
      'keybind = cmd+shift+down=text:\\x1b[1;10B'
    ];

    let changed = false;
    for (const bind of bindings) {
      if (!currentConfig.includes(bind)) {
        newConfig += bind + '\n';
        changed = true;
      }
    }
    
    if (!changed) {
       return {success: true}; // Already installed
    }
    
    await fs.writeFile(configPath, newConfig, 'utf8');
    
    return {success: true};
  } catch (err: any) {
    return {success: false, error: err.message};
  }
}
