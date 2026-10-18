import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTmuxRunner, LIST_FORMAT, listTmuxPanes, MAX_PANES, parseTmuxPanes, splitTmuxRow, tmuxNavigationArgs, tmuxResources, tmuxServer, type TmuxPane} from '../src/workspace/tmux.js';
import {renderSidebar, SidebarController} from '../src/workspace/sidebar.js';
import {managerLinks, worktreeSection} from '../src/workspace/sources.js';
import type {WorkspaceResource} from '../src/workspace/resources.js';
import type {WorktreeRecord} from '../src/worktrees/model.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';
import type {Key} from '../src/terminal/keys.js';

const S = '|';
const row = (...fields: string[]) => fields.join(S);
// One session (qa) with two windows and five panes, plus a detached session.
const LISTING = [
  row('$1', 'qa', '1', '@1', '0', 'code', '1', '%1', '0', '1', '0', 'nmsh'),
  row('$1', 'qa', '1', '@1', '0', 'code', '1', '%2', '1', '0', '0', 'nvim'),
  row('$1', 'qa', '1', '@2', '1', 'servers', '0', '%3', '0', '1', '0', 'npm'),
  row('$1', 'qa', '1', '@2', '1', 'servers', '0', '%4', '1', '0', '0', 'tail'),
  row('$1', 'qa', '1', '@2', '1', 'servers', '0', '%5', '2', '0', '1', 'zsh'),
  row('$2', 'notes\\|old', '0', '@3', '0', 'main', '1', '%6', '0', '1', '0', 'vim'),
].join('\n');

test('tmux listing: rows parse into panes; malformed rows and invalid ids are dropped, never guessed', () => {
  const panes = parseTmuxPanes(`${LISTING}\n${row('1', 'x', '1', '@9', '0', 'w', '1', '%9', '0', '1', '0', 'sh')}\n${row('$3', 'x', '1', '@9', 'zero', 'w', '1', '%9', '0', '1', '0', 'sh')}\ngarbage\n\n`);
  assert.equal(panes.length, 6);
  assert.equal(panes[5]!.sessionName, 'notes|old', 'a pipe in a name is just text');
  assert.deepEqual(panes[4], {sessionId: '$1', sessionName: 'qa', sessionAttached: true, windowId: '@2', windowIndex: 1, windowName: 'servers', windowActive: false,
    paneId: '%5', paneIndex: 2, paneActive: false, paneDead: true, command: 'zsh'});
  const odd = parseTmuxPanes(row('$1', 'qa', '1', '@1', '0', 'a\\ b\\\\\\\\c', '1', '%1', '0', '1', '0', 'we\\|ird\\\\033[31m'));
  assert.equal(odd[0]!.windowName, 'a b\\c', 'q: escaping and tmux\'s own backslash escaping are both undone');
  assert.equal(odd[0]!.command, 'we|ird', 'an escaped separator stays in its field; an escaped escape sequence is removed whole, not left as "[31m"');
  assert.deepEqual(splitTmuxRow('a\\|b|c'), ['a|b', 'c']);
  assert.equal(parseTmuxPanes(`${row('$1', 'qa', '1', '@1', '0', 'code', '1', '%1', '0', '1', '0', 'sh')}|extra`).length, 0, 'a row with too many fields is dropped');
  assert.equal(parseTmuxPanes(Array.from({length: 400}, (_, i) => row('$1', 'qa', '1', '@1', '0', 'code', '1', `%${i}`, `${i}`, '0', '0', 'sh')).join('\n')).length, MAX_PANES);
  assert.match(LIST_FORMAT, /^#\{session_id\}\|#\{q:session_name\}\|/u);
});

test('tmux hierarchy: one session with two windows and five panes is one session; NMSh\'s own pane is the active one', () => {
  const server = {socket: '/tmp/tmux-501/default', pane: '%1'};
  const section = tmuxResources(parseTmuxPanes(LISTING), server, 1000);
  assert.deepEqual(section.children!.map(session => session.label), ['qa', 'notes|old']);
  const qa = section.children![0]!;
  assert.deepEqual(qa.children!.map(window => [window.label, window.children!.length]), [['0 code', 2], ['1 servers', 3]]);
  assert.equal(qa.active, true);
  assert.equal(qa.children![0]!.active, true);
  assert.equal(qa.children![0]!.children![0]!.detail, 'this NMSh · active pane');
  assert.equal(qa.children![1]!.children![2]!.attention, 'finished');
  assert.deepEqual(qa.children![1]!.activation, {kind: 'tmux', scope: 'window', target: '@2', socket: server.socket});
  assert.equal(section.children![1]!.active, false);
  assert.equal(section.children![1]!.detail, 'detached');
  const outside = tmuxResources([], undefined, 1000);
  assert.equal(outside.support, 'informational');
  assert.match(outside.reason!, /not running inside tmux/u);
  assert.deepEqual(tmuxServer({TMUX: '/tmp/tmux-501/default,123,0', TMUX_PANE: '%7'}), {socket: '/tmp/tmux-501/default', pane: '%7'});
  assert.equal(tmuxServer({TMUX: 'relative,1,0'}), undefined);
  assert.equal(tmuxServer({}), undefined);
  assert.deepEqual(tmuxServer({TMUX: '/tmp/s,1,0', TMUX_PANE: 'bad'}), {socket: '/tmp/s'});
});

test('tmux navigation: tmux\'s own commands on validated ids, window or pane first, then the client', () => {
  const panes = parseTmuxPanes(LISTING);
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'session', target: '$2'}, panes), ['switch-client', '-t', '$2']);
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'window', target: '@2'}, panes), ['select-window', '-t', '@2', ';', 'switch-client', '-t', '$1']);
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'pane', target: '%6'}, panes),
    ['select-pane', '-t', '%6', ';', 'select-window', '-t', '@3', ';', 'switch-client', '-t', '$2']);
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'session', target: 'qa'}, panes), {error: 'not a tmux id'}, 'names are never targets');
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'pane', target: '%99'}, panes), {error: 'that tmux object is gone; refresh the list'});
  assert.deepEqual(tmuxNavigationArgs({kind: 'tmux', scope: 'session', target: '$1; kill-server'}, panes), {error: 'not a tmux id'});
});

