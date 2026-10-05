import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/**
 * Points NMSh configuration at a private temporary directory for the life of
 * a test, so an app under test can never read or write the user's real
 * settings. Call `restore()` in the test's cleanup.
 */
export function isolateConfig(): {directory: string; restore: () => void} {
  const directory = mkdtempSync(join(tmpdir(), 'nmsh-test-config-'));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = directory;
  return {directory, restore: () => {
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    rmSync(directory, {recursive: true, force: true});
  }};
}
