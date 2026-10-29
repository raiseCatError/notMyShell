import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {Journal} from '../src/backups/journal.js';
import {snapshot, transact} from '../src/appearance/hostFiles.js';
import {planRestore, restore, manualSnapshot} from '../src/backups/restore.js';
import {createChangesPanel, changesKey, renderChangesPanel} from '../src/backups/ChangesPanel.js';
import {ledgerPath, loadLedger, ownership, writeArtifact, applyHook, hookSpec, planHook, removeArtifact} from '../src/themeBridge/artifacts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
type T = {after(fn: () => void): void};
function box(t: T) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'integrity-')));
  t.after(() => { try { spawnSync('chmod', ['-R', 'u+rwx', home]); } catch { /* best effort */ } rmSync(home, {recursive: true, force: true}); });
  const env = {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config')};
  const journal = new Journal({home, directory: join(home, '.config/nmsh/backups')});
  return {home, env, journal};
}
const meta = (themeRef = 'one') => ({mode: 'follow' as const, themeRef, format: 'vim', formatVersion: 1});
const write = (path: string, text: string) => { mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, text); };
const plainRender = (lines: string[]) => lines.join('\n').replace(/\x1b\[[0-9;]*m/gu, '').replace(/\s+/gu, ' ');

// ---- D2: Theme Bridge ledger --------------------------------------------------------------------------------------------

test('D2: ordinary launches re-applying the same colors never rewrite the Theme Bridge ledger or add backups', t => {
  const b = box(t);
  assert.equal(writeArtifact('vim', 'colors', () => true, meta(), b.env, new Date('2026-10-01T00:00:00Z')).ok, true);
  const before = readFileSync(ledgerPath(b.env), 'utf8'); const inode = statSync(ledgerPath(b.env)).ino; const entries = b.journal.list().length;
  for (let launch = 1; launch <= 5; launch++) {
    const result = writeArtifact('vim', 'colors', () => true, meta(), b.env, new Date(Date.UTC(2026, 9, 1 + launch)));
    assert.deepEqual(result, {ok: true, path: join(b.home, '.config/nmsh/theme-bridge/vim/colors/nmsh-bridge.vim'), changed: false});
  }
  assert.equal(readFileSync(ledgerPath(b.env), 'utf8'), before, 'ledger bytes unchanged');
  assert.equal(statSync(ledgerPath(b.env)).ino, inode, 'ledger was not replaced');
  assert.equal(b.journal.list().length, entries, 'no extra backups');
  assert.ok(b.journal.list().every(entry => entry.files.every(file => b.journal.status(file) === 'unchanged since')));
});

test('D2: a real record change with the same file content is journaled and restorable', t => {
  const b = box(t);
  writeArtifact('vim', 'colors', () => true, meta('one'), b.env);
  assert.equal(writeArtifact('vim', 'colors', () => true, meta('two'), b.env).ok, true);
  const [latest] = b.journal.list();
  assert.equal(latest!.source, 'theme-bridge'); assert.match(latest!.label, /vim record/u);
  assert.deepEqual(latest!.files.map(file => file.path), [ledgerPath(b.env)]);
  assert.equal(loadLedger(b.env).entries.vim!.themeRef, 'two');
});

test('D2: restoring an older Theme Bridge backup never forgets a managed Vim file written later', t => {
  const b = box(t);
  assert.equal(writeArtifact('neovim', '-- lua', () => true, {...meta(), format: 'lua'}, b.env).ok, true);
  const first = b.journal.list()[0]!;
  assert.equal(writeArtifact('vim', '" vim', () => true, meta(), b.env).ok, true);
  assert.equal(ownership('vim', loadLedger(b.env), b.env), 'owned');
  const plan = planRestore(b.journal, first.id);
  assert.deepEqual(plan.edited, [], 'NMSh bookkeeping is reconciled, not reported as a user edit');
  assert.match(plan.preview.join('\n'), /keeps NMSh's current ownership record for vim/u);
  restore(b.journal, plan, {reviewed: true, overwrite: false});
  const ledger = loadLedger(b.env);
  assert.equal(ownership('vim', ledger, b.env), 'owned', 'vim stays managed');
  assert.equal(ownership('neovim', ledger, b.env), 'absent', 'the restored neovim file is gone, and so is its record');
  assert.equal(ledger.entries.neovim, undefined);
  assert.equal(removeArtifact('vim', b.env).ok, true, 'NMSh can still remove the vim file it wrote');
});

test('D2: restoring an include change keeps the newer artifact record and restores only the include part', t => {
  const b = box(t);
  writeArtifact('vim', 'v1', () => true, meta(), b.env);
  const spec = hookSpec('vim', b.env, b.home);
  assert.ok(!('error' in spec), JSON.stringify(spec));
  const planned = planHook(spec, b.home);
  assert.ok('plan' in planned, JSON.stringify(planned));
  assert.deepEqual(applyHook('vim', planned.plan, spec, b.env), {ok: true});
  const include = b.journal.list()[0]!;
  assert.equal(writeArtifact('vim', 'v2', () => true, meta(), b.env).ok, true);
  restore(b.journal, planRestore(b.journal, include.id), {reviewed: true, overwrite: true});
  const ledger = loadLedger(b.env);
  assert.equal(ownership('vim', ledger, b.env), 'owned', 'the regenerated v2 file stays owned');
  assert.equal(ledger.entries.vim!.hook, undefined, 'the include record is restored to before the include');
});

// ---- D3: one damaged target -------------------------------------------------------------------------------------------

function damagedFixture(t: T) {
  const b = box(t);
  const kitty = join(b.home, '.config/kitty/kitty.conf');
  write(kitty, 'font_size 12\n');
  transact([{before: snapshot(kitty, b.home), after: 'font_size 13\n'}], [], b.home, {source: 'appearance', label: 'Kitty appearance', directory: b.journal.directory});
  const entry = b.journal.list()[0]!;
  const other = join(b.home, '.config/ghostty/config');
  write(other, 'theme = a\n');
  return {...b, kitty, entry, other};
}
const writeOther = (f: ReturnType<typeof damagedFixture>, text: string) =>
  transact([{before: snapshot(f.other, f.home, true), after: text}], [], f.home, {source: 'appearance', label: 'Ghostty appearance', directory: f.journal.directory});

test('D3: a recorded directory replaced by a regular file blocks only its own restore, with the exact path and reason', t => {
  const f = damagedFixture(t);
  rmSync(dirname(f.kitty), {recursive: true}); writeFileSync(dirname(f.kitty), 'not a directory');
  writeOther(f, 'theme = b\n');
  assert.equal(readFileSync(f.other, 'utf8'), 'theme = b\n', 'an unrelated write succeeds');
  assert.equal(f.journal.list({strict: true}).length, 2, 'the journal itself stays readable');
  const seen = f.journal.inspect(f.entry.files[0]!);
  assert.equal(seen.status, 'unsafe'); assert.match(seen.reason!, new RegExp(`not a directory: ${dirname(f.kitty)} is a regular file`, 'u'));
  assert.throws(() => planRestore(f.journal, f.entry.id), (error: Error) =>
    error.message.includes(f.entry.id) && error.message.includes(f.kitty) && /Kitty appearance/u.test(error.message) && /Nothing was changed/u.test(error.message));
  assert.equal(readFileSync(dirname(f.kitty), 'utf8'), 'not a directory', 'never written through');
  const panel = createChangesPanel(f.journal, []); panel.selected = 1;
  assert.match(plainRender(renderChangesPanel(panel, 160, 30)), /unsafe: A configuration parent is not a directory/u);
});

test('D3: symlinks, file↔directory swaps, inaccessible parents and missing files stay isolated', t => {
  const f = damagedFixture(t);
  // A file where a directory was recorded: the recorded file path is now a directory.
  rmSync(f.kitty); mkdirSync(f.kitty);
  writeOther(f, 'theme = c\n');
  assert.match(f.journal.inspect(f.entry.files[0]!).reason!, /is a directory/u);
  assert.throws(() => planRestore(f.journal, f.entry.id), /not safe to change/u);
  // A symbolic link in the parent chain.
  rmSync(dirname(f.kitty), {recursive: true}); mkdirSync(join(f.home, 'elsewhere')); symlinkSync(join(f.home, 'elsewhere'), dirname(f.kitty));
  writeOther(f, 'theme = d\n');
  assert.match(f.journal.inspect(f.entry.files[0]!).reason!, /symbolic link/u);
  assert.throws(() => planRestore(f.journal, f.entry.id), /symbolic link/u);
  // An inaccessible parent.
  rmSync(dirname(f.kitty)); mkdirSync(dirname(f.kitty)); writeFileSync(f.kitty, 'x'); chmodSync(dirname(f.kitty), 0o000);
  writeOther(f, 'theme = e\n');
  if (process.getuid?.() !== 0) assert.equal(f.journal.inspect(f.entry.files[0]!).status, 'unsafe');
  chmodSync(dirname(f.kitty), 0o700);
  // Missing: reported as missing, and a reviewed restore recreates the backed-up file.
  rmSync(f.kitty);
  assert.equal(f.journal.status(f.entry.files[0]!), 'missing');
  restore(f.journal, planRestore(f.journal, f.entry.id), {reviewed: true, overwrite: true});
  assert.equal(readFileSync(f.kitty, 'utf8'), 'font_size 12\n');
  const skipped: string[] = [];
  rmSync(dirname(f.other), {recursive: true}); writeFileSync(dirname(f.other), 'file');
  manualSnapshot(f.journal, [], skipped);
  assert.ok(skipped.some(line => line.startsWith(f.other)), 'manual snapshot names the unsafe path it skipped');
});

test('D3: a damaged backup entry is kept for review, never pruned, and does not block other writes', t => {
  const b = box(t);
  const file = join(b.home, 'a.conf'); write(file, 'a0');
  const small = new Journal({home: b.home, directory: b.journal.directory, maxEntries: 4});
  transact([{before: snapshot(file, b.home), after: 'a1'}], [], b.home, {source: 'cursor', label: 'first', directory: small.directory});
  const damaged = small.list()[0]!;
  rmSync(join(small.directory, damaged.id, 'files', '0'));
  assert.throws(() => small.record([{before: snapshot(file, b.home), after: 'a2'}], 'cursor', 'same file'),
    (error: Error) => error.message.includes(damaged.id) && error.message.includes(file) && /Other files can still be changed/u.test(error.message));
  const other = join(b.home, 'b.conf'); write(other, 'b0');
  for (let index = 2; index < 12; index++) {
    const entry = small.record([{before: snapshot(other, b.home), after: `b${index}`}], 'cursor', `write ${index}`);
    writeFileSync(other, `b${index}`); small.complete(entry);
  }
  assert.ok(existsSync(join(small.directory, damaged.id)), 'kept for review');
  small.list();
  assert.match(small.unreadableReasons.get(damaged.id)!, /journal file is missing/u);
  assert.ok(small.list().length <= 3, 'it still counts toward the entry cap');
  const panel = createChangesPanel(small, []);
  assert.match(panel.message, new RegExp(`${damaged.id}: Backup verify failed`, 'u'));
});

// ---- D4: interrupted writes ---------------------------------------------------------------------------------------------

/** Runs the real transact in a separate process and kills it with SIGKILL at one transaction boundary. */
async function killAt(home: string, directory: string, stage: string, files: Array<[string, string]>): Promise<void> {
  const script = join(home, `kill-${stage.replace(/\W/gu, '-')}.mts`);
  writeFileSync(script, `
import {snapshot, transact} from ${JSON.stringify(pathToFileURL(join(root, 'src/appearance/hostFiles.ts')).href)};
const files = ${JSON.stringify(files)};
transact(files.map(([path, after]) => ({before: snapshot(path, ${JSON.stringify(home)}, true), after})), [], ${JSON.stringify(home)},
  {source: 'appearance', label: 'Interrupted write', directory: ${JSON.stringify(directory)},
   fault: stage => { if (stage === ${JSON.stringify(stage)}) process.kill(process.pid, 'SIGKILL'); }});
process.exit(3);
`);
  const child = spawn(process.execPath, ['--import=tsx', script], {cwd: root, env: {...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config')}, stdio: 'ignore'});
  const signal = await new Promise<NodeJS.Signals | null>(done => child.on('exit', (_code, sig) => done(sig)));
  assert.equal(signal, 'SIGKILL', `the writer was killed at ${stage}`);
}
function twoFiles(t: T) {
  const b = box(t);
  const one = join(b.home, 'one.conf'), two = join(b.home, 'two.conf');
  write(one, 'one-before\n'); write(two, 'two-before\n');
  return {...b, one, two, files: [[one, 'one-after\n'], [two, 'two-after\n']] as Array<[string, string]>};
}

test('D4: a write killed at each boundary is classified from the bytes on disk, never assumed applied', async t => {
  const cases: Array<[string, string, string, string]> = [
    ['recorded', 'not-applied', 'one-before\n', 'two-before\n'],
    ['written:0', 'partially-applied', 'one-after\n', 'two-before\n'],
    ['before-complete', 'applied-unfinalized', 'one-after\n', 'two-after\n'],
  ];
  for (const [stage, expected, one, two] of cases) {
    const f = twoFiles(t);
    await killAt(f.home, f.journal.directory, stage, f.files);
    assert.equal(readFileSync(f.one, 'utf8'), one); assert.equal(readFileSync(f.two, 'utf8'), two);
    const [entry] = f.journal.list();
    assert.equal(entry!.outcome, 'prepared', `${stage}: never marked applied`);
    assert.equal(f.journal.transactionState(entry!).state, expected, stage);
    const panel = createChangesPanel(f.journal, []);
    assert.match(panel.message, /1 unfinished change needs review/u);
  }
});

test('D4: a later external edit to an interrupted write is reported as a conflict and needs explicit overwrite', async t => {
  const f = twoFiles(t);
  await killAt(f.home, f.journal.directory, 'written:0', f.files);
  writeFileSync(f.one, 'user edit after the crash\n');
  const [entry] = f.journal.list();
  assert.equal(f.journal.transactionState(entry!).state, 'conflicted');
  const plan = planRestore(f.journal, entry!.id);
  assert.deepEqual(plan.edited, [f.one], 'only the externally edited file needs the second confirmation');
  assert.throws(() => restore(f.journal, plan, {reviewed: true, overwrite: false}), /later edits/u);
  assert.equal(readFileSync(f.one, 'utf8'), 'user edit after the crash\n');
});

test('D4: rollback of a partial write takes an undo checkpoint and settles the entry; finalize needs proof', async t => {
  const f = twoFiles(t);
  await killAt(f.home, f.journal.directory, 'written:0', f.files);
  const [entry] = f.journal.list();
  assert.throws(() => f.journal.finalize(entry!), /partially-applied/u);
  const plan = planRestore(f.journal, entry!.id);
  assert.deepEqual(plan.edited, [], 'the written file is the one this change wrote; the other already holds its backup');
  assert.match(plan.preview.join('\n'), /interrupted part-way/u);
  const undo = restore(f.journal, plan, {reviewed: true, overwrite: false});
  assert.equal(readFileSync(f.one, 'utf8'), 'one-before\n'); assert.equal(readFileSync(f.two, 'utf8'), 'two-before\n');
  const settled = f.journal.read(entry!.id);
  assert.equal(settled.outcome, 'prepared', 'older builds still read it');
  assert.equal(settled.resolution?.state, 'reverted'); assert.match(settled.resolution!.detail!, new RegExp(undo.id, 'u'));
  assert.equal(f.journal.transactionState(settled).state, 'reverted');
  // The undo checkpoint returns the partial state if the user wants it back.
  restore(f.journal, planRestore(f.journal, undo.id), {reviewed: true, overwrite: false});
  assert.equal(readFileSync(f.one, 'utf8'), 'one-after\n');
});

test('D4: an interrupted write whose files all landed can be finalized without touching them', async t => {
  const f = twoFiles(t);
  await killAt(f.home, f.journal.directory, 'before-complete', f.files);
  const [entry] = f.journal.list();
  const stamp = statSync(f.one).mtimeMs;
  const done = f.journal.finalize(entry!);
  assert.equal(done.outcome, 'applied'); assert.equal(done.resolution?.state, 'finalized');
  assert.equal(statSync(f.one).mtimeMs, stamp);
  assert.equal(f.journal.transactionState(done).state, 'applied');
});

test('D4: a write that fails in-process is rolled back and recorded as reverted; a live writer is in progress', t => {
  const f = twoFiles(t);
  assert.throws(() => transact(f.files.map(([path, after]) => ({before: snapshot(path, f.home, true), after})), [], f.home,
    {source: 'appearance', label: 'Failing write', directory: f.journal.directory, fault: stage => { if (stage === 'written:0') throw new Error('disk full'); }}), /disk full.*rolled back/u);
  assert.equal(readFileSync(f.one, 'utf8'), 'one-before\n');
  const [entry] = f.journal.list();
  assert.equal(entry!.resolution?.state, 'reverted'); assert.equal(f.journal.transactionState(entry!).state, 'reverted');
  // Another process that is still running owns a prepared entry: never reconciled behind its back.
  const sleeper = spawn('sleep', ['30']); t.after(() => sleeper.kill());
  const pending = f.journal.record([{before: snapshot(f.two, f.home), after: 'x'}], 'appearance', 'Live writer');
  writeFileSync(join(f.journal.directory, pending.id, 'owner.json'), JSON.stringify({owner: 'nmsh-journal', version: 1, pid: sleeper.pid}));
  assert.equal(f.journal.transactionState(pending).state, 'in-progress');
});

test('D4: unresolved interrupted entries are never pruned, even under a tiny cap', t => {
  const b = box(t);
  const file = join(b.home, 'c.conf'); write(file, 'c0');
  const small = new Journal({home: b.home, directory: b.journal.directory, maxEntries: 5});
  // The file's original backup comes first, so the interrupted entry is protected only for being unfinished.
  const first = small.record([{before: snapshot(file, b.home), after: 'c-first'}], 'cursor', 'original'); writeFileSync(file, 'c-first'); small.complete(first);
  const interrupted = small.record([{before: snapshot(file, b.home), after: 'never written'}], 'cursor', 'interrupted');
  for (let index = 1; index < 30; index++) {
    const entry = small.record([{before: snapshot(file, b.home, true), after: `c${index}`}], 'cursor', `w${index}`);
    writeFileSync(file, `c${index}`); small.complete(entry);
  }
  assert.ok(small.list().some(entry => entry.id === interrupted.id));
  assert.ok(readdirSync(small.directory).filter(name => /^\d{8}T/u.test(name)).length <= 5);
});

// ---- Review follow-ups ------------------------------------------------------------------------------------------------

test('an edit that lands while the backup is written settles the entry as reverted, never as an orphan', t => {
  const f = twoFiles(t);
  assert.throws(() => transact(f.files.map(([path, after]) => ({before: snapshot(path, f.home, true), after})), [], f.home,
    {source: 'appearance', label: 'Raced', directory: f.journal.directory, fault: stage => { if (stage === 'recorded') writeFileSync(f.one, 'user typed this\n'); }}), /changed since the preview/u);
  assert.equal(readFileSync(f.one, 'utf8'), 'user typed this\n');
  const [entry] = f.journal.list();
  assert.equal(entry!.resolution?.state, 'reverted'); assert.match(entry!.resolution!.detail!, /No file was changed/u);
});

test('a conflicted interrupted entry can be set aside without touching files; a live writer blocks restore', async t => {
  const f = twoFiles(t);
  await killAt(f.home, f.journal.directory, 'written:0', f.files);
  writeFileSync(f.one, 'later edit\n');
  const [entry] = f.journal.list();
  const panel = createChangesPanel(f.journal, []);
  assert.match(plainRender(renderChangesPanel(panel, 160, 30)), /D set aside/u);
  changesKey(panel, {kind: 'text', value: 'd'});
  assert.equal(f.journal.transactionState(f.journal.read(entry!.id)).state, 'reviewed');
  assert.equal(readFileSync(f.one, 'utf8'), 'later edit\n'); assert.equal(readFileSync(f.two, 'utf8'), 'two-before\n');
  assert.doesNotMatch(createChangesPanel(f.journal, []).message, /unfinished/u);
  const sleeper = spawn('sleep', ['30']); t.after(() => sleeper.kill());
  const pending = f.journal.record([{before: snapshot(f.two, f.home), after: 'x'}], 'appearance', 'Live writer');
  writeFileSync(join(f.journal.directory, pending.id, 'owner.json'), JSON.stringify({owner: 'nmsh-journal', version: 1, pid: sleeper.pid}));
  assert.throws(() => planRestore(f.journal, pending.id), new RegExp(`process ${sleeper.pid} is still writing`, 'u'));
});

test('a damaged backup of NMSh settings never blocks later settings or ownership writes', t => {
  const b = box(t);
  const config = join(b.home, '.config/nmsh/config.json'); write(config, '{}\n');
  transact([{before: snapshot(config, b.home), after: '{"a":1}\n'}], [], b.home, {source: 'settings', label: 'settings', directory: b.journal.directory});
  const damaged = b.journal.list()[0]!;
  rmSync(join(b.journal.directory, damaged.id, 'files', '0'));
  transact([{before: snapshot(config, b.home, true), after: '{"a":2}\n'}], [], b.home, {source: 'settings', label: 'again', directory: b.journal.directory});
  assert.equal(readFileSync(config, 'utf8'), '{"a":2}\n');
  assert.equal(writeArtifact('vim', 'v', () => true, meta(), b.env).ok, true);
});

test('restoring a record-only Theme Bridge change restores that record; restoring the first record removes it', t => {
  const b = box(t);
  writeArtifact('vim', 'colors', () => true, meta('one'), b.env);
  const created = b.journal.list()[0]!;
  writeArtifact('vim', 'colors', () => true, meta('two'), b.env);
  const recordOnly = b.journal.list()[0]!;
  restore(b.journal, planRestore(b.journal, recordOnly.id), {reviewed: true, overwrite: false});
  assert.equal(loadLedger(b.env).entries.vim!.themeRef, 'one');
  assert.equal(ownership('vim', loadLedger(b.env), b.env), 'owned');
  restore(b.journal, planRestore(b.journal, created.id), {reviewed: true, overwrite: true});
  assert.equal(existsSync(ledgerPath(b.env)), false, 'no empty record is left behind');
  assert.equal(existsSync(join(b.home, '.config/nmsh/theme-bridge/vim/colors/nmsh-bridge.vim')), false);
});
