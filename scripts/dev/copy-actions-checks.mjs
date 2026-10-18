/** Focused private-home checks; never expands file arguments into the canonical suite. */
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {runTestFiles} from '../test.mjs';

// Unix-domain socket paths are bounded. Keep this run's root short on the same verified external volume.
if (process.env.T7_STORAGE_ROOT) {
  const root = mkdtempSync(join(process.env.T7_STORAGE_ROOT, 'runs', 's3-'));
  process.env.NMSH_TEST_TMPDIR = root;
  process.env.TMPDIR = root;
  console.error(`Scratch: ${root}`);
}
const files = process.argv.slice(2);
if (!files.length || files.some(file => !/^tests\/[\w/.-]+\.test\.ts$/u.test(file))) throw new Error('Pass explicit tests/*.test.ts files');
process.exitCode = (await runTestFiles(files, ['--test-concurrency=1'])).code;
