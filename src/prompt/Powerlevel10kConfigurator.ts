import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {copyFile, lstat, readFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import type {Powerlevel10kStatus} from './powerlevel10k.js';

export interface ConfiguratorFile {
  path: string;
  backup?: string;
  before?: string;
}

export interface ConfiguratorPreparation {
  config: ConfiguratorFile;
  zshrc: ConfiguratorFile;
}

export function powerlevel10kZshrcPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(join(env.ZDOTDIR || env.HOME || homedir(), '.zshrc'));
}

function fingerprint(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

async function snapshot(path: string): Promise<ConfiguratorFile> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${path} is not a regular file; open the wizard manually from /zsh.`);
    const before = fingerprint(await readFile(path));
    const backup = `${path}.nmsh-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
    return {path, before, backup};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {path};
    throw error;
  }
}

/** Back up both files the official wizard may change before terminal handoff. */
export async function preparePowerlevel10kConfigurator(status: Powerlevel10kStatus,
  env: NodeJS.ProcessEnv = process.env): Promise<ConfiguratorPreparation> {
  if (!status.installed || !status.themePath) throw new Error('Powerlevel10k is not installed.');
  const zshrc = powerlevel10kZshrcPath(env);
  const config = await snapshot(status.configPath);
  return {config, zshrc: await snapshot(zshrc)};
}

export async function configuratorFileChanged(file: ConfiguratorFile): Promise<boolean> {
  try { return fingerprint(await readFile(file.path)) !== file.before; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return file.before !== undefined;
    throw error;
  }
}

/** The child owns the real TTY; NMSh must release it before calling this. */
export function launchPowerlevel10kConfigurator(status: Powerlevel10kStatus,
  env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (!status.installed || !status.themePath) return Promise.reject(new Error('Powerlevel10k is not installed.'));
  const script = 'source -- "$1" || exit 90; p10k configure';
  return new Promise((resolveExit, reject) => {
    const child = spawn('zsh', ['-f', '-i', '-c', script, 'nmsh-p10k-configure', status.themePath!], {
      stdio: 'inherit',
      env: {...env, POWERLEVEL9K_CONFIG_FILE: status.configPath, POWERLEVEL9K_DISABLE_CONFIGURATION_WIZARD: 'true'},
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolveExit(code ?? (signal ? 128 + (signal === 'SIGINT' ? 2 : 1) : 1)));
  });
}
