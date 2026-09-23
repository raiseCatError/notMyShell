import {execFile} from 'node:child_process';
import {readdir} from 'node:fs/promises';
import {basename, normalize} from 'node:path';
import {homedir} from 'node:os';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export interface PromptContext {
  cwd: string;
  project: string;
  branch?: string;
  exitStatus?: number;
  /** Toolchains detected from marker files in cwd or the repository root. */
  toolchains?: ToolchainId[];
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
    });
    return stdout.trim();
  },
};

export async function resolvePromptContext(
  cwd: string,
  probe: GitProbe = systemGitProbe,
  home = homedir(),
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
    return withToolchains({cwd, project: basename(root) || basename(cwd), branch: branch || undefined},
      await detectToolchains([cwd, root]));
  } catch {
    return withToolchains({cwd, project: basename(cwd) || cwd}, await detectToolchains([cwd]));
  }
}
