import {dirname, isAbsolute, join, normalize, resolve} from 'node:path';
import {defineCapability, type CapabilityContext, type CapabilityDefinition} from '../capability.js';
import {isDirectory, isRegularFile, LARGE_METADATA_BYTES, parseIniData, readMetadataText, text, within} from '../services.js';

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

/**
 * The nearest directory holding `marker` (a `.hg` or `.jj` directory), searched upward from the working directory the way
 * Mercurial and Jujutsu find their repositories. The Git-derived repository root does not bound this search (these
 * repositories may have no Git directory); it stops at the home directory when the working directory is below it, and
 * after 32 levels otherwise.
 */
async function nearestRepository(context: Pick<CapabilityContext, 'cwd' | 'home' | 'signal'>, marker: string): Promise<string | undefined> {
  const home = context.home && isAbsolute(context.home) ? normalize(context.home) : undefined;
  let directory = normalize(context.cwd);
  for (let depth = 0; depth < 32 && !context.signal.aborted; depth += 1) {
    if (await isDirectory(join(directory, marker))) return directory;
    // A search that starts below home ends there; one that starts elsewhere (/srv, /opt, a volume) climbs to the filesystem root.
    if ((home && directory === home && within(context.cwd, home)) || dirname(directory) === directory) return undefined;
    directory = dirname(directory);
  }
  return undefined;
}

/** A Mercurial name as Mercurial stores it: one line, bounded; anything else is not a name. */
const hgName = (value: string | undefined): string | undefined => {
  const line = value?.split(/\r?\n/u, 1)[0]?.trim();
  return line && line.length <= 255 ? line : undefined;
};

export interface MercurialFact {branch: string; bookmark?: string}

export const mercurial = defineCapability<MercurialFact>({
  id: 'vcs.hg', title: 'Mercurial branch and bookmark',
  reads: ['the nearest .hg directory: .hg/branch and .hg/bookmarks.current (hg is never run; hgrc and hooks are never read)'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['branch', 'bookmark'], env: [], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {branch: 'default', bookmark: 'feature'},
  async resolve(context) {
    const repository = await nearestRepository(context, '.hg');
    if (!repository) return undefined;
    // No .hg/branch means the default branch: Mercurial writes the file only for a named branch.
    const branch = hgName(await readMetadataText(join(repository, '.hg', 'branch'), 4096)) ?? 'default';
    const bookmark = context.fields.has('bookmark') ? hgName(await readMetadataText(join(repository, '.hg', 'bookmarks.current'), 4096)) : undefined;
    return {value: {branch, ...(bookmark ? {bookmark} : {})}, evidence: '.hg/branch, .hg/bookmarks.current'};
  },
});

export interface JujutsuFact {repository: true; colocated: boolean; workspace?: 'main' | 'secondary'}

export const jujutsu = defineCapability<JujutsuFact>({
  id: 'vcs.jj', title: 'Jujutsu repository',
  reads: ['the nearest .jj directory: whether .jj/repo is the store or points to one (a secondary workspace), and whether Git is colocated; jj is never run and its binary operation log is not parsed'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['repository', 'colocated', 'workspace'], env: [], ttlMs: 10_000, timeoutMs: 1000, invalidateOn: ['command'],
  preview: {repository: true, colocated: true, workspace: 'main'},
  async resolve(context) {
    const repository = await nearestRepository(context, '.jj');
    if (!repository) return undefined;
    // `jj workspace add` writes .jj/repo as a file holding the main workspace's path; the main workspace has the directory.
    const workspace = await isDirectory(join(repository, '.jj', 'repo')) ? 'main' : await isRegularFile(join(repository, '.jj', 'repo')) ? 'secondary' : undefined;
    const colocated = await isDirectory(join(repository, '.git')) || (await readMetadataText(join(repository, '.git'), 8192))?.startsWith('gitdir:') === true;
    return {value: {repository: true, colocated, ...(workspace ? {workspace} : {})}, evidence: '.jj directory'};
  },
});

export const VCS_CAPABILITIES = [gitExtras, mercurial, jujutsu] as CapabilityDefinition<unknown>[];
