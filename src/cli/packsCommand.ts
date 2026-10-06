import type {CliIo} from './configCommand.js';
import {firstPartyPacks, packModuleId} from '../context/modules.js';
import {CORE_CAPABILITIES} from '../context/registry.js';
import {inspectPack, installedPackStatuses, installPack, packsDirectory, removePack, setPackEnabled, type InstalledPackStatus} from '../context/packs/store.js';
import type {ParsedPack} from '../context/packs/schema.js';
import {loadPromptConfiguration, savePromptConfiguration} from '../prompt/configuration.js';
import {promptConfigurationPath} from '../configuration/paths.js';

/**
 * `nmsh packs`: the local Context Pack lifecycle. Packs are data; installing
 * one adds its modules to /prompt hidden, and nothing appears until a person
 * turns a module on. There is no download command: a pack arrives only as a
 * local file someone chose, optionally pinned by its sha256.
 */
export const PACKS_USAGE = `Usage:
  nmsh packs                          List bundled and installed Context Packs
  nmsh packs inspect FILE             Validate a pack and show what it would read and add
  nmsh packs install FILE [--sha256 HEX] [--replace] [--yes]
  nmsh packs remove ID [--yes]        Remove the pack and its module entries
  nmsh packs enable ID | disable ID

Context Packs are declarative: they name capabilities NMSh core implements and
describe how to present them. They cannot run commands, read arbitrary files,
use the network or load code. Installed modules start hidden; turn them on in
/prompt.
`;

const CAPABILITIES = new Map(CORE_CAPABILITIES.map(capability => [capability.id, capability]));

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

/** What a person reviews before installing: identity, provenance, exactly what core will read, and the modules. */
export function describePack(parsed: ParsedPack): string {
  const {pack} = parsed;
  const lines = [`${pack.name} — ${pack.id} ${pack.version}`, `  ${pack.description}`, `  License: ${pack.license} · Author: ${pack.provenance.author}`
    + `${pack.provenance.source ? ` · Source: ${pack.provenance.source}` : ''}`, `  sha256: ${parsed.sha256}`, '  Reads (through NMSh core capabilities):'];
  for (const id of pack.requires) {
    const capability = CAPABILITIES.get(id);
    lines.push(`    ${id}: ${capability ? capability.reads.join('; ') : 'not provided by this NMSh'}`);
  }
  lines.push('  Modules:');
  for (const module of pack.modules) {
    lines.push(`    ${packModuleId(pack.id, module.id)} — ${module.label}: ${module.description}${module.triggers ? ` (on ${module.triggers.slice(0, 6).join(', ')}${module.triggers.length > 6 ? ', …' : ''})` : ''}`);
  }
  return `${lines.join('\n')}\n`;
}

function stateLabel(status: InstalledPackStatus): string {
  return status.state === 'enabled' ? 'enabled' : status.state === 'disabled' ? 'disabled' : `${status.state}${status.message ? `: ${status.message}` : ''}`;
}

export async function runPacksCommand(args: string[], io: CliIo): Promise<number> {
  const env = io.env ?? process.env;
  const version = io.version ?? '0.0.0';
  const directory = packsDirectory(env);
  const [action, ...rest] = args;
  try {
    if (action === undefined || action === 'list') {
      io.out('Bundled with NMSh:\n');
      for (const parsed of firstPartyPacks()) io.out(`  ${parsed.pack.id.padEnd(22)} ${parsed.pack.version.padEnd(8)} ${parsed.pack.name} (${parsed.pack.modules.length} modules)\n`);
      const installed = await installedPackStatuses(directory, version);
      io.out(installed.length ? 'Installed:\n' : 'Installed: none\n');
      for (const status of installed) io.out(`  ${status.record.id.padEnd(22)} ${status.record.version.padEnd(8)} ${stateLabel(status)}\n`);
      return 0;
    }
    if (action === 'inspect') {
      const file = rest[0];
      if (!file) { io.err(PACKS_USAGE); return 2; }
      const result = await inspectPack(file, version);
      if (!result.ok) { io.err(`${result.problem.kind === 'unsupported' ? 'Unsupported' : 'Invalid'} Context Pack: ${result.problem.message}\n`); return 1; }
      io.out(describePack(result.parsed));
      return 0;
    }
    if (action === 'install') {
      const file = rest.find(item => !item.startsWith('--') && item !== option(rest, '--sha256'));
      if (!file) { io.err(PACKS_USAGE); return 2; }
      const inspected = await inspectPack(file, version);
      if (!inspected.ok) { io.err(`${inspected.problem.kind === 'unsupported' ? 'Unsupported' : 'Invalid'} Context Pack: ${inspected.problem.message}\nNothing was installed.\n`); return 1; }
      io.out(describePack(inspected.parsed));
      let agreed = rest.includes('--yes');
      if (!agreed) {
        if (!io.confirm) { io.err('Not installed. Re-run with --yes to install non-interactively.\n'); return 2; }
        agreed = await io.confirm('Install this Context Pack? Its modules start hidden.');
      }
      if (!agreed) { io.err('Not installed; nothing changed.\n'); return 1; }
      const expectedSha256 = option(rest, '--sha256') ?? inspected.parsed.sha256;
      const outcome = await installPack(file, {directory, nmshVersion: version, expectedSha256, replace: rest.includes('--replace')});
      if (!outcome.ok) { io.err(`${outcome.reason}\n`); return 1; }
      // Its modules join /prompt hidden; turning one on is a separate choice.
      const path = promptConfigurationPath(env);
      const current = loadPromptConfiguration(path);
      const next = structuredClone(current);
      for (const module of outcome.parsed.pack.modules) {
        const id = packModuleId(outcome.parsed.pack.id, module.id);
        if (!next.modules.some(item => item.id === id)) next.modules.push({id, visible: false, condition: module.condition, surface: 'auto'});
      }
      savePromptConfiguration(next, path, current);
      io.err(`Installed ${outcome.parsed.pack.id} ${outcome.parsed.pack.version}${outcome.replaced ? ` (replaced ${outcome.replaced})` : ''}. Turn its modules on in /prompt.\n`);
      return 0;
    }
    if (action === 'remove') {
      const id = rest.find(item => !item.startsWith('--'));
      if (!id) { io.err(PACKS_USAGE); return 2; }
      let agreed = rest.includes('--yes');
      if (!agreed) {
        if (!io.confirm) { io.err('Not removed. Re-run with --yes to remove non-interactively.\n'); return 2; }
        agreed = await io.confirm(`Remove ${id} and its module entries?`);
      }
      if (!agreed) { io.err('Not removed; nothing changed.\n'); return 1; }
      const removed = await removePack(id, directory);
      if (!removed.ok) { io.err(`${removed.reason}\n`); return 1; }
      const path = promptConfigurationPath(env);
      const current = loadPromptConfiguration(path);
      const next = {...structuredClone(current), modules: current.modules.filter(module => !module.id.startsWith(`${id}:`))};
      savePromptConfiguration(next, path, current);
      io.err(`Removed ${id}.\n`);
      return 0;
    }
    if (action === 'enable' || action === 'disable') {
      const id = rest[0];
      if (!id) { io.err(PACKS_USAGE); return 2; }
      const result = await setPackEnabled(id, action === 'enable', directory);
      if (!result.ok) { io.err(`${result.reason}\n`); return 1; }
      io.err(`${id} ${action === 'enable' ? 'enabled' : 'disabled'}. Running NMSh windows pick this up when /prompt opens or at their next start.\n`);
      return 0;
    }
    io.err(PACKS_USAGE);
    return 2;
  } catch (error) {
    io.err(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
