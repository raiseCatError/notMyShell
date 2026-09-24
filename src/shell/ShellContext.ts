import {execFile} from 'node:child_process';
import {access, readdir} from 'node:fs/promises';
import {basename, normalize} from 'node:path';
import {homedir} from 'node:os';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export interface PromptContext {
  cwd: string;
  project: string;
  branch?: string;
  git?: GitStatus;
  exitStatus?: number;
  /** Toolchains detected from marker files in cwd or the repository root. */
  toolchains?: ToolchainId[];
}

export interface GitStatus {
  staged: number;
  modified: number;
  untracked: number;
  conflicts: number;
  ahead: number;
  behind: number;
  operation?: 'merge' | 'rebase' | 'cherry-pick';
}

export type ToolchainId = 'node' | 'go' | 'python' | 'docker';

const TOOLCHAIN_MARKERS: ReadonlyArray<[ToolchainId, readonly string[]]> = [
  ['node', ['package.json']],
  ['go', ['go.mod']],
  ['python', ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', '.python-version']],
  ['docker', ['Dockerfile', 'compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']],
];

export async function detectToolchains(directories: readonly string[]): Promise<ToolchainId[]> {
  const names = new Set<string>();
  for (const directory of new Set(directories)) {
    try {
      for (const name of await readdir(directory)) names.add(name);
    } catch {
      // Unreadable directories simply contribute no markers.
    }
  }
  return TOOLCHAIN_MARKERS.filter(([, markers]) => markers.some(marker => names.has(marker))).map(([id]) => id);
}

function withToolchains(context: PromptContext, toolchains: ToolchainId[]): PromptContext {
  return toolchains.length > 0 ? {...context, toolchains} : context;
}

export interface GitProbe {
  run(cwd: string, args: string[]): Promise<string>;
}

const systemGitProbe: GitProbe = {
  async run(cwd, args) {
    const {stdout} = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  },
};

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

export function parseGitStatus(output: string): GitStatus {
  const status: GitStatus = {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0};
  const lines = output.split('\n');
  const branch = lines[0] ?? '';
  status.ahead = Number(/ahead (\d+)/u.exec(branch)?.[1] ?? 0);
  status.behind = Number(/behind (\d+)/u.exec(branch)?.[1] ?? 0);
  for (const line of lines.slice(1)) {
    if (line.length < 3) continue;
    const code = line.slice(0, 2);
    if (code === '??') status.untracked++;
    else if (CONFLICT_CODES.has(code)) status.conflicts++;
    else {
      if (code[0] !== ' ') status.staged++;
      if (code[1] !== ' ') status.modified++;
    }
  }
  return status;
}

async function gitOperation(cwd: string, probe: GitProbe): Promise<GitStatus['operation']> {
  const path = await probe.run(cwd, ['rev-parse', '--absolute-git-dir']);
  const exists = async (name: string) => access(`${path}/${name}`).then(() => true, () => false);
  if (await exists('rebase-merge') || await exists('rebase-apply')) return 'rebase';
  if (await exists('MERGE_HEAD')) return 'merge';
  if (await exists('CHERRY_PICK_HEAD')) return 'cherry-pick';
  return undefined;
}

export async function resolvePromptContext(
  cwd: string,
  probe: GitProbe = systemGitProbe,
  home = homedir(),
  /** Rich Git Off skips the status probe; branch detection still runs. */
  options: {status?: boolean} = {},
): Promise<PromptContext> {
  const normalizedCwd = normalize(cwd);
  const normalizedHome = normalize(home);
  if (normalizedCwd === normalizedHome) return {cwd, project: '~'};

  try {
    const root = await probe.run(cwd, ['rev-parse', '--show-toplevel']);
    let branch: string | undefined;
    try {
      branch = await probe.run(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    } catch {
      const commit = await probe.run(cwd, ['rev-parse', '--short', 'HEAD']);
      branch = commit ? `detached:${commit}` : undefined;
    }
    let git: GitStatus | undefined;
    if (options.status !== false) try {
      git = parseGitStatus(await probe.run(cwd, ['status', '--porcelain=v1', '--branch', '--untracked-files=normal']));
      git.operation = await gitOperation(cwd, probe);
    } catch {
      // A large or unavailable repository must not hold the prompt hostage.
    }
    return withToolchains({cwd, project: basename(root) || basename(cwd), branch: branch || undefined, ...(git ? {git} : {})},
      await detectToolchains([cwd, root]));
  } catch {
    return withToolchains({cwd, project: basename(cwd) || cwd}, await detectToolchains([cwd]));
  }
}
