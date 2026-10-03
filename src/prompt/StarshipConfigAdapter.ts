import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {copyFile, lstat, mkdir, mkdtemp, open, readFile, rename, rm} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {StarshipStatus} from './starship.js';

const execFileAsync = promisify(execFile);
export const STARSHIP_MODULES = ['directory', 'git_branch', 'git_status', 'nodejs', 'python', 'golang', 'docker_context'] as const;
export type StarshipModule = typeof STARSHIP_MODULES[number];

export interface StarshipConfigProposal {
  path: string;
  module: StarshipModule;
  disabled: boolean;
  original: string;
  existed: boolean;
  proposed: string;
  diff: string[];
}

const prepared = new WeakSet<StarshipConfigProposal>();

function validateModule(module: StarshipModule): void {
  if (!STARSHIP_MODULES.includes(module)) throw new Error('Unsupported Starship module.');
}

/** Refuse native CLI rewrites outside the selected supported field. */
function unsupportedContent(text: string, module: StarshipModule): string {
  // A line scanner cannot safely interpret multiline TOML strings.
  if (text.includes('"""') || text.includes("'''")) throw new Error('Multiline Starship config requires manual editing.');
  let target = false;
  return text.split(/\r?\n/u).filter(line => {
    const section = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/u.exec(line);
    if (section) {
      target = section[1] === module;
      if (target) return false;
    }
    return !(target && /^\s*disabled\s*=\s*(true|false)\s*(?:#.*)?$/u.test(line)) && line.trim() !== '';
  }).join('\n');
}

/** Narrow adapter around Starship's own CLI, never a generic TOML editor. */
export class StarshipConfigAdapter {
  constructor(private readonly status: StarshipStatus,
    private readonly run: typeof execFileAsync = execFileAsync) {
    if (!status.installed || !status.binary) throw new Error('Starship is not installed.');
  }

  private async readOriginal(): Promise<{text: string; mode: number; exists: boolean}> {
    try {
      const info = await lstat(this.status.configPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
        throw new Error('Starship config must be a regular file under 1 MiB.');
      }
      return {text: await readFile(this.status.configPath, 'utf8'), mode: info.mode & 0o777, exists: true};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {text: '', mode: 0o600, exists: false};
      throw error;
    }
  }

  private async cli(args: string[], path: string): Promise<string> {
    try {
      const {stdout} = await this.run(this.status.binary!, args, {timeout: 5000, maxBuffer: 1024 * 1024,
        env: {...process.env, STARSHIP_CONFIG: path}});
      return stdout;
    } catch {
      // execFile errors can contain stderr, including unrelated user config.
      throw new Error('Starship configuration command failed or timed out.');
    }
  }

  async disabled(module: StarshipModule): Promise<boolean> {
    validateModule(module);
    const output = await this.cli(['print-config', `${module}.disabled`], this.status.configPath);
    const match = /^disabled\s*=\s*(true|false)\s*$/mu.exec(output);
    if (!match) throw new Error(`Could not read Starship ${module} status.`);
    return match[1] === 'true';
  }

  async propose(module: StarshipModule, disabled: boolean): Promise<StarshipConfigProposal> {
    validateModule(module);
    if (typeof disabled !== 'boolean') throw new Error('Starship disabled value must be boolean.');
    const source = await this.readOriginal();
    const original = source.text;
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nmsh-starship-config-'));
    const staged = join(temporaryDirectory, 'starship.toml');
    try {
      const handle = await open(staged, 'wx', 0o600);
      try { await handle.writeFile(original, 'utf8'); } finally { await handle.close(); }
      await this.cli(['config', `${module}.disabled`, String(disabled)], staged);
      const proposed = await readFile(staged, 'utf8');
      if (unsupportedContent(original, module) !== unsupportedContent(proposed, module)) {
        throw new Error('Starship proposed changes outside the supported field; edit it manually.');
      }
      const effective = await this.cli(['print-config', `${module}.disabled`], staged);
      if (!new RegExp(`^disabled\\s*=\\s*${disabled}\\s*$`, 'mu').test(effective)) {
        throw new Error('Starship did not accept the proposed module value.');
      }
      const proposal: StarshipConfigProposal = {path: this.status.configPath, module, disabled, original, existed: source.exists, proposed,
        diff: [`+ ${module}.disabled = ${disabled}`]};
      prepared.add(proposal);
      return Object.freeze(proposal);
    } finally {
      await rm(temporaryDirectory, {recursive: true, force: true});
    }
  }

  /** Recheck user edits, back up existing config, then atomically install the reviewed bytes. */
  async apply(proposal: StarshipConfigProposal): Promise<string | undefined> {
    if (!prepared.has(proposal)) throw new Error('Review a prepared Starship proposal first.');
    if (proposal.path !== this.status.configPath) throw new Error('Starship config path changed.');
    const current = await this.readOriginal();
    if (current.exists !== proposal.existed || current.text !== proposal.original) {
      throw new Error('Starship config changed since preview; review it again.');
    }
    if (proposal.proposed === proposal.original) return undefined;
    await mkdir(dirname(proposal.path), {recursive: true, mode: 0o700});
    let backup: string | undefined;
    if (current.exists) {
      backup = `${proposal.path}.nmsh-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}`;
      await copyFile(proposal.path, backup, constants.COPYFILE_EXCL);
    }
    const temporary = `${proposal.path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', current.mode);
      try { await handle.writeFile(proposal.proposed, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, proposal.path);
      const directory = await open(dirname(proposal.path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
      return backup;
    } catch (error) {
      await rm(temporary, {force: true});
      throw error;
    }
  }
}
