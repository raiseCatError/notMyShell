import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildContextLine, nativePromptSnapshot} from '../src/prompt/prompt.js';
import {DEFAULT_PROMPT_CONFIGURATION, DEFAULT_TRANSCRIPT_APPEARANCE, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {resolvePromptContext, type PromptContext} from '../src/shell/ShellContext.js';
import {renderHistoricalContext} from '../src/output/TranscriptPresenter.js';
import {stripAnsi} from '../src/util/text.js';

/**
 * Repository-controlled text (branch, repository directory name, cwd) is data
 * in NMSh Native: Git is probed with execFile (no shell), the managed shell's
 * own PROMPT/PS1 are empty, and the TypeScript renderer never hands these
 * values to a prompt parser. So zsh prompt escapes (%n, %F{red}, %(?.a.b))
 * and shell substitutions ($(..), `..`, ${..}) must show literally, nothing
 * may run, and control characters must be inert. Cf. the Oh My Zsh
 * PROMPT_SUBST branch-name advisory (GHSA-x96c-8w82-wf96).
 */

const SGR = /\u001B\[[0-9;:]*m/gu;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;

/** Only NMSh's own SGR color sequences may remain; nothing from the data can form an escape. */
function assertInert(ansi: string, label: string): void {
  const residue = ansi.replace(SGR, '');
  assert.equal(CONTROL.test(residue), false, `${label}: a control character or non-SGR escape survived: ${JSON.stringify(residue)}`);
}

const configuration = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), provider: 'nmsh'});
const historicalLevels = ['full', 'compact', 'minimal'] as const;

/** Live composer + header line, snapshot, and every historical level, all checked. */
function renderEverywhere(context: PromptContext, width = 600): {live: string[]; history: string[]} {
  const before = structuredClone(context);
  const live = (['composer', 'header'] as const).map(placement => buildContextLine(context, width, configuration, placement));
  const snapshot = nativePromptSnapshot(context, configuration);
  const history = historicalLevels.flatMap(level => {
    const row = renderHistoricalContext({cwd: context.cwd, project: context.project, branch: context.branch, prompt: snapshot}, width,
      {...DEFAULT_TRANSCRIPT_APPEARANCE, historicalPrompt: true, historicalPromptLevel: level});
    return row ? [row.ansi] : [];
  });
  assert.deepEqual(context, before, 'rendering never mutates the context');
  for (const [index, line] of [...live, ...history].entries()) assertInert(line, `render ${index}`);
  return {live, history};
}

const PROMPT_ESCAPES = ['%n', '%M', '%~', '%F{red}x%f', '%(?.yes.no)', '%{%}', '%B%U'];

function git(cwd: string, ...args: string[]) {
  const result = spawnSync('git', args, {cwd, encoding: 'utf8', env: {...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: cwd}});
  return result;
}

test('real Git: hostile branch names Git accepts stay literal in the live prompt, snapshot and history; nothing executes', {skip: !spawnSync('git', ['--version']).stdout && 'git not installed'}, async () => {
  const root = mkdtempSync(join(tmpdir(), 'nmsh-gitlit-'));
  try {
    // A canary command on PATH: any substitution that ran would create the file.
    const bin = join(root, 'bin');
    mkdirSync(bin);
    const canary = join(root, 'PWNED');
    writeFileSync(join(bin, 'pwn'), `#!/bin/sh\ntouch '${canary}'\n`);
    chmodSync(join(bin, 'pwn'), 0o755);
    const savedPath = process.env.PATH;
    process.env.PATH = `${bin}:${savedPath}`;
    const repo = join(root, 'repo$(pwn)%n');
    mkdirSync(repo);
    assert.equal(git(repo, 'init', '-q', '-b', 'main').status, 0);
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'x');
    const branches = [...PROMPT_ESCAPES, '$USER', '$(pwn)', '`pwn`', '${HOME}', "it's\"quoted\"", 'a;pwn', 'a&pwn', 'a|pwn', 'ünïcødé/分支/🚀',
      `long-${'x'.repeat(200)}`];
    try {
      const legal = branches.filter(branch => git(repo, 'check-ref-format', '--branch', branch).status === 0);
      // Names Git forbids (here %~ and %(?.yes.no)) are covered at the renderer level below, never by weakening Git.
      assert.deepEqual(branches.filter(branch => !legal.includes(branch)), ['%~', '%(?.yes.no)'], 'only ~ and ? are refused by Git here');
      for (const branch of legal) {
        const made = git(repo, 'checkout', '-q', '-b', branch);
        assert.equal(made.status, 0, `${branch}: ${made.stderr}`);
        const context = await resolvePromptContext(repo, undefined, '/nonexistent-home');
        assert.equal(context.branch, branch, 'the branch arrives as the exact data Git stored');
        assert.equal(context.project, 'repo$(pwn)%n');
        const {live, history} = renderEverywhere(context, branch.length > 100 ? 120 : 600);
        if (branch.length <= 100) {
          assert.ok(live.some(line => stripAnsi(line).includes(branch)), `${branch}: shown literally in the live prompt`);
          assert.ok(history.some(line => stripAnsi(line).includes(branch)), `${branch}: shown literally in history`);
          assert.ok(live.some(line => stripAnsi(line).includes('repo$(pwn)%n')), 'the repository name is literal too');
        }
        git(repo, 'checkout', '-q', 'main');
      }
    } finally { process.env.PATH = savedPath; }
    assert.equal(existsSync(canary), false, 'no substitution was executed');
    assert.equal(readdirSync(root).includes('PWNED'), false);
  } finally { rmSync(root, {recursive: true, force: true}); }
});

test('renderer: values Git itself forbids (backslash, spaces, ANSI, OSC, BEL, C1, NUL) are rendered inert, never as escapes', () => {
  const hostile = [
    'back\\slash\\e[31m', 'with space ; & | $(pwn) `pwn`', '\u001B[2J\u001B[Hcleared', '\u001B]0;owned title\u0007', '\u001B]8;;https://evil.example\u001B\\link\u001B]8;;\u001B\\',
    '\u009B31mC1-CSI', '\u009D0;c1-osc\u009C', 'nul\u0000byte', 'bell\u0007', 'cr\rover', 'tab\tand\nnewline', '\u001BPdcs\u001B\\',
  ];
  for (const value of hostile) {
    const context: PromptContext = {cwd: `/tmp/${value}`, project: value, branch: value, git: {staged: 0, modified: 0, untracked: 0, conflicts: 0, ahead: 0, behind: 0},
      kubeContext: value, dockerContext: value};
    const {live, history} = renderEverywhere(context);
    for (const line of [...live, ...history]) {
      assert.equal(/\u001B\]|\u001B\[2J|\u001BP|\u009B|\u009D/u.test(line), false, `${JSON.stringify(value)}: no data-derived escape`);
    }
    const visible = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '');
    if (!/[\u0000-\u001f\u007f-\u009f]/u.test(value)) assert.ok(live.some(line => stripAnsi(line).includes(visible)), `${value}: literal`);
  }
});

test('renderer: zsh prompt escapes are plain text here, not translated, so a literal % is preserved rather than doubled', () => {
  for (const branch of PROMPT_ESCAPES) {
    const {live} = renderEverywhere({cwd: '/r', project: 'r', branch});
    const shown = stripAnsi(live[0]!);
    assert.ok(shown.includes(branch), `${branch} literal`);
    assert.equal(shown.includes(branch.replace(/%/gu, '%%')) && !branch.includes('%%'), false, 'no Oh My Zsh-style %% escaping leaks into display');
  }
});
