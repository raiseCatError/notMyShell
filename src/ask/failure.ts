import {existsSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';
import {redact} from '../understanding/tasks.js';
import type {AskContext, AskOption, AskOutcome} from './types.js';

/**
 * "Why did this fail?" from the failed block's own facts: the command, its
 * exit status and a bounded, redacted excerpt of its output (never the whole
 * log), read deterministically. Recognizers name what they actually see
 * (a missing command, a permission error, a failing test, a compiler
 * diagnostic, a Git refusal, a package-manager error). "Likely issue" appears
 * only when a recognizer supports it; otherwise Ask says it can point at the
 * failing diagnostic but not the root cause. Nothing is run.
 */
export interface FailureFacts {
  command: string;
  exitCode: number;
  /** Bounded output tail (the app passes at most a few hundred lines). */
  output: string;
  cwd?: string;
  startId?: number;
}

export interface Diagnosis {
  kind: string;
  /** What was seen, quoted from the output (bounded). */
  evidence: string[];
  /** Only when the evidence supports it. */
  likely?: string;
  /** A real file the diagnostic points at (validated to exist), with a line. */
  location?: {path: string; line?: number};
  next?: AskOption[];
}

const MAX_LINES = 400;
const MAX_EVIDENCE = 8;

const clean = (text: string) => text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '').replace(/\r/gu, '');

/** The bounded, redacted tail a diagnosis may read. */
export function failureExcerpt(output: string, lines = MAX_LINES): string[] {
  return clean(output).split('\n').slice(-lines).map(line => redact(line).slice(0, 300));
}

function located(path: string, cwd: string | undefined, line?: number): Diagnosis['location'] | undefined {
  const full = isAbsolute(path) ? path : resolve(cwd ?? '.', path);
  return existsSync(full) ? {path: full, ...(line ? {line} : {})} : undefined;
}

type Recognizer = (lines: string[], facts: FailureFacts) => Diagnosis | undefined;

