import {commandWords, type PasteKind} from '../input/pasteGuard.js';

/**
 * /track and /watch run a command again and again with nobody reading each run. The shared classifier says what a
 * command is; this is the stricter gate for repeating it: whether it may start at once, needs an explicit Yes, or is
 * never repeated. When it cannot tell, it asks rather than allows. Network commands start at once only when they are
 * read-only probes (ping, dig, `nc -z`, a curl GET or a wget to standard output); everything that sends data, saves
 * files, signs in, publishes or runs another command asks first.
 */
export type RepeatRisk = {kind: 'refused' | 'confirm'; reason: string};

const LOOPBACK = /^(?:localhost|localhost\.localdomain|ip6-localhost|127(?:\.\d{1,3}){3}|::1|0\.0\.0\.0)$/u;
const PROBES = new Set(['ping', 'ping6', 'dig', 'nslookup', 'host', 'traceroute', 'traceroute6', 'mtr']);
const NETCAT = new Set(['nc', 'ncat', 'netcat']);
const REMOTE_SESSIONS = new Set(['ssh', 'sftp', 'telnet', 'ftp', 'mosh']);
const HTTP_CLIENTS = new Set(['http', 'https', 'xh', 'httpie']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const PACKAGE_QUERIES = new Set(['view', 'info', 'show', 'search', 'outdated', 'fund', 'audit']);
const POWER = /^(?:shutdown|reboot|halt|poweroff)$/u;
const POWER_VERBS = /^(?:reboot|poweroff|halt|suspend|hibernate|hybrid-sleep|kexec|soft-reboot)$/u;
/** curl short options that take a value (the rest of the cluster, or the next word). */
const CURL_VALUE = new Set([...'oDcKXdFTHwAmueEbrxYyzCPUQt']);
/** wget short options that take a value. */
const WGET_VALUE = new Set([...'OoaPtTweiBUQlARDIX']);
const ASSIGNMENT = /^[A-Za-z_]\w*=/u;

const refused = (reason: string): RepeatRisk => ({kind: 'refused', reason});
const confirm = (reason: string): RepeatRisk => ({kind: 'confirm', reason});
const standardStream = (value: string | undefined) => value === '-' || value === '/dev/null' || value === '/dev/stdout';
const cluster = (arg: string) => /^-[A-Za-z0-9]+$/u.test(arg) ? arg.slice(1) : '';

/** The command's name and arguments, after any leading `NAME=value` assignments. */
function parts(text: string): {assignments: string[]; name: string; args: string[]} {
  const all = commandWords(text);
  let index = 0;
  while (ASSIGNMENT.test(all[index] ?? '')) index += 1;
  const [command = '', ...args] = all.slice(index);
  return {assignments: all.slice(0, index), name: command.split('/').pop() ?? command, args};
}

/** What repeating one command (one part of a command line) would risk beyond what the classifier already refuses. */
export function repeatRisk(text: string, kinds: readonly PasteKind[]): RepeatRisk | undefined {
  const {assignments, name, args} = parts(text);
  if (POWER.test(name) || (/^(?:systemctl|loginctl|launchctl)$/u.test(name) && args.some(arg => POWER_VERBS.test(arg))) || (name === 'init' && /^[06]$/u.test(args[0] ?? ''))) {
    return refused(`shuts down or restarts the computer (${text})`);
  }
  const writes = writesThroughOptions(name, args, text);
  if (writes) return refused(writes);
  if (args.some(arg => /^--watch(?:All)?(?:=true)?$/u.test(arg))) return refused(`runs until it is stopped (${text}); /track repeats a command that finishes`);
  if (assignments.length) return confirm(`It sets ${assignments.map(word => `${word.split('=')[0]}=…`).join(' ')} for the command, which can change what it runs.`);
  if (name === 'env') {
    const inner = envCommand(args);
    if (inner) return confirm(`It runs another command (env … ${inner}).`);
  }
  if (name === 'git') return gitRisk(args, kinds);
  if (PROBES.has(name)) return undefined;
  if (NETCAT.has(name)) return args.some(arg => cluster(arg).includes('z')) ? undefined : confirm('It opens a network connection every interval.');
  if (name === 'curl') return curlRisk(args);
  if (name === 'wget') return wgetRisk(args);
  if (REMOTE_SESSIONS.has(name)) return confirm('It connects to another computer every interval.');
  if (HTTP_CLIENTS.has(name)) return confirm('It sends HTTP requests that may change data.');
  if (PACKAGE_MANAGERS.has(name) && kinds.includes('network')) {
    const sub = args.find(arg => !arg.startsWith('-')) ?? '';
    if (PACKAGE_QUERIES.has(sub) && !(sub === 'audit' && args.some(arg => arg === 'fix' || arg === '--fix'))) return undefined;
    return confirm(`It publishes, signs in, changes packages or downloads and runs one (${name} ${sub}).`);
  }
  if (kinds.includes('network') && !/^(?:npx|pnpx|bunx)$/u.test(name)) return confirm('It contacts the network every interval and NMSh can\'t tell what it sends.');
  return undefined;
}

/** Options that make an otherwise read-only command write files, delete them or update what it checks. */
function writesThroughOptions(name: string, args: readonly string[], text: string): string | undefined {
  const has = (pattern: RegExp) => args.some(arg => pattern.test(arg));
  if (name === 'git' && has(/^--output(?:=|$)/u)) return `writes files (${text})`;
  if (name === 'sort' && (has(/^--output(?:=|$)/u) || args.some(arg => cluster(arg).includes('o')))) return `writes files (${text})`;
  if (name === 'find' && has(/^-(?:fprint0?|fprintf|fls|delete|exec|execdir|ok|okdir)$/u)) return `writes, deletes or runs things (${text})`;
  if (name === 'tree' && has(/^-o$/u)) return `writes files (${text})`;
  if (name === 'yq' && has(/^(?:-i|--inplace)$/u)) return `modifies files (${text})`;
  if (name === 'scp') return `copies files (${text})`;
  if (name === 'rsync' && !(has(/^--(?:dry-run|list-only)$/u) || args.some(arg => cluster(arg).includes('n')))) return `copies files (${text})`;
  if (has(/^(?:--fix|--write|--update|--update-?snapshots?|--updateSnapshot|--snapshot-update)(?:=.*)?$/u)) return `rewrites files (${text})`;
  if (args.includes('-u') && /\b(?:jest|vitest)\b|^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/u.test(text)) return `updates snapshots (${text})`;
  return undefined;
}

/** The command `env` would run, if any (options and assignments alone only print the environment). */
function envCommand(args: readonly string[]): string | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg === '--') return args[at + 1];
    if (/^-[uC]$/u.test(arg)) { at += 1; continue; }
    if (/^-\w*S|^--split-string/u.test(arg)) return arg;
    if (arg.startsWith('-') || ASSIGNMENT.test(arg)) continue;
    return arg;
  }
  return undefined;
}

