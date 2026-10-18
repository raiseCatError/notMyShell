import {mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync} from 'node:fs';
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
  for (const target of grave ? [grave, path] : [path]) {
    if (!removeTree(target)) {
      setTimeout(() => { try { rmSync(target, {recursive: true, force: true}); } catch { /* Best effort. */ } }, 100).unref();
    }
  }
}

/**
 * Remove a directory tree while another remover may be deleting inside it. A remover that already holds the directory
 * open (`rm -rf` works through directory descriptors, so it follows a rename) makes entries vanish mid-walk, and one
 * rmSync then stops early without an error. Each pass removes what is listed, tolerating what vanished, and retries
 * the directory itself while it is not empty; nothing can add entries (its path is gone), so every pass shrinks it.
 */
function removeTree(target: string): boolean {
  for (let pass = 0; pass < 50; pass += 1) {
    let names: string[];
    try { names = readdirSync(target); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return true;
      if (code !== 'ENOTDIR') return false;
      try { rmSync(target, {force: true}); return true; } catch { return false; }
    }
    for (const name of names) {
      try { rmSync(join(target, name), {recursive: true, force: true}); } catch { /* Vanished or retried next pass. */ }
    }
    try { rmdirSync(target); return true; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return true;
      if (code !== 'ENOTEMPTY' && code !== 'EEXIST' && code !== 'EBUSY') return false;
    }
  }
  return false;
}
