import {execFile} from 'node:child_process';
import {basename, normalize} from 'node:path';
import {homedir} from 'node:os';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);

export interface PromptContext {
  cwd: string;
  project: string;
  branch?: string;
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
    return {cwd, project: basename(root) || basename(cwd), branch: branch || undefined};
  } catch {
    return {cwd, project: basename(cwd) || cwd};
  }
}

