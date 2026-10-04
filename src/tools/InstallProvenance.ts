import {mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {nmshConfigDirectory} from '../configuration/paths.js';
import type {ProviderInstall} from '../providers/providers.js';
import type {Tool} from './catalog.js';
import type {ToolOwner} from './ToolUpdates.js';

/**
 * What NMSh itself installed: one record per successful, user-confirmed
 * install NMSh ran. This is the only evidence NMSh uses to say "NMSh installed
 * this". Anything else is described as installed outside NMSh.
 */

export const PROVENANCE_VERSION = 1;

export interface InstallRecord {
  toolId: string;
  /** The package manager command NMSh ran (argv, never a shell string). */
  command: string;
  args: string[];
  /** The package name passed to the package manager, needed for an uninstall. */
  package: string;
  installedAt: string;
}

interface ProvenanceFile { version: number; installs: InstallRecord[] }

export function provenancePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'tool-installs.json');
}

export class InstallProvenance {
  constructor(readonly path = provenancePath()) {}

  list(): InstallRecord[] {
    try {
      const data = JSON.parse(readFileSync(this.path, 'utf8')) as ProvenanceFile;
      if (data.version !== PROVENANCE_VERSION || !Array.isArray(data.installs)) return [];
      return data.installs.filter(record => record && typeof record.toolId === 'string' && typeof record.command === 'string'
        && Array.isArray(record.args) && record.args.every(arg => typeof arg === 'string') && typeof record.package === 'string');
    } catch { return []; }
  }

  find(toolId: string): InstallRecord | undefined {
    return this.list().find(record => record.toolId === toolId);
  }

  record(tool: Pick<Tool, 'id' | 'package'>, install: ProviderInstall, now = new Date()): void {
    const pkg = install.args.at(-1) ?? tool.package;
    const installs = [...this.list().filter(record => record.toolId !== tool.id),
      {toolId: tool.id, command: install.command, args: [...install.args], package: pkg, installedAt: now.toISOString()}];
    this.write(installs);
  }

  forget(toolId: string): void {
    this.write(this.list().filter(record => record.toolId !== toolId));
  }

  private write(installs: InstallRecord[]): void {
    mkdirSync(dirname(this.path), {recursive: true, mode: 0o700});
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({version: PROVENANCE_VERSION, installs}, null, 2)}\n`, {mode: 0o600});
    renameSync(temporary, this.path);
  }
}

export type UninstallPlan =
  /** NMSh recorded installing it; the inverse command is known exactly. */
  | {kind: 'recorded'; command: string; args: string[]; label: string; provenance: string}
  /** Homebrew owns the binary, but NMSh did not install it: advanced, explicit confirmation only. */
  | {kind: 'external-homebrew'; command: string; args: string[]; label: string; provenance: string}
  /** No safe automatic action. */
  | {kind: 'manual'; provenance: string};

/** Package names are passed as one argv element; reject anything that is not a plain formula name. */
const SAFE_PACKAGE = /^[A-Za-z0-9][A-Za-z0-9@._+/-]{0,127}$/u;

/**
 * Decide what (if anything) NMSh may offer. Never sudo, never a shell string,
 * never a guessed package manager.
 */
export function planToolUninstall(tool: Pick<Tool, 'id' | 'label' | 'package'>, record: InstallRecord | undefined, owner: ToolOwner): UninstallPlan {
  if (record && record.command === 'brew' && record.args[0] === 'install' && SAFE_PACKAGE.test(record.package)) {
    return {kind: 'recorded', command: 'brew', args: ['uninstall', record.package], label: `brew uninstall ${record.package}`,
      provenance: `Installed by NMSh on ${record.installedAt.slice(0, 10)} with \`${[record.command, ...record.args].join(' ')}\`.`};
  }
  if (owner === 'homebrew' && tool.package && SAFE_PACKAGE.test(tool.package)) {
    return {kind: 'external-homebrew', command: 'brew', args: ['uninstall', tool.package], label: `brew uninstall ${tool.package}`,
      provenance: `NMSh did not install ${tool.label}. Its executable belongs to a Homebrew formula; it may be a dependency of other software or yours to manage.`};
  }
  return {kind: 'manual', provenance: `NMSh did not install ${tool.label} and cannot tell how it was installed, so it will not remove it. Use the tool or package manager that installed it.`};
}