function gitRisk(args: readonly string[], kinds: readonly PasteKind[]): RepeatRisk | undefined {
  // Global options come before the subcommand; `-c` there sets configuration (which can name programs to run).
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (!arg.startsWith('-')) break;
    if (arg === '-c' || /^--(?:config-env|exec-path)(?:=|$)/u.test(arg)) return confirm('It sets git options that can run other programs.');
    if (arg === '-C') at += 1;
  }
  if (args.includes('--ext-diff')) return confirm('It runs an external diff program.');
  if (kinds.includes('network') && args.find(arg => !arg.startsWith('-')) === 'fetch') return confirm('It fetches from a remote and updates its branches every interval.');
  return undefined;
}

function curlRisk(args: readonly string[]): RepeatRisk | undefined {
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    const scheme = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(arg)?.[1]?.toLowerCase();
    if (scheme && scheme !== 'http' && scheme !== 'https') return confirm(`It uses ${scheme}://, which can send commands, not only read.`);
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const option = equals === -1 ? arg : arg.slice(0, equals);
      const value = equals === -1 ? args[at + 1] : arg.slice(equals + 1);
      if (/^--(?:data|form|upload-file|json|remote-name|remote-header-name|output-dir|create-dirs|cookie-jar|config|trace|libcurl|etag-save|hsts|alt-svc|mail-|quote|post30)/u.test(option)) {
        return confirm(`It sends data or saves files (${option}).`);
      }
      if (option === '--request' && !/^(?:GET|HEAD)$/iu.test(value ?? '')) return confirm(`It sends ${value ?? 'other'} requests.`);
      if ((option === '--output' || option === '--dump-header') && !standardStream(value)) return confirm(`It saves files (${option}).`);
      continue;
    }
    if (!/^-[^-]/u.test(arg)) continue;
    for (let index = 1; index < arg.length; index += 1) {
      const letter = arg[index]!;
      if ('dFTJOKQ'.includes(letter)) return confirm(`It sends data or saves files (-${letter}).`);
      if (!CURL_VALUE.has(letter)) continue;
      const value = index + 1 < arg.length ? arg.slice(index + 1) : args[at + 1];
      if (letter === 'X' && !/^(?:GET|HEAD)$/iu.test(value ?? '')) return confirm(`It sends ${value ?? 'other'} requests.`);
      if ('oDc'.includes(letter) && !standardStream(value)) return confirm(`It saves files (-${letter}).`);
      if (index + 1 >= arg.length) at += 1;
      break;
    }
  }
  return undefined;
}