const tmuxBinary = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'].find(path => existsSync(path));

test('tmux, for real: a private server is listed and navigated with the same argv, and nothing else is touched', {skip: tmuxBinary ? false : 'tmux is not installed'}, async () => {
  // A short private socket path: Unix sockets have a small path limit. This server is the test's own and is killed afterwards.
  const directory = await mkdtemp(join(tmpdir(), 'wsx-'));
  const socket = join(directory, 's');
  const tmux = (...args: string[]) => execFileSync(tmuxBinary!, ['-f', '/dev/null', '-S', socket, ...args], {env: {PATH: '/usr/bin:/bin', HOME: directory, TERM: 'xterm-256color'}, encoding: 'utf8'});
  try {
    tmux('new-session', '-d', '-s', 'qa|1', '-n', 'code', 'sleep 60');
    tmux('split-window', '-d', '-t', 'qa|1:0', 'sleep 60');
    tmux('new-window', '-d', '-t', 'qa|1', '-n', 'servers', 'sleep 60');
    const server = {socket};
    const run = createTmuxRunner(tmuxBinary!, server);
    const listing = await listTmuxPanes(run, 5000);
    assert.equal(listing.error, undefined);
    assert.equal(listing.panes.length, 3);
    const section = tmuxResources(listing.panes, server, listing.observedAt);
    assert.deepEqual(section.children!.map(session => [session.label, session.children!.length]), [['qa|1', 2]]);
    // Selecting the second window through the navigation argv (without switch-client: the private server has no client).
    const servers = section.children![0]!.children![1]!;
    const args = tmuxNavigationArgs(servers.activation as {kind: 'tmux'; scope: 'window'; target: string}, listing.panes);
    assert.ok(Array.isArray(args));
    const select = (args as string[]).slice(0, (args as string[]).indexOf(';'));
    assert.equal((await run(select)).code, 0);
    const after = await listTmuxPanes(run);
    assert.equal(after.panes.find(pane => pane.windowName === 'servers')?.windowActive, true);
    const failed = await createTmuxRunner(tmuxBinary!, {socket: join(directory, 'missing')})(['list-panes', '-a', '-F', LIST_FORMAT]);
    assert.notEqual(failed.code, 0, 'a server that is not there is an error, not an empty success');
    assert.match((await listTmuxPanes(createTmuxRunner(tmuxBinary!, {socket: join(directory, 'missing')}))).error ?? '', /could not list/u);
  } finally {
    try { tmux('kill-server'); } catch { /* already gone */ }
    await rm(directory, {recursive: true, force: true});
  }
});

