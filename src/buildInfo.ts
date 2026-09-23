import {readFileSync} from 'node:fs';
import {PRODUCT_NAME} from './config.js';

export interface BuildIdentity {
  version: string;
  commit: string;
  branch?: string;
  dirty?: boolean;
}

export const UNKNOWN_BUILD_IDENTITY: BuildIdentity = {version: 'unknown', commit: 'unknown'};

export function parseBuildIdentity(value: unknown): BuildIdentity {
  if (!value || typeof value !== 'object') return {...UNKNOWN_BUILD_IDENTITY};
  const input = value as Record<string, unknown>;
  const version = typeof input.version === 'string' && input.version.length > 0 ? input.version : 'unknown';
  const commit = typeof input.commit === 'string' && /^(?:[\da-f]{7,40}|unknown)$/iu.test(input.commit)
    ? input.commit.toLowerCase()
    : 'unknown';
  const branch = typeof input.branch === 'string' && input.branch.length > 0 ? input.branch : undefined;
  return {
    version,
    commit,
    ...(branch ? {branch} : {}),
    ...(input.dirty === true ? {dirty: true} : {}),
  };
}

export function readBuildIdentity(path = new URL('./build-info.json', import.meta.url)): BuildIdentity {
  try {
    return parseBuildIdentity(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return {...UNKNOWN_BUILD_IDENTITY};
  }
}

export function formatBuildIdentity(identity: BuildIdentity): string {
  const branch = identity.branch ? ` (${identity.branch}${identity.dirty ? ', dirty' : ''})` : '';
  return `${PRODUCT_NAME} ${identity.version}\nbuild ${identity.commit}${branch}`;
}

export function isVersionInvocation(args: readonly string[]): boolean {
  return args.includes('--version') || args.includes('-v');
}
