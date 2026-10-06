import {isAbsolute, join, resolve} from 'node:path';
import {defineCapability, type CapabilityDefinition} from '../capability.js';
import {isDirectory, LARGE_METADATA_BYTES, parseIniData, readMetadataText, text} from '../services.js';

/**
 * Richer Git facts beyond the existing Rich Git status, read as plain files
 * from the repository's Git directory on demand: the stash depth and the
 * configured upstream. Repository configuration is hostile data here; it is
 * parsed, never interpreted, and nothing is executed.
 */

export interface GitExtrasFact {stash?: number; upstream?: string}

async function gitDirectories(root: string): Promise<{gitDir: string; commonDir: string} | undefined> {
  const dotGit = join(root, '.git');
  let gitDir: string | undefined;
  if (await isDirectory(dotGit)) gitDir = dotGit;
  else {
    const pointer = /^gitdir:\s*(.{1,4096})$/mu.exec(await readMetadataText(dotGit, 8192) ?? '')?.[1]?.trim();
    if (pointer) gitDir = isAbsolute(pointer) ? pointer : resolve(root, pointer);
  }
  if (!gitDir) return undefined;
  const common = (await readMetadataText(join(gitDir, 'commondir'), 4096))?.trim();
  return {gitDir, commonDir: common ? (isAbsolute(common) ? common : resolve(gitDir, common)) : gitDir};
}

export const gitExtras = defineCapability<GitExtrasFact>({
  id: 'vcs.git', title: 'Git stash and upstream',
  reads: ['.git/logs/refs/stash (line count)', '.git/HEAD and the branch section of .git/config'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['stash', 'upstream'], env: [], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {stash: 2, upstream: 'origin/main'},
  async resolve(context) {
    if (!context.root) return undefined;
    const directories = await gitDirectories(context.root);
    if (!directories) return undefined;
    const value: GitExtrasFact = {};
    if (context.fields.has('stash')) {
      const log = await readMetadataText(join(directories.commonDir, 'logs', 'refs', 'stash'), LARGE_METADATA_BYTES);
      const count = log === undefined ? 0 : log.split('\n').filter(Boolean).length;
      if (count) value.stash = count;
    }
    if (context.fields.has('upstream')) {
      const branch = /^ref:\s*refs\/heads\/(.{1,255})$/mu.exec(await readMetadataText(join(directories.gitDir, 'HEAD'), 4096) ?? '')?.[1]?.trim();
      const config = branch ? parseIniData(await readMetadataText(join(directories.commonDir, 'config'), LARGE_METADATA_BYTES)) : undefined;
      const section = branch ? config?.get(`branch "${branch}"`) : undefined;
      const remote = text(section?.get('remote'), 128), merge = text(section?.get('merge'), 255)?.replace(/^refs\/heads\//u, '');
      if (remote && merge) value.upstream = remote === '.' ? merge : `${remote}/${merge}`;
    }
    return Object.keys(value).length ? {value, evidence: 'Git directory files'} : undefined;
  },
});

export const VCS_CAPABILITIES = [gitExtras] as CapabilityDefinition<unknown>[];