const roots = (): WorkspaceResource[] => [
  tmuxResources(parseTmuxPanes(LISTING), {socket: '/tmp/tmux-501/default', pane: '%1'}, 1000),
  {id: 'info', kind: 'section', label: 'Codex', support: 'unsupported', reason: 'no supported Codex adapter yet'},
];
const k = (kind: Key['kind'], value?: string): Key => (value === undefined ? {kind} : {kind, value}) as Key;

test('sidebar: moving only previews; activation needs an activatable resource; expansion and parents behave like a tree', () => {
  const sidebar = new SidebarController();
  sidebar.setResources(roots());
  assert.equal(sidebar.selectedId, 'tmux');
  assert.deepEqual(sidebar.rows().map(r => r.resource.id), ['tmux', 'tmux:$1', 'tmux:$2', 'info'], 'sections open the first time they appear');
  const moved = sidebar.dispatch('sidebar.down');
  assert.equal(moved.kind, 'preview', 'selection never activates');
  assert.equal(sidebar.selectedId, 'tmux:$1');
  assert.equal(sidebar.dispatch('sidebar.expand').kind, 'none');
  assert.deepEqual(sidebar.rows().slice(1, 4).map(r => r.resource.id), ['tmux:$1', 'tmux:$1:@1', 'tmux:$1:@2']);
  sidebar.dispatch('sidebar.down');
  const opened = sidebar.dispatch('sidebar.activate');
  assert.deepEqual(opened.kind === 'activate' ? opened.intent : undefined, {kind: 'tmux', scope: 'window', target: '@1', socket: '/tmp/tmux-501/default'});
  assert.equal(sidebar.dispatch('sidebar.collapse').kind, 'preview', 'Left on a child moves to its parent');
  assert.equal(sidebar.selectedId, 'tmux:$1');
  sidebar.dispatch('sidebar.collapse');
  assert.ok(!sidebar.expanded.has('tmux:$1'));
  sidebar.dispatch('sidebar.last');
  const unavailable = sidebar.dispatch('sidebar.activate');
  assert.deepEqual(unavailable.kind === 'unavailable' ? unavailable.reason : undefined, 'no supported Codex adapter yet');
  assert.equal(sidebar.dispatch('sidebar.down').kind, 'none', 'the end of the list stays put');
});

test('sidebar: selection follows its id across refreshes; a vanished selection moves to the row in its place; expansion is kept', () => {
  const sidebar = new SidebarController();
  sidebar.setResources(roots());
  sidebar.dispatch('sidebar.down');
  sidebar.dispatch('sidebar.expand');
  sidebar.dispatch('sidebar.down');
  assert.equal(sidebar.selectedId, 'tmux:$1:@1');
  const reordered = roots();
  reordered[0] = {...reordered[0]!, children: [...reordered[0]!.children!].reverse()};
  sidebar.setResources(reordered);
  assert.equal(sidebar.selectedId, 'tmux:$1:@1', 'same id, new position');
  assert.ok(sidebar.expanded.has('tmux:$1'));
  sidebar.setResources(roots());
  const gone = roots();
  gone[0] = {...gone[0]!, children: gone[0]!.children!.map(session => session.id === 'tmux:$1' ? {...session, children: session.children!.slice(1)} : session)};
  sidebar.setResources(gone);
  assert.equal(sidebar.selectedId, 'tmux:$1:@2', 'the row that took its place');
  sidebar.dispatch('sidebar.collapse'); sidebar.dispatch('sidebar.collapse');
  sidebar.setResources(roots());
  assert.ok(!sidebar.expanded.has('tmux:$1'), 'a person\'s collapse is kept across refreshes');
});

test('sidebar filter: matches show with their ancestors; typing stays in the filter; Esc clears it', () => {
  const sidebar = new SidebarController();
  sidebar.setResources(roots());
  sidebar.dispatch('sidebar.search');
  for (const ch of 'tail') assert.equal(sidebar.handleSearchKey(k('text', ch)), true);
  assert.deepEqual(sidebar.rows().map(r => r.resource.id), ['tmux', 'tmux:$1', 'tmux:$1:@2', 'tmux:$1:@2:%4']);
  assert.equal(sidebar.selectedId, 'tmux:$1:@2:%4', 'the selection moves to the first direct match, not an ancestor shown for context');
  assert.equal(sidebar.handleSearchKey(k('down')), false, 'navigation is not the filter\'s');
  sidebar.handleSearchKey(k('text', '\u001b[31m'));
  assert.equal(sidebar.filter, 'tail[31m', 'controls never enter the filter');
  sidebar.handleSearchKey(k('escape'));
  assert.equal(sidebar.filter, '');
  assert.equal(sidebar.searching, false);
});

