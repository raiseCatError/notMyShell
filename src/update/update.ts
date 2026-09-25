import {execFile} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nmshConfigDirectory} from '../configuration/paths.js';

/**
 * Update discovery and the explicit `/update` flow. Discovery reads the
 * public GitHub releases API without credentials or telemetry. Applying an
 * update is only offered for the supported install method (a clean source
 * checkout of the official repository, usually `npm link`ed) and only as a
 * fast-forward to a published release tag. Anything else is reported with
 * the manual path; NMSh never guesses. User config, transcripts, and shell
 * profiles are never touched.
 */

export const RELEASE_REPOSITORY = 'raiseCatError/notMyShell';
const API = `https://api.github.com/repos/${RELEASE_REPOSITORY}`;
const OFFICIAL_REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)raiseCatError\/notMyShell(?:\.git)?\/?$/iu;

export type UpdateCheckFrequency = 'off' | 'daily' | 'weekly';
export const UPDATE_CHECK_FREQUENCIES: readonly UpdateCheckFrequency[] = ['off', 'daily', 'weekly'];

export interface ReleaseInfo {
  version: string;
  tag: string;
  url: string;
  /** First meaningful lines of the release notes, plain text. */
  summary: string[];
}

export type FetchLike = (url: string, init?: {headers?: Record<string, string>; signal?: AbortSignal}) =>
  Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;

/** Numeric semver comparison; a prerelease sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [core = '', pre] = value.trim().replace(/^v/iu, '').split('-', 2);
    return {parts: core.split('.').map(part => Number.parseInt(part, 10) || 0), pre};
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.parts.length, right.parts.length, 3); index += 1) {
    const difference = (left.parts[index] ?? 0) - (right.parts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return left.pre < right.pre ? -1 : 1;
}

function releaseSummary(body: string, limit = 6): string[] {
  return body.split('\n')
    .map(line => line.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').replace(/^#+\s*/u, '').replace(/\*\*/gu, '').trim())
    .filter(line => line.length > 0)
    .slice(0, limit)
    .map(line => line.length > 100 ? `${line.slice(0, 99)}…` : line);
}

async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {headers: {accept: 'application/vnd.github+json', 'user-agent': 'nmsh-update-check'},
      signal: controller.signal});
    if (!response.ok) throw new Error(`GitHub responded ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** The latest stable (non-draft, non-prerelease) release. */
export async function fetchLatestRelease(fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 5000): Promise<ReleaseInfo> {
  const value = await getJson(fetchImpl, `${API}/releases/latest`, timeoutMs) as Record<string, unknown>;
  const tag = typeof value?.tag_name === 'string' ? value.tag_name : '';
  if (!/^v?\d+\.\d+\.\d+$/u.test(tag)) throw new Error('The latest release has no stable version tag.');
  return {
    version: tag.replace(/^v/u, ''),
    tag,
    url: typeof value.html_url === 'string' ? value.html_url : `https://github.com/${RELEASE_REPOSITORY}/releases/tag/${tag}`,
    summary: releaseSummary(typeof value.body === 'string' ? value.body : ''),
  };
}

/** The commit GitHub says a tag points at, to verify the locally fetched tag. */
export async function fetchTagCommit(tag: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 5000): Promise<string> {
  const value = await getJson(fetchImpl, `${API}/commits/${encodeURIComponent(tag)}`, timeoutMs) as Record<string, unknown>;
  if (typeof value?.sha !== 'string' || !/^[\da-f]{40}$/iu.test(value.sha)) throw new Error('GitHub did not return a commit for the tag.');
  return value.sha.toLowerCase();
}

export interface CommandRunner {
  run(command: string, args: readonly string[], cwd: string): Promise<string>;
}

export const systemRunner: CommandRunner = {
  run(command, args, cwd) {
    return new Promise((resolvePromise, reject) => {
      execFile(command, [...args], {cwd, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024,
        // Never prompt for credentials: public tags need none.
        env: {...process.env, GIT_TERMINAL_PROMPT: '0'}},
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim().split('\n').slice(-3).join(' ')));
        else resolvePromise(stdout.trim());
      });
    });
  },
};

/** The directory NMSh runs from: the package root above `dist/`. */
export function installRoot(moduleUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(moduleUrl)), '..', '..');
}

export type InstallInfo =
  | {kind: 'checkout'; root: string; branch?: string; head: string}
  | {kind: 'unsupported'; root: string; reason: string};

