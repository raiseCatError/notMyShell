import {execFile, spawnSync} from 'node:child_process';

/**
 * Window control talks to the host only through bounded subprocesses: an
 * absolute executable, argv elements (never shell text) and a timeout. Each
 * operation is written once as a generator of steps, so the same code runs
 * asynchronously during setup and synchronously on exit.
 */
export interface Command {
  /** An absolute path; no shell, no PATH search at run time. */
  file: string;
  args: readonly string[];
  timeoutMs: number;
}

export interface CommandResult {ok: boolean; code: number | null; stdout: string; stderr: string; timedOut: boolean}

export type Step = {kind: 'run'; command: Command} | {kind: 'wait'; ms: number};
export type Operation<T> = Generator<Step, T, CommandResult | undefined>;

export type Runner = (command: Command) => Promise<CommandResult>;
export type SyncRunner = (command: Command) => CommandResult;

const MAX_OUTPUT = 1024 * 1024;
const NO_RESULT: CommandResult = {ok: false, code: null, stdout: '', stderr: 'no result', timedOut: false};

/** Inside an operation: `const result = yield* run(command)`. */
export function* run(command: Command): Generator<Step, CommandResult, CommandResult | undefined> {
  return (yield {kind: 'run', command}) ?? NO_RESULT;
}

/** Inside an operation: let the host settle (an animation, a configure round trip). */
export function* pause(ms: number): Generator<Step, void, CommandResult | undefined> {
  yield {kind: 'wait', ms};
}

export const runCommand: Runner = command => new Promise(resolve => {
  try {
    const child = execFile(command.file, [...command.args], {timeout: command.timeoutMs, maxBuffer: MAX_OUTPUT, encoding: 'utf8', killSignal: 'SIGKILL', windowsHide: true},
      (error, stdout, stderr) => {
        const failure = error as (NodeJS.ErrnoException & {killed?: boolean}) | null;
        resolve({ok: !failure, code: failure ? (typeof failure.code === 'number' ? failure.code : null) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''),
          timedOut: Boolean(failure?.killed)});
      });
    // Nothing reads the terminal: stdin is an empty pipe.
    child.stdin?.end();
  } catch (error) {
    resolve({...NO_RESULT, stderr: error instanceof Error ? error.message : String(error)});
  }
});

export const runCommandSync: SyncRunner = command => {
  try {
    const result = spawnSync(command.file, [...command.args], {timeout: command.timeoutMs, maxBuffer: MAX_OUTPUT, encoding: 'utf8', killSignal: 'SIGKILL', windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']});
    const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
    return {ok: !result.error && result.status === 0, code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', timedOut};
  } catch (error) {
    return {...NO_RESULT, stderr: error instanceof Error ? error.message : String(error)};
  }
};

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Blocks for at most a second (exit path only). */
export function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Math.min(1000, ms)));
}

export async function drive<T>(operation: Operation<T>, runner: Runner = runCommand, wait: (ms: number) => Promise<void> = sleep): Promise<T> {
  let step = operation.next();
  while (!step.done) {
    if (step.value.kind === 'run') step = operation.next(await runner(step.value.command));
    else { await wait(step.value.ms); step = operation.next(undefined); }
  }
  return step.value;
}

export function driveSync<T>(operation: Operation<T>, runner: SyncRunner = runCommandSync, wait: (ms: number) => void = sleepSync): T {
  let step = operation.next();
  while (!step.done) {
    if (step.value.kind === 'run') step = operation.next(runner(step.value.command));
    else { wait(step.value.ms); step = operation.next(undefined); }
  }
  return step.value;
}

/** The first line of a failure, for a reason shown to no one but logs and tests. */
export const firstLine = (text: string): string => text.split('\n').map(line => line.trim()).find(Boolean)?.slice(0, 160) ?? '';
