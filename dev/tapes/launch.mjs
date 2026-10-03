import {spawn} from 'node:child_process';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

// Isolate demo preferences and zsh startup; never change the user's config.
const root = mkdtempSync(join(tmpdir(), 'nmsh-demo-'));
const config = join(root, 'config', 'nmsh');
mkdirSync(config, {recursive: true});
writeFileSync(join(config, 'config.json'), JSON.stringify({onboardingComplete: true,
  glyphChoiceComplete: true, glyphStyle: 'safe', welcome: 'vespyr', updateChecks: false,
  liveSessionStartup: 'never', composerPosition: 'bottom', transcriptPresentation: 'normal'}));
try {
  const child = spawn(process.execPath, [resolve('dist/index.js'), '--new'], {stdio: 'inherit',
    env: {...process.env, HOME: root, XDG_CONFIG_HOME: join(root, 'config'),
      NMSH_DETERMINISTIC: '1', NMSH_SESSION_SERVICE: '0'}});
  const forward = () => child.kill('SIGTERM');
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  try {
    process.exitCode = await new Promise((accept, reject) => {
      child.once('error', reject);
      child.once('exit', code => accept(code ?? 1));
    });
  } finally {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
  }
} finally {
  rmSync(root, {recursive: true, force: true});
}