/** Provenance from facts only: an official, clean git checkout, or unsupported with the reason. */
export async function detectInstall(root: string, runner: CommandRunner = systemRunner): Promise<InstallInfo> {
  if (!existsSync(join(root, '.git'))) {
    return {kind: 'unsupported', root, reason: `${root} is not a git checkout, so NMSh cannot tell how it was installed.`};
  }
  try {
    const top = await runner.run('git', ['rev-parse', '--show-toplevel'], root);
    if (realpathSync(top) !== realpathSync(root)) return {kind: 'unsupported', root, reason: `${root} is inside another repository (${top}).`};
    const remote = await runner.run('git', ['remote', 'get-url', 'origin'], root).catch(() => '');
    if (!OFFICIAL_REMOTE.test(remote)) {
      return {kind: 'unsupported', root, reason: `origin is ${remote || 'not set'}, not github.com/${RELEASE_REPOSITORY}.`};
    }
    const head = await runner.run('git', ['rev-parse', 'HEAD'], root);
    const branch = await runner.run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], root).catch(() => '');
    return {kind: 'checkout', root, head, ...(branch ? {branch} : {})};
  } catch (error) {
    return {kind: 'unsupported', root, reason: `git could not read ${root}: ${error instanceof Error ? error.message : String(error)}`};
  }
}

export interface UpdatePlan {
  install: Extract<InstallInfo, {kind: 'checkout'}>;
  release: ReleaseInfo;
  commit: string;
  /** Human-readable steps, shown before confirmation. */
  steps: string[];
}

export type PlanResult = {ok: true; plan: UpdatePlan} | {ok: false; reason: string; manual: string[]};

export function manualSteps(root: string, tag: string): string[] {
  return [`cd ${root}`, 'git status            # commit or stash your changes first', `git fetch --tags origin`,
    `git merge --ff-only ${tag}    # or check out ${tag}`, 'npm install && npm run build'];
}

/**
 * Read-only checks plus a non-destructive `git fetch --tags`. The update is
 * offered only when the tree is clean, the fetched tag matches the commit
 * GitHub reports, and moving to it is a fast-forward.
 */
export async function planUpdate(install: InstallInfo, release: ReleaseInfo, runner: CommandRunner = systemRunner,
  tagCommit: (tag: string) => Promise<string> = tag => fetchTagCommit(tag)): Promise<PlanResult> {
  const manual = manualSteps(install.root, release.tag);
  if (install.kind !== 'checkout') return {ok: false, reason: install.reason, manual: [`Download ${release.url}`, 'and reinstall it the way you installed NMSh.']};
  const {root} = install;
  const dirty = await runner.run('git', ['status', '--porcelain', '--untracked-files=no'], root);
  if (dirty) return {ok: false, reason: 'The checkout has uncommitted changes; NMSh will not touch them.', manual};
  try {
    await runner.run('git', ['fetch', '--tags', '--no-recurse-submodules', 'origin'], root);
  } catch (error) {
    return {ok: false, reason: `Could not fetch release tags: ${error instanceof Error ? error.message : String(error)}`, manual};
  }
  let commit: string;
  try {
    commit = (await runner.run('git', ['rev-parse', `${release.tag}^{commit}`], root)).toLowerCase();
  } catch {
    return {ok: false, reason: `Tag ${release.tag} is not in the checkout after fetching.`, manual};
  }
  let expected: string;
  try {
    expected = await tagCommit(release.tag);
  } catch (error) {
    return {ok: false, reason: `Could not verify ${release.tag} with GitHub: ${error instanceof Error ? error.message : String(error)}`, manual};
  }
  if (expected !== commit) {
    return {ok: false, reason: `Local tag ${release.tag} (${commit.slice(0, 7)}) does not match GitHub (${expected.slice(0, 7)}); not updating.`, manual};
  }
  try {
    await runner.run('git', ['merge-base', '--is-ancestor', install.head, commit], root);
  } catch {
    return {ok: false, reason: `This checkout has commits that are not in ${release.tag}, so moving to it is not a fast-forward.`, manual};
  }
  const move = install.branch ? `Fast-forward ${install.branch} to ${release.tag} (${commit.slice(0, 7)})` : `Check out ${release.tag} (${commit.slice(0, 7)})`;
  return {ok: true, plan: {install, release, commit, steps: [move, 'npm install', 'npm run build', 'Verify the new build identity']}};
}

export interface ApplyResult {
  ok: boolean;
  /** What happened, one line per step, including any rollback. */
  log: string[];
}

function readBuiltIdentity(root: string): {version?: string; commit?: string} {
  try {
    return JSON.parse(readFileSync(join(root, 'dist', 'build-info.json'), 'utf8')) as {version?: string; commit?: string};
  } catch {
    return {};
  }
}

/**
 * Move to the release, rebuild, and verify. The running session keeps its
 * loaded code; the new version starts with the next NMSh launch. Any
 * failure after the move restores the previous commit and rebuilds it.
 */
