import {homedir} from 'node:os';
import {promptConfigurationPath} from '../configuration/paths.js';
import {detectPlatform} from '../host/platform.js';
import {detectTerminalHost} from '../host/terminalHost.js';
import {defaultRuntimeDir} from '../session/runtimeDir.js';
import {detectShellEnvironment, OWNERSHIP_NOTE, shellEnvironmentRows} from '../shell/ShellEnvironment.js';
import {loadPromptConfiguration} from '../prompt/configuration.js';
import {formatBuildIdentity, readBuildIdentity} from '../buildInfo.js';

/**
 * `nmsh doctor`: a short, paste-able diagnostic for issue reports. No secrets,
 * no environment dump, no command history; paths are shown with ~ for home.
 */
export function doctorReport(env: NodeJS.ProcessEnv = process.env, extra: Array<[string, string]> = []): string {
  const home = homedir();
  const tilde = (path: string) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
  const platform = detectPlatform();
  const host = detectTerminalHost(env);
  const config = loadPromptConfiguration();
  const rows: Array<[string, string]> = [
    ['NMSh', formatBuildIdentity(readBuildIdentity())],
    ['Node', process.version],
    ['Platform', `${process.platform} ${process.arch} · kernel ${platform.kernel}`],
    ['Support', platform.support],
    ['Terminal host', host.name || 'not identified'],
    ['Host capabilities', Object.entries(host.capabilities).filter(([, value]) => value === true).map(([key]) => key).join(', ') || 'baseline'],
    ...extra,
    ['Prompt provider', config.provider],
    ['History provider', config.history],
    ['Navigation provider', config.navigation],
    ['Picker provider', config.picker],
    ['Session notices', config.sessionNotices ? 'On' : 'Off'],
    ['Agent activity', config.agentActivity ? 'On (local only)' : 'Off'],
    ...shellEnvironmentRows(detectShellEnvironment()),
    ['Config file', tilde(promptConfigurationPath(env))],
    ['Runtime directory', tilde(defaultRuntimeDir(env))],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return `${rows.map(([label, value]) => `${label.padEnd(width)}${value.replace(/[\u0000-\u001f\u007f]/gu, ' ')}`).join('\n')}\n\n${OWNERSHIP_NOTE}\n`;
}