function wgetRisk(args: readonly string[]): RepeatRisk | undefined {
  let toOutput = false;
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]!;
    if (arg.startsWith('--')) {
      const equals = arg.indexOf('=');
      const option = equals === -1 ? arg : arg.slice(0, equals);
      const value = equals === -1 ? args[at + 1] : arg.slice(equals + 1);
      if (option === '--spider') toOutput = true;
      else if (option === '--output-document') toOutput = standardStream(value);
      else if (/^--(?:post-|body-|method|recursive|mirror|page-requisites|convert-links|timestamping|continue|force-directories|save-cookies|warc-|backups)/u.test(option)) return confirm(`It sends data or saves files (${option}).`);
      else if (/^--(?:output-file|append-output)$/u.test(option) && !standardStream(value)) return confirm(`It writes a log file (${option}).`);
      continue;
    }
    if (!/^-[^-]/u.test(arg)) continue;
    for (let index = 1; index < arg.length; index += 1) {
      const letter = arg[index]!;
      if ('rmpkNxc'.includes(letter)) return confirm(`It saves files (-${letter}).`);
      if (!WGET_VALUE.has(letter)) continue;
      const value = index + 1 < arg.length ? arg.slice(index + 1) : args[at + 1];
      if (letter === 'O') toOutput = standardStream(value);
      if ('oa'.includes(letter) && !standardStream(value)) return confirm(`It writes a log file (-${letter}).`);
      if (index + 1 >= arg.length) at += 1;
      break;
    }
  }
  return toOutput ? undefined : confirm('It saves what it downloads to a file every interval.');
}

/**
 * Whether a network command reaches beyond this computer: only loopback targets are local. Registries and git
 * remotes are remote; a command whose target NMSh cannot find is treated as remote.
 */
export function reachesRemote(text: string, kinds: readonly PasteKind[]): boolean {
  const {name, args} = parts(text);
  if (/^(?:npx|pnpx|bunx)$/u.test(name)) return false;
  if (PACKAGE_MANAGERS.has(name) || name === 'git' || name === 'gh') return kinds.includes('network');
  const hosts: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?(\[[^\]]*\]|[^:/?#]*)/iu.exec(arg);
    if (url) { hosts.push(url[1] ?? ''); continue; }
    const host = /^@?(?:[^@\s]+@)?(\[[0-9a-fA-F:]+\]|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)(?::\S*)?$/u.exec(arg)?.[1];
    if (host && !/^\d+(?:\.\d+)?$/u.test(host)) hosts.push(host);
  }
  return !hosts.length || hosts.some(host => !LOOPBACK.test(host.replace(/^\[|\]$/gu, '').toLowerCase()));
}
