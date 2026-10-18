import {existsSync, mkdtempSync, renameSync, rmSync} from 'node:fs';
import {basename, dirname, join} from 'node:path';

/**
 * Remove a private directory that helper processes may still be writing into or removing themselves. `rmSync` alone is
 * not enough then: a file created during its walk made it throw ENOTEMPTY, and on Linux a concurrent `rm -rf` made it
 * return with the directory still there. Renaming the directory away first (atomic, same filesystem) leaves no path to
 * it for anyone to write into, so the path is gone when this returns; the renamed copy is then removed. Never throws.
 */
export function removeDirectoryNow(path: string): void {
  let grave: string | undefined;
  try {
    grave = mkdtempSync(join(dirname(path), `${basename(path)}-gone-`));
    renameSync(path, join(grave, 'directory'));
  } catch { /* Already gone, or not movable: removed where it is below. */ }
  for (const target of grave ? [grave, path] : [path]) removeAll(target);
}

function removeAll(target: string): void {
  // A remover that already holds the directory open (`rm -rf` works through directory descriptors, so it follows the
  // rename) can make one rmSync stop early without an error; another pass finishes what is left.
  for (let pass = 0; pass < 5; pass += 1) {
    try { rmSync(target, {recursive: true, force: true, maxRetries: 3, retryDelay: 5}); } catch { /* Another pass. */ }
    if (!existsSync(target)) return;
  }
  setTimeout(() => { try { rmSync(target, {recursive: true, force: true}); } catch { /* Best effort. */ } }, 100).unref();
}
