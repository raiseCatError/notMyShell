import {execFile} from 'node:child_process';
import {homedir} from 'node:os';
import {GithubError, type GithubErrorKind, LIMITS} from './model.js';
import {sanitizeLine} from './sanitize.js';

/**
 * Read-only GitHub transport over the user's authenticated GitHub CLI.
 *
 * - `gh` owns authentication (keyring/config); NMSh never reads, prints,
 *   stores or passes a token, and never puts credentials in argv.
 * - argv arrays only, no shell: queries, branch and repository names are
 *   GraphQL variables passed with `-f key=value` (raw string fields, which gh
 *   never expands as `@file`). Integers use `-F` with a validated number.
 * - Every call is bounded by time and output size, with prompts, pagers,
 *   color, update checks and debug logging disabled.
 * - The transport has no method that can issue a non-GET REST request or a
 *   GraphQL mutation (see `assertReadOnlyGraphql`).
 */

export interface GhResult { stdout: string; stderr: string; code: number | null; failure?: 'timeout' | 'too_large' | 'missing' }

export type GhRunner = (args: readonly string[], options: {timeoutMs: number; maxBytes: number}) => Promise<GhResult>;

export type GraphqlVariables = Record<string, string | number>;

export interface GithubTransport {
  graphql(query: string, variables: GraphqlVariables): Promise<{data: unknown; partialErrors: string[]}>;
  restGet(path: string): Promise<unknown>;
}

const TIMEOUT_MS = 20_000;

/** Environment for gh: user's auth/config preserved; nothing interactive or verbose. */
export function ghEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {...env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1',
    NO_COLOR: '1', CLICOLOR: '0', GH_PAGER: 'cat', PAGER: 'cat', GH_SPINNER_DISABLED: '1'};
  // Debug output can include request headers; never enable it from here.
  delete next.GH_DEBUG;
  delete next.DEBUG;
  return next;
}

export const defaultGhRunner: GhRunner = (args, {timeoutMs, maxBytes}) => new Promise(resolve => {
  execFile('gh', [...args], {encoding: 'utf8', timeout: timeoutMs, maxBuffer: maxBytes, shell: false, windowsHide: true,
    cwd: homedir(), env: ghEnvironment()}, (error, stdout, stderr) => {
    if (!error) { resolve({stdout, stderr, code: 0}); return; }
    const failure = error as NodeJS.ErrnoException & {killed?: boolean; signal?: string; code?: string | number};
    if (failure.code === 'ENOENT') resolve({stdout: '', stderr: '', code: null, failure: 'missing'});
    else if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve({stdout: '', stderr: '', code: null, failure: 'too_large'});
    else if (failure.killed || failure.signal === 'SIGTERM') resolve({stdout: '', stderr: String(stderr ?? ''), code: null, failure: 'timeout'});
    else resolve({stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code: typeof failure.code === 'number' ? failure.code : 1});
  });
});

const CREDENTIAL = /\b(?:gh[pousr]_[A-Za-z0-9_]{10,}|github_pat_[A-Za-z0-9_]{10,})\b/gu;

/** A short, sanitized, credential-free description of a failure. */
export function redactMessage(text: string): string {
  // GitHub's rate-limit text names the client's IP address; errors end up in screenshots and bug reports.
  const withoutAddresses = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu, '[address]').replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/giu, '[address]');
  return sanitizeLine(withoutAddresses.replace(CREDENTIAL, '[redacted]').replace(/(authorization|token)[:=]\s*\S+/giu, '$1: [redacted]'), 240);
}

export function classifyFailure(text: string): GithubErrorKind {
  const lower = text.toLowerCase();
  if (/rate limit|rate_limited|secondary rate|abuse detection|http 429/u.test(lower)) return 'rate_limit';
  if (/http 401|bad credentials|gh auth login|not logged in|authentication required|requires authentication|token .*expired/u.test(lower)) return 'auth';
  if (/could not resolve host|no such host|dial tcp|connection refused|network is unreachable|connection reset|tls handshake|i\/o timeout|offline/u.test(lower)) return 'network';
  if (/http 404|not_found|could not resolve to a/u.test(lower)) return 'not_found';
  if (/http 422|validation failed|invalid search|parse error/u.test(lower)) return 'invalid_query';
  if (/http 403/u.test(lower)) return 'auth';
  return 'unknown';
}

