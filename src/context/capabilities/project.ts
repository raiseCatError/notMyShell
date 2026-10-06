import {defineCapability, type CapabilityContext} from '../capability.js';
import {findNearest, LARGE_METADATA_BYTES, parseIniData, parseJsonData, parseJsoncData, parseTomlData, parseXmlData, parseYamlData, readMetadataText,
  record, searchDirectories, text} from '../services.js';
import {lstat} from 'node:fs/promises';
import {join} from 'node:path';

export interface PackageFact {
  name?: string;
  version?: string;
  ecosystem: string;
  manifest: string;
  private?: boolean;
  manager?: string;
  managerVersion?: string;
}

interface ManifestReader {
  file: string;
  ecosystem: string;
  read(path: string): Promise<Pick<PackageFact, 'name' | 'version' | 'private'> | undefined>;
}

const version = (value: unknown) => text(value, 64);
const lastModuleElement = (path: string) => path.split('/').filter(part => part && !/^v\d+$/u.test(part)).at(-1);

/** Declarative manifests only; build scripts (build.gradle, setup.py, mix.exs, Package.swift) are never read as data. */
const MANIFESTS: readonly ManifestReader[] = [
  {file: 'package.json', ecosystem: 'npm', read: async path => {
    const data = parseJsonData(await readMetadataText(path, LARGE_METADATA_BYTES));
    return record(data) ? {name: text(data.name, 214), version: version(data.version), private: data.private === true} : undefined;
  }},
  {file: 'Cargo.toml', ecosystem: 'cargo', read: async path => {
    const data = parseTomlData(await readMetadataText(path));
    const pkg = record(data?.package) ? data.package : undefined;
    return pkg ? {name: text(pkg.name, 128), version: version(pkg.version)} : undefined;
  }},
  {file: 'pyproject.toml', ecosystem: 'python', read: async path => {
    const data = parseTomlData(await readMetadataText(path));
    const project = record(data?.project) ? data.project : record(data?.tool) && record(data.tool.poetry) ? data.tool.poetry : undefined;
    return project ? {name: text(project.name, 128), version: version(project.version)} : undefined;
  }},
  {file: 'go.mod', ecosystem: 'go', read: async path => {
    const module = /^module\s+("?)([^\s"]{1,256})\1\s*$/mu.exec(await readMetadataText(path) ?? '')?.[2];
    return module ? {name: lastModuleElement(module)} : undefined;
  }},
  {file: 'deno.json', ecosystem: 'deno', read: async path => {
    const data = parseJsonData(await readMetadataText(path));
    return record(data) ? {name: text(data.name, 128), version: version(data.version)} : undefined;
  }},
  {file: 'deno.jsonc', ecosystem: 'deno', read: async path => {
    const data = parseJsoncData(await readMetadataText(path));
    return record(data) ? {name: text(data.name, 128), version: version(data.version)} : undefined;
  }},
  {file: 'composer.json', ecosystem: 'composer', read: async path => {
    const data = parseJsonData(await readMetadataText(path));
    return record(data) ? {name: text(data.name, 128), version: version(data.version)} : undefined;
  }},
  {file: 'pubspec.yaml', ecosystem: 'dart', read: async path => {
    const data = await parseYamlData(await readMetadataText(path));
    return record(data) ? {name: text(data.name, 128), version: version(data.version)} : undefined;
  }},
  {file: 'pom.xml', ecosystem: 'maven', read: async path => {
    const data = await parseXmlData(await readMetadataText(path, LARGE_METADATA_BYTES));
    const project = record(data) && record(data.project) ? data.project : undefined;
    const literal = (value: unknown) => typeof value === 'string' && !value.includes('${') ? value : undefined;
    return project ? {name: text(literal(project.artifactId), 128), version: version(literal(project.version))} : undefined;
  }},
  {file: 'Project.toml', ecosystem: 'julia', read: async path => {
    const data = parseTomlData(await readMetadataText(path));
    return data ? {name: text(data.name, 128), version: version(data.version)} : undefined;
  }},
  {file: 'setup.cfg', ecosystem: 'python', read: async path => {
    const metadata = parseIniData(await readMetadataText(path))?.get('metadata');
    const literal = (value: string | undefined) => value && !value.startsWith('attr:') && !value.startsWith('file:') ? value : undefined;
    return metadata ? {name: text(literal(metadata.get('name')), 128), version: version(literal(metadata.get('version')))} : undefined;
  }},
];

const LOCKFILES: ReadonlyArray<[string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['bun.lockb', 'bun'], ['package-lock.json', 'npm'], ['npm-shrinkwrap.json', 'npm'],
  ['uv.lock', 'uv'], ['poetry.lock', 'poetry'], ['pdm.lock', 'pdm'], ['Pipfile.lock', 'pipenv'], ['Pipfile', 'pipenv'], ['pixi.lock', 'pixi'],
];

async function packageManager(context: CapabilityContext, manifestDirectory: string): Promise<{manager?: string; managerVersion?: string; evidence?: string}> {
  // Corepack's `packageManager` field is the project's own declaration and wins over lockfile evidence.
  const declared = parseJsonData(await readMetadataText(join(manifestDirectory, 'package.json'), LARGE_METADATA_BYTES));
  const field = record(declared) ? text(declared.packageManager, 256) : undefined;
  const match = field ? /^(npm|pnpm|yarn|bun)@(\d+\.\d+\.\d+[^+]*)/u.exec(field) : undefined;
  if (match) return {manager: match[1], managerVersion: match[2]!.slice(0, 32), evidence: 'package.json packageManager'};
  for (const directory of searchDirectories(context)) {
    for (const [file, manager] of LOCKFILES) {
      try { if ((await lstat(join(directory, file))).isFile()) return {manager, evidence: file}; } catch { /* absent */ }
    }
  }
  return {};
}

export const projectPackage = defineCapability<PackageFact>({
  id: 'project.package',
  title: 'Project package identity',
  reads: ['nearest declarative manifest up to the repository root (package.json, Cargo.toml, pyproject.toml, go.mod, deno.json, composer.json, pubspec.yaml, pom.xml, Project.toml, setup.cfg)', 'lockfile names'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['name', 'version', 'ecosystem', 'manifest', 'private', 'manager', 'managerVersion'], env: [],
  ttlMs: 30_000, timeoutMs: 1500, invalidateOn: ['command'],
  preview: {name: 'notmyshell', version: '0.18.0', ecosystem: 'npm', manifest: 'package.json', manager: 'npm'},
  async resolve(context) {
    for (const directory of searchDirectories(context)) {
      for (const reader of MANIFESTS) {
        if (context.signal.aborted) return undefined;
        const found = await findNearest({cwd: directory}, [reader.file]);
        if (!found) continue;
        const data = await reader.read(found.path);
        if (!data || (!data.name && !data.version)) continue;
        const wantsManager = context.fields.has('manager') || context.fields.has('managerVersion');
        const manager = wantsManager ? await packageManager(context, directory) : {};
        const value: PackageFact = {ecosystem: reader.ecosystem, manifest: reader.file, ...(data.name ? {name: data.name} : {}),
          ...(data.version ? {version: data.version} : {}), ...(data.private ? {private: true} : {}),
          ...(manager.manager ? {manager: manager.manager} : {}), ...(manager.managerVersion ? {managerVersion: manager.managerVersion} : {})};
        return {value, evidence: [reader.file, manager.evidence].filter(Boolean).join(', ')};
      }
    }
    return undefined;
  },
});

export const PROJECT_CAPABILITIES = [projectPackage];
