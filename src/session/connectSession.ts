import {spawn} from 'node:child_process';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {InProcessSessionClient} from './InProcessSessionClient.js';
import {SocketSessionClient} from './SocketSessionClient.js';
import {type SessionConnection, type SessionOptions} from './SessionClient.js';
import {RUNTIME_DIR_ENV, defaultRuntimeDir, ensurePrivateRuntimeDir, socketPathFor} from './runtimeDir.js';

export const SESSION_SERVICE_ENV = 'NMSH_SESSION_SERVICE';

export interface ConnectSessionOptions extends SessionOptions {
  env?: NodeJS.ProcessEnv;
  runtimeDir?: string;
  /** Command used to start the service on demand. */
  serviceCommand?: {command: string; args: string[]};
  timeoutMs?: number;
}

function defaultServiceCommand(): {command: string; args: string[]} {
  const here = fileURLToPath(import.meta.url);
  const entry = fileURLToPath(new URL(`../sessionService${extname(here)}`, import.meta.url));
  const execArgv = process.execArgv.filter(arg => !arg.startsWith('--test') && !arg.startsWith('--inspect'));
  return {command: process.execPath, args: [...execArgv, entry]};
}

function startService(runtimeDir: string, command: {command: string; args: string[]}, env: NodeJS.ProcessEnv): void {
  // The service needs no user environment of its own: each session receives
  // the launching frontend's env in its create message.
  const serviceEnv: NodeJS.ProcessEnv = {PATH: env.PATH, HOME: env.HOME, TMPDIR: env.TMPDIR, [RUNTIME_DIR_ENV]: runtimeDir};
  const child = spawn(command.command, command.args, {detached: true, stdio: 'ignore', env: serviceEnv});
  child.on('error', () => {});
  child.unref();
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Connect to (starting if needed) the local session service. If anything fails
 * before the service confirms a session, fall back to an in-process shell; no
 * input has been sent by then, and the aborted connection makes the service
 * end anything it started, so nothing is duplicated or replayed.
 */
export async function connectSession(options: ConnectSessionOptions): Promise<SessionConnection> {
  const env = options.env ?? process.env;
  const sessionOptions = {cwd: options.cwd, columns: options.columns, rows: options.rows};
  if (env[SESSION_SERVICE_ENV] === '0') return {client: new InProcessSessionClient(sessionOptions), mode: 'in-process'};
  try {
    const runtimeDir = options.runtimeDir ?? defaultRuntimeDir(env);
    ensurePrivateRuntimeDir(runtimeDir);
    const socketPath = socketPathFor(runtimeDir);
    const shellEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    let started = false;
    for (;;) {
      try {
        const client = await SocketSessionClient.connect({...sessionOptions, socketPath, env: shellEnv,
          timeoutMs: Math.max(100, deadline - Date.now())});
        return {client, mode: 'service'};
      } catch (error) {
        const code = (error as {code?: string}).code;
        const retryable = code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'closed';
        if (!retryable || Date.now() >= deadline) throw error;
        if (!started) {
          startService(runtimeDir, options.serviceCommand ?? defaultServiceCommand(), env);
          started = true;
        }
        await delay(50);
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {client: new InProcessSessionClient(sessionOptions), mode: 'in-process',
      notice: `Session service unavailable (${reason}); running the shell in-process.`};
  }
}