function toError(result: GhResult): GithubError {
  if (result.failure === 'missing') return new GithubError('unavailable', 'GitHub CLI (gh) was not found on PATH');
  if (result.failure === 'too_large') return new GithubError('too_large', 'GitHub response exceeded the workspace size bound');
  if (result.failure === 'timeout') return new GithubError('timeout', 'GitHub did not respond in time');
  const detail = `${result.stderr}\n${result.stdout}`;
  const kind = classifyFailure(detail);
  return new GithubError(kind, redactMessage(result.stderr || result.stdout) || 'GitHub request failed');
}

/** Rejects anything but a single read-only GraphQL query document. */
export function assertReadOnlyGraphql(query: string): void {
  const stripped = query.replace(/#[^\n]*/gu, '').trim();
  if (!/^query\b/u.test(stripped) || /\bmutation\b|\bsubscription\b/u.test(stripped)) {
    throw new GithubError('unknown', 'Only read-only GraphQL queries are permitted in this phase');
  }
}

/** Only GET REST paths under /repos/{owner}/{repo}/... built from validated parts. */
export function assertReadOnlyRestPath(path: string): void {
  if (!/^repos\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+\/[A-Za-z0-9/_.-]+(?:\?[A-Za-z0-9=&_-]*)?$/u.test(path) || path.includes('..')) {
    throw new GithubError('unknown', 'Unsupported GitHub REST path');
  }
}

export class GhCliTransport implements GithubTransport {
  constructor(private readonly run: GhRunner = defaultGhRunner) {}

  async graphql(query: string, variables: GraphqlVariables): Promise<{data: unknown; partialErrors: string[]}> {
    assertReadOnlyGraphql(query);
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [name, value] of Object.entries(variables)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) throw new GithubError('unknown', 'Invalid GraphQL variable name');
      if (typeof value === 'number') {
        if (!Number.isSafeInteger(value)) throw new GithubError('unknown', 'Invalid GraphQL integer');
        args.push('-F', `${name}=${value}`);
      } else args.push('-f', `${name}=${value}`);
    }
    const result = await this.run(args, {timeoutMs: TIMEOUT_MS, maxBytes: LIMITS.responseBytes});
    const parsed = parseJson(result.stdout);
    const errors = graphqlErrors(parsed);
    const data = parsed && typeof parsed === 'object' ? (parsed as {data?: unknown}).data : undefined;
    if (result.code === 0 && data) return {data, partialErrors: errors.map(redactMessage)};
    // gh exits non-zero on GraphQL errors; partial data is still truthfully usable.
    if (data && errors.length && !errors.some(e => classifyFailure(e) === 'rate_limit' || classifyFailure(e) === 'auth')) {
      return {data, partialErrors: errors.map(redactMessage)};
    }
    if (errors.length) {
      const joined = errors.join('; ');
      return Promise.reject(new GithubError(classifyFailure(joined) === 'unknown' ? classifyFailure(result.stderr) : classifyFailure(joined), redactMessage(joined)));
    }
    throw toError(result);
  }

  async restGet(path: string): Promise<unknown> {
    assertReadOnlyRestPath(path);
    const result = await this.run(['api', '--method', 'GET', '-H', 'Accept: application/vnd.github+json', path],
      {timeoutMs: TIMEOUT_MS, maxBytes: LIMITS.responseBytes});
    if (result.code !== 0) throw toError(result);
    const parsed = parseJson(result.stdout);
    if (parsed === undefined) throw new GithubError('unknown', 'GitHub returned a response that is not JSON');
    return parsed;
  }
}

function parseJson(text: string): unknown {
  if (!text.trim()) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function graphqlErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  const errors = (value as {errors?: unknown}).errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 10).map(error => {
    const e = error as {type?: unknown; message?: unknown};
    return `${typeof e.type === 'string' ? `${e.type}: ` : ''}${typeof e.message === 'string' ? e.message : 'error'}`;
  });
}