test('sidebar rendering: exact size at every width; focus, selection, active and attention have marks without color', () => {
  const sidebar = new SidebarController();
  sidebar.setResources([...roots(), {id: 'evil', kind: 'section', label: '\u001b]8;;x\u0007‮evil\nname', support: 'informational', reason: 'r'}]);
  sidebar.dispatch('sidebar.down'); sidebar.dispatch('sidebar.expand'); sidebar.dispatch('sidebar.down'); sidebar.dispatch('sidebar.expand');
  for (const safe of [true, false]) {
    for (const width of [8, 12, 18, 28, 40]) {
      for (const rows of [1, 3, 8, 20]) {
        for (const color of [false, true]) {
          const lines = renderSidebar(sidebar, {width, rows, focused: true, mode: width < 20 ? 'compact' : 'docked', safe, color, now: 2000});
          assert.equal(lines.length, rows);
          for (const line of lines) {
            assert.ok(displayWidth(stripAnsi(line)) <= width, `${width}: ${JSON.stringify(stripAnsi(line))}`);
            assert.doesNotMatch(stripAnsi(line), /[\u0000-\u001f\u007f‮]/u);
          }
        }
      }
    }
  }
  sidebar.expanded.add('tmux:$1:@2');
  const plain = renderSidebar(sidebar, {width: 40, rows: 20, focused: true, mode: 'docked', safe: true, color: false, now: 2000});
  assert.match(plain[0]!, /^> Workspace \(focused\)/u);
  assert.ok(plain.some(line => /^> {4}- \* 0 code/u.test(line)), plain.join('\n'));
  assert.ok(plain.some(line => /^ {9}\* nmsh {2}this NMSh/u.test(line)), 'the active pane is marked without being selected');
  assert.ok(plain.some(line => /zsh \(exited\)/u.test(line)));
  const unfocused = renderSidebar(sidebar, {width: 40, rows: 20, focused: false, mode: 'docked', safe: true, color: false, now: 2000});
  assert.match(unfocused[0]!, /^ {2}Workspace$/u);
  assert.ok(!unfocused.some(line => /Enter open/u.test(line)), 'key help shows only while focused');
  assert.ok(plain.some(line => /Enter open/u.test(line)));
  const stale = renderSidebar(sidebar, {width: 40, rows: 20, focused: false, mode: 'docked', safe: true, color: false, now: 1000 + 60_000});
  assert.match(stale.join('\n'), /tmux \(stale\)/u);
});

test('worktree and manager sections: opening a worktree changes directory; a missing path is listed but not openable', () => {
  const record = (path: string, extra: Partial<WorktreeRecord> = {}): WorktreeRecord => ({id: path, path, ref: 'refs/heads/main', branch: 'main', head: 'abc1234def',
    detached: false, bare: false, main: false, locked: false, prunable: false, pathState: 'present', status: {kind: 'clean'} as WorktreeRecord['status'], ...extra});
  const section = worktreeSection({commonDir: '/r/.git', truncated: false, discoveredAt: 5, worktrees: [record('/r', {main: true}), record('/w/feature', {branch: 'feature', pathState: 'missing'})]}, '/r/src');
  assert.deepEqual(section.children!.map(child => [child.label, child.support, child.active]), [['main', 'activatable', true], ['feature', 'unsupported', false]]);
  assert.deepEqual(section.children![0]!.activation, {kind: 'changeDirectory', path: '/r'});
  assert.match(section.children![1]!.reason!, /missing/u);
  assert.equal(worktreeSection(undefined, '/').support, 'informational');
  // A worktree inside another's directory: only the innermost one holding the shell's directory is current.
  const nested = worktreeSection({commonDir: '/r/.git', truncated: false, discoveredAt: 5, worktrees: [record('/r', {main: true}), record('/r/.worktrees/feature', {branch: 'feature'}), record('/r2', {branch: 'other'})]}, '/r/.worktrees/feature/src');
  assert.deepEqual(nested.children!.map(child => [child.label, child.active]), [['main', false], ['feature', true], ['other', false]]);
  assert.equal(worktreeSection({commonDir: '/r/.git', truncated: false, discoveredAt: 5, worktrees: [record('/r'), record('/r2', {branch: 'other'})]}, '/r2').children![0]!.active, false, 'a sibling path with the same prefix is not inside');
  assert.ok(managerLinks().children!.every(link => link.support === 'activatable' && link.activation?.kind === 'openManager'));
});
