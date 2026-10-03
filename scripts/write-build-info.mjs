import {execFileSync} from 'node:child_process';
import {copyFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = join(root, 'dist');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let commit = 'unknown';
let branch;
let dirty = false;

try {
  commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  branch = execFileSync('git', ['branch', '--show-current'], {cwd: root, encoding: 'utf8'}).trim() || undefined;
  dirty = Boolean(execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim());
} catch {
  commit = 'unknown';
  branch = undefined;
  dirty = false;
}

await mkdir(outputDirectory, {recursive: true});
await mkdir(join(outputDirectory, 'shell'), {recursive: true});
for (const name of ['capture.zsh', 'configured-completion.zsh', 'configured-widget.zsh']) {
  await copyFile(join(root, 'src/shell', name), join(outputDirectory, 'shell', name));
}
await writeFile(join(outputDirectory, 'build-info.json'), `${JSON.stringify({
  version: typeof packageJson.version === 'string' ? packageJson.version : 'unknown',
  commit,
  ...(branch ? {branch} : {}),
  ...(dirty ? {dirty: true} : {}),
}, null, 2)}\n`, {encoding: 'utf8', mode: 0o644});