const RECOGNIZERS: Recognizer[] = [
  // zsh / bash / fish: command not found.
  (lines, facts) => {
    // zsh: "zsh: command not found: vhs"; bash: "bash: vhs: command not found"; fish: "Unknown command: vhs".
    const hit = lines.map(line => /command not found: ([\w.+-]+)/u.exec(line) ?? /^(?:\S+: )?(?:line \d+: )?([\w.+-]+): command not found/u.exec(line) ?? /Unknown command:? '?([\w.+-]+)'?/u.exec(line)).find(Boolean);
    const name = hit?.slice(1).find(Boolean);
    if (!name && facts.exitCode !== 127) return undefined;
    return {kind: 'command-not-found', evidence: hit ? [hit[0]] : [`exit 127`], ...(name ? {likely: `${name} isn't installed or isn't on PATH in this shell.`,
      next: [{key: `fail:what:${name}`, label: `What is ${name}?`, refine: `what is ${name}`}, {key: `fail:install:${name}`, label: `Install ${name}`, refine: `install ${name}`}]} : {})};
  },
  // Permission denied.
  (lines, facts) => {
    const hit = lines.find(line => /permission denied|EACCES|Operation not permitted/iu.test(line));
    if (!hit && facts.exitCode !== 126) return undefined;
    const path = /(?:permission denied:?\s*|open ')([^'\s]+)/iu.exec(hit ?? '')?.[1];
    return {kind: 'permission', evidence: [hit ?? 'exit 126'], likely: path ? `${path} can't be read or executed by you (check its permissions: ls -l, chmod).` : 'Something was not readable, writable or executable for you.'};
  },
  // npm/pnpm/yarn: missing script, missing module, dependency resolution.
  (lines) => {
    const script = lines.map(line => /Missing script: "?([\w:.-]+)"?/u.exec(line)).find(Boolean);
    if (script) return {kind: 'missing-script', evidence: [script[0]], likely: `package.json has no "${script[1]}" script.`, next: [{key: 'fail:scripts', label: 'Show the project\'s scripts', refine: 'what scripts does this project have'}]};
    const module = lines.map(line => /Cannot find (?:module|package) '([^']+)'/u.exec(line)).find(Boolean);
    if (module) return {kind: 'missing-module', evidence: [module[0]], likely: module[1]!.startsWith('.') ? `The import path ${module[1]} doesn't resolve to a file.` : `${module[1]} isn't installed (dependencies may be missing).`};
    const eresolve = lines.find(line => /ERESOLVE|peer dep(?:endency)? conflict/iu.test(line));
    if (eresolve) return {kind: 'dependency-conflict', evidence: [eresolve], likely: 'npm could not resolve a peer-dependency conflict.'};
    return undefined;
  },
  // Node TAP / node --test and Jest-style failing tests.
  (lines, facts) => {
    const failing = lines.filter(line => /^\s*not ok \d+ - /u.test(line) || /^\s*● .+ › .+/u.test(line) || /^\s*✕ /u.test(line)).slice(0, MAX_EVIDENCE);
    if (!failing.length) return undefined;
    const expected = lines.findIndex(line => /^\s*(?:Expected|expected):/u.test(line));
    const evidence = [...failing.map(line => line.trim()), ...(expected >= 0 ? lines.slice(expected, expected + 4).map(line => line.trim()) : [])];
    const location = lines.map(line => /(?:location: '|at .*?\(|^\s+at )([^'()\s]+\.(?:[cm]?[jt]sx?)):(\d+)/u.exec(line)).find(Boolean);
    const where = location ? located(location[1]!.replace(/^file:\/\//u, ''), facts.cwd, Number(location[2])) : undefined;
    return {kind: 'tests', evidence, ...(where ? {location: where} : {}),
      next: [{key: 'fail:find', label: 'Find "not ok" in the transcript', refine: 'find not ok in the transcript'}]};
  },
  // TypeScript compiler diagnostics.
  (lines, facts) => {
    const errors = lines.map(line => /^(.+?\.[cm]?tsx?)[(:](\d+)[,:](\d+)\)?:?\s*(?:-\s*)?error (TS\d+): (.+)$/u.exec(line)).filter((match): match is RegExpExecArray => Boolean(match));
    if (!errors.length) return undefined;
    const first = errors[0]!;
    const where = located(first[1]!, facts.cwd, Number(first[2]));
    return {kind: 'typescript', evidence: errors.slice(0, MAX_EVIDENCE).map(match => `${match[1]}:${match[2]} ${match[4]} ${match[5]}`), ...(where ? {location: where} : {}),
      likely: `${errors.length} TypeScript error${errors.length === 1 ? '' : 's'}; the first is ${first[4]} in ${first[1]} line ${first[2]}.`};
  },
  // Python traceback.
  (lines, facts) => {
    const start = lines.findIndex(line => line.startsWith('Traceback (most recent call last)'));
    if (start < 0) return undefined;
    const tail = lines.slice(start).filter(line => line.trim());
    const error = tail.at(-1) ?? '';
    const frames = tail.map(line => /File "([^"]+)", line (\d+)/u.exec(line)).filter((match): match is RegExpExecArray => Boolean(match));
    const frame = frames.at(-1);
    const where = frame ? located(frame[1]!, facts.cwd, Number(frame[2])) : undefined;
    return {kind: 'python', evidence: [...(frame ? [frame[0]] : []), error], ...(where ? {location: where} : {}), ...(/^\w+(?:Error|Exception): /u.test(error) ? {likely: error} : {})};
  },
  // Rust and Go compiler errors.
  (lines, facts) => {
    // Rust: an error code, or a plain "error:" followed by a source location arrow (not Git's own "error:" lines).
    const rust = lines.findIndex((line, index) => /^error\[E\d+\]: /u.test(line) || (/^error: /u.test(line) && lines.slice(index + 1, index + 3).some(next => /^\s+-->\s/u.test(next))));
    if (rust >= 0) {
      const at = lines.slice(rust, rust + 4).map(line => /-->\s+([^:\s]+):(\d+):(\d+)/u.exec(line)).find(Boolean);
      const where = at ? located(at[1]!, facts.cwd, Number(at[2])) : undefined;
      return {kind: 'rust', evidence: lines.slice(rust, rust + 3).map(line => line.trim()), ...(where ? {location: where} : {}), likely: lines[rust]!.replace(/^error(?:\[E\d+\])?: /u, '')};
    }
    const go = lines.map(line => /^(\S+\.go):(\d+):(\d+): (.+)$/u.exec(line)).find(Boolean);
    if (go) { const where = located(go[1]!, facts.cwd, Number(go[2])); return {kind: 'go', evidence: [go[0]], ...(where ? {location: where} : {}), likely: go[4]}; }
    return undefined;
  },
  // Git refusals.
  (lines, facts) => {
    if (!/^\s*git\b/u.test(facts.command)) return undefined;
    const rules: Array<[RegExp, string]> = [
      [/not a git repository/u, 'This folder is not inside a Git repository.'],
      [/\[rejected\].*\(fetch first\)|non-fast-forward|Updates were rejected/u, 'The remote has commits you don\'t have yet: pull (or fetch and rebase) before pushing.'],
      [/would be overwritten by (?:merge|checkout)/u, 'Local changes would be overwritten: commit or stash them first.'],
      [/CONFLICT \(/u, 'The merge stopped on conflicts; resolve the conflicted files, then git add them.'],
      [/has no upstream branch/u, 'This branch has no upstream yet: push it with -u once.'],
      [/Authentication failed|Permission denied \(publickey\)/u, 'Git could not authenticate with the remote.'],
      [/pathspec '([^']+)' did not match/u, 'A path or branch name given to Git does not exist.'],
    ];
    for (const [pattern, likely] of rules) {
      const hit = lines.find(line => pattern.test(line));
      if (hit) return {kind: 'git', evidence: [hit.trim()], likely, next: [{key: 'fail:git', label: 'Show Git status', refine: 'what changed'}]};
    }
    const fatal = lines.find(line => /^(?:fatal|error): /u.test(line));
    return fatal ? {kind: 'git', evidence: [fatal]} : undefined;
  },
  // No such file.
  (lines) => {
    const hit = lines.find(line => /No such file or directory|ENOENT/u.test(line));
    return hit ? {kind: 'missing-path', evidence: [hit.trim()], likely: 'A file or directory it needed does not exist (check the path and the current folder).'} : undefined;
  },
];