export async function applyUpdate(plan: UpdatePlan, runner: CommandRunner = systemRunner,
  progress: (line: string) => void = () => undefined, readIdentity = readBuiltIdentity): Promise<ApplyResult> {
  const {root, head, branch} = plan.install;
  const log: string[] = [];
  const step = (line: string) => { log.push(line); progress(line); };
  const move = (target: string) => branch
    ? runner.run('git', ['merge', '--ff-only', target], root)
    : runner.run('git', ['switch', '--detach', target], root);
  try {
    await move(plan.commit);
    step(plan.steps[0]!);
  } catch (error) {
    step(`Could not move to ${plan.release.tag}: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`);
    return {ok: false, log};
  }
  try {
    step('Running npm install…');
    await runner.run('npm', ['install', '--no-audit', '--no-fund'], root);
    step('Running npm run build…');
    await runner.run('npm', ['run', 'build'], root);
    const built = readIdentity(root);
    if (built.version !== plan.release.version || !built.commit || !plan.commit.startsWith(built.commit.toLowerCase())) {
      throw new Error(`build identity is ${built.version ?? 'unknown'} ${built.commit ?? ''}, expected ${plan.release.version} ${plan.commit.slice(0, 7)}`);
    }
    step(`Verified build ${built.version} (${built.commit}).`);
    return {ok: true, log};
  } catch (error) {
    step(`Update failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  // Roll back: the tree was clean, so --keep cannot discard work.
  try {
    if (branch) await runner.run('git', ['reset', '--keep', head], root);
    else await runner.run('git', ['switch', '--detach', head], root);
    step(`Restored the previous commit ${head.slice(0, 7)}.`);
    await runner.run('npm', ['install', '--no-audit', '--no-fund'], root);
    await runner.run('npm', ['run', 'build'], root);
    step('Rebuilt the previous version.');
  } catch (error) {
    step(`Rollback incomplete: ${error instanceof Error ? error.message : String(error)}`);
    step(`Recover with: cd ${root} && git reset --keep ${head.slice(0, 12)} && npm install && npm run build`);
  }
  return {ok: false, log};
}

/** Background check bookkeeping; kept apart from user configuration. */
export interface UpdateState {
  lastCheck?: number;
  latestVersion?: string;
  notifiedVersion?: string;
}

export function updateStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(nmshConfigDirectory(env), 'update-state.json');
}

export function loadUpdateState(path = updateStatePath()): UpdateState {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    return {
      ...(typeof value.lastCheck === 'number' ? {lastCheck: value.lastCheck} : {}),
      ...(typeof value.latestVersion === 'string' ? {latestVersion: value.latestVersion} : {}),
      ...(typeof value.notifiedVersion === 'string' ? {notifiedVersion: value.notifiedVersion} : {}),
    };
  } catch {
    return {};
  }
}

export function saveUpdateState(state: UpdateState, path = updateStatePath()): void {
  mkdirSync(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, {encoding: 'utf8', mode: 0o600});
  renameSync(temporary, path);
}

const PERIOD_MS: Record<Exclude<UpdateCheckFrequency, 'off'>, number> = {daily: 86_400_000, weekly: 7 * 86_400_000};

export function isCheckDue(frequency: UpdateCheckFrequency, state: UpdateState, now = Date.now()): boolean {
  if (frequency === 'off') return false;
  return state.lastCheck === undefined || now - state.lastCheck >= PERIOD_MS[frequency] || now < state.lastCheck;
}

/**
 * One quiet background check. Returns the version to announce, at most
 * once per newly seen release; every failure is silent.
 */
export async function backgroundUpdateCheck(current: string, frequency: UpdateCheckFrequency, options: {
  now?: number; statePath?: string; fetchImpl?: FetchLike;
} = {}): Promise<ReleaseInfo | undefined> {
  const now = options.now ?? Date.now();
  const state = loadUpdateState(options.statePath);
  if (!isCheckDue(frequency, state, now)) return undefined;
  let release: ReleaseInfo;
  try {
    release = await fetchLatestRelease(options.fetchImpl);
  } catch {
    try { saveUpdateState({...state, lastCheck: now}, options.statePath); } catch { /* best effort */ }
    return undefined;
  }
  const announce = compareVersions(release.version, current) > 0 && state.notifiedVersion !== release.version;
  try {
    saveUpdateState({lastCheck: now, latestVersion: release.version,
      ...(announce ? {notifiedVersion: release.version} : state.notifiedVersion ? {notifiedVersion: state.notifiedVersion} : {})}, options.statePath);
  } catch {
    // Unwritable state only means the next launch checks again.
  }
  return announce ? release : undefined;
}
