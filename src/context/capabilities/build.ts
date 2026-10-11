import {basename, dirname, join} from 'node:path';
import {defineCapability, type CapabilityContext} from '../capability.js';
import {findNearest, readMetadataText, readVersionFile, searchDirectories} from '../services.js';

/**
 * The build system a directory uses, and the version the project pins for it,
 * read from the project's own declarations. Wrapper scripts (gradlew, mvnw),
 * Bazelisk and the build files themselves are never run or evaluated: a
 * version comes from a properties file, `.bazelversion`, or one declaration
 * matched as text (`cmake_minimum_required`, `meson_version`).
 */
export interface BuildFact {
  tool: 'bazel' | 'gradle' | 'maven' | 'cmake' | 'meson' | 'make';
  /** The file that identified the build system. */
  file: string;
  /** The pinned version (wrapper, .bazelversion) or, prefixed with ≥, a minimum the project declares. */
  version?: string;
  versionFrom?: string;
}

type Tool = BuildFact['tool'];

/** Checked per directory, nearest first; within one directory the first tool listed wins (a Gradle build with a CMake subproject is Gradle). */
const MARKERS: ReadonlyArray<[Tool, readonly string[]]> = [
  ['bazel', ['MODULE.bazel', 'WORKSPACE.bazel', 'WORKSPACE', '.bazelversion']],
  ['gradle', ['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle', 'gradlew']],
  ['maven', ['pom.xml', 'mvnw']],
  ['cmake', ['CMakeLists.txt']],
  ['meson', ['meson.build']],
  // Makefile first: on a case-insensitive filesystem the first spelling asked for is the one reported.
  ['make', ['Makefile', 'GNUmakefile', 'makefile']],
];

/** One `key=value` line from a Java properties file, bounded; the value is text, never a URL that is fetched. */
async function property(path: string, key: string): Promise<string | undefined> {
  const content = await readMetadataText(path, 16 * 1024);
  for (const line of (content ?? '').split(/\r?\n/u).slice(0, 256)) {
    const match = /^[ \t]*([\w.-]{1,64})[ \t]*[=:][ \t]*(.{0,512})$/u.exec(line);
    if (match?.[1] === key) return match[2]!.replace(/\\:/gu, ':').trim();
  }
  return undefined;
}

type Version = {version: string; from: string} | undefined;

const VERSION_READERS: Partial<Record<Tool, (context: CapabilityContext, directory: string) => Promise<Version>>> = {
  async bazel(context) {
    // Bazelisk reads .bazelversion at the workspace root (a version, a fork/version, or `latest`/`7.x`).
    const found = await findNearest(context, ['.bazelversion']);
    const version = found ? await readVersionFile(found.path) : undefined;
    return version ? {version, from: '.bazelversion'} : undefined;
  },
  async gradle(context) {
    const found = await findNearest(context, [join('gradle', 'wrapper', 'gradle-wrapper.properties')]);
    const url = found ? await property(found.path, 'distributionUrl') : undefined;
    const version = url ? /gradle-(\d+\.\d+(?:\.\d+)?(?:-[\w.]{1,24})?)-(?:bin|all)\.zip$/u.exec(url)?.[1] : undefined;
    return version ? {version, from: 'gradle-wrapper.properties'} : undefined;
  },
  async maven(context) {
    const found = await findNearest(context, [join('.mvn', 'wrapper', 'maven-wrapper.properties')]);
    const url = found ? await property(found.path, 'distributionUrl') : undefined;
    const version = url ? /apache-maven-(\d+\.\d+\.\d+(?:-[\w.]{1,24})?)-bin\.zip$/u.exec(url)?.[1] : undefined;
    return version ? {version, from: 'maven-wrapper.properties'} : undefined;
  },
  async cmake(context, directory) {
    // A subproject's CMakeLists.txt rarely declares a minimum; the nearest one that does, up to the repository root, is the project's.
    for (const candidate of searchDirectories({cwd: directory, root: context.root})) {
      const content = await readMetadataText(join(candidate, 'CMakeLists.txt'));
      // Commands are case-insensitive; `VERSION 3.20...3.28` declares a minimum and a policy maximum.
      const minimum = /^[ \t]*cmake_minimum_required[ \t]*\([ \t]*VERSION[ \t]+(\d+(?:\.\d+){0,3})/imu.exec(content ?? '')?.[1];
      if (minimum) return {version: `≥${minimum}`, from: 'CMakeLists.txt'};
    }
    return undefined;
  },
  async meson(_context, directory) {
    const content = await readMetadataText(join(directory, 'meson.build'));
    const declared = /meson_version[ \t]*:[ \t]*'([^'\n]{1,32})'/u.exec(content ?? '')?.[1]?.trim();
    return declared ? {version: declared.replace(/^>=[ \t]*/u, '≥'), from: 'meson.build'} : undefined;
  },
};

async function detect(context: CapabilityContext): Promise<{tool: Tool; directory: string; file: string} | undefined> {
  for (const directory of searchDirectories(context)) {
    for (const [tool, names] of MARKERS) {
      if (context.signal.aborted) return undefined;
      const found = await findNearest({cwd: directory}, names);
      if (found) return {tool, directory, file: found.name};
    }
  }
  return undefined;
}

export const projectBuild = defineCapability<BuildFact>({
  id: 'project.build',
  title: 'Build system',
  reads: ['build files nearest the working directory, up to the repository root (MODULE.bazel/WORKSPACE, settings.gradle/build.gradle, pom.xml, CMakeLists.txt, meson.build, Makefile)',
    '.bazelversion', 'gradle/wrapper/gradle-wrapper.properties and .mvn/wrapper/maven-wrapper.properties (distributionUrl, never fetched)',
    'cmake_minimum_required and meson_version declarations, matched as text; no build file or wrapper is run'],
  scope: 'workspace', family: 'metadata', cost: 'bounded-async', trust: 'workspace', sensitivity: 'public', persistence: 'snapshot-safe',
  fields: ['tool', 'file', 'version', 'versionFrom'], env: [], ttlMs: 30_000, timeoutMs: 1500, invalidateOn: ['command'],
  preview: {tool: 'gradle', file: 'settings.gradle.kts', version: '8.10.2', versionFrom: 'gradle-wrapper.properties'},
  async resolve(context) {
    const found = await detect(context);
    if (!found) return undefined;
    const wantsVersion = context.fields.has('version') || context.fields.has('versionFrom');
    const version = wantsVersion ? await VERSION_READERS[found.tool]?.({...context, cwd: found.directory}, found.directory) : undefined;
    const value: BuildFact = {tool: found.tool, file: basename(found.file), ...(version ? {version: version.version, versionFrom: version.from} : {})};
    const where = found.directory === context.cwd ? found.file : join(basename(found.directory) || dirname(found.directory), found.file);
    return {value, evidence: [where, version?.from].filter(Boolean).join(', ')};
  },
});

export const BUILD_CAPABILITIES = [projectBuild];