/** The generic fallback: the lines that look like errors, nearest the end. */
function genericEvidence(lines: string[]): string[] {
  const errorish = lines.filter(line => /\b(?:error|failed|fatal|exception|denied|refused|cannot|can't|unable)\b/iu.test(line));
  return (errorish.length ? errorish : lines.filter(line => line.trim())).slice(-5).map(line => line.trim());
}

export function diagnose(facts: FailureFacts): Diagnosis {
  const lines = failureExcerpt(facts.output);
  for (const recognize of RECOGNIZERS) {
    const found = recognize(lines, facts);
    if (found) return {...found, evidence: found.evidence.slice(0, MAX_EVIDENCE)};
  }
  return {kind: 'unknown', evidence: genericEvidence(lines)};
}

/** The Ask answer for a failed block. */
export function failureOutcome(facts: FailureFacts, context: Pick<AskContext, 'editor'>): AskOutcome {
  const diagnosis = diagnose(facts);
  const lines = [`Why it failed`, '', `${facts.command}`, `exited with code ${facts.exitCode}.`];
  if (diagnosis.evidence.length) lines.push('', diagnosis.kind === 'tests' ? 'The test run reported:' : 'The output says:', ...diagnosis.evidence.map(line => `  ${line}`));
  lines.push('', diagnosis.likely ? `Likely issue\n  ${diagnosis.likely}` : 'I can identify the failing diagnostic, but not the root cause yet.');
  const next: AskOption[] = [...(diagnosis.next ?? [])];
  if (diagnosis.location) {
    const where = `${diagnosis.location.path}${diagnosis.location.line ? `:${diagnosis.location.line}` : ''}`;
    next.unshift({key: `fail:open:${where}`, label: `Open ${where.split('/').slice(-2).join('/')} in ${context.editor.label}`,
      outcome: {kind: 'proposal', capability: 'file.open', safety: 'navigate', confidence: 0.95, direct: true, text: `Opening ${where}.`, action: {kind: 'openFile', path: diagnosis.location.path}}});
  }
  return {kind: 'answer', capability: 'help.command', text: lines.join('\n'), next: next.slice(0, 4),
    block: {argv: [facts.command], literal: facts.command, provenance: 'context', risk: 'informational', note: 'The failed command (Copy/Insert to re-run it yourself).'},
    referents: {command: facts.command.split(/\s+/u).slice(0, 2), ...(diagnosis.location ? {file: diagnosis.location.path} : {})}};
}

/** Requests that ask why something failed. */
export const WHY_FAILED = /\bwhy did (?:it|that|this|the (?:last )?command|[\w.+-]+) fail\b|\bwhat went wrong\b|\bexplain (?:this|that|the) (?:error|failure)\b|\bwhy (?:is|was) (?:it|that|this) (?:failing|broken)\b|\bexplain (?:the )?failure\b/u;
