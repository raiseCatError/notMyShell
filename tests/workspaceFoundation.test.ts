import test from 'node:test';
import assert from 'node:assert/strict';
import {CENTER_MIN_COLUMNS, columnAt, frameColumn, planWorkspaceColumns, SIDEBAR_COMPACT_COLUMNS, SIDEBAR_DOCKED_COLUMNS} from '../src/workspace/layout.js';
import {isStale, normalizeResource, resourceIds, resourceText, visibleRows, type WorkspaceResource} from '../src/workspace/resources.js';
import {applyFocusAction, regionOf, resumeFocus, routeWorkspaceKey, type WorkspaceOwner} from '../src/workspace/focus.js';
import {bindingHelp, DEFAULT_BINDINGS, resolveBinding, type Binding} from '../src/workspace/keymap.js';
import type {Key} from '../src/terminal/keys.js';

test('column plan: docked, compact and drawer by measured width; the center never drops below its minimum because of a dock', () => {
  const widths = [240, 160, 120, 100, 89, 88, 80, 79, 78, 77, 70, 60, 50, 40, 30, 12, 1];
  for (const columns of widths) {
    for (const [sidebarOpen, panelOpen] of [[true, false], [false, true], [true, true]] as const) {
      const plan = planWorkspaceColumns({columns, sidebarOpen, panelOpen});
      const docked = [plan.sidebar, plan.panel].filter(region => region.mode === 'docked' || region.mode === 'compact');
      if (docked.length) assert.ok(plan.center.width >= CENTER_MIN_COLUMNS, `${columns} ${sidebarOpen}/${panelOpen}: center ${plan.center.width}`);
      assert.equal(plan.ptyColumns, plan.center.width, 'the PTY is the center');
      // Regions never leave the frame and docked regions never overlap the center.
      for (const region of [plan.sidebar.region, plan.panel.region, plan.center].filter(Boolean)) {
        assert.ok(region!.x >= 0 && region!.x + region!.width <= columns, `${columns}: ${JSON.stringify(region)}`);
      }
      if (plan.sidebar.mode === 'docked' || plan.sidebar.mode === 'compact') assert.ok(plan.sidebar.region!.x + plan.sidebar.region!.width < plan.center.x + 1);
      if (plan.panel.mode === 'docked') assert.ok(plan.center.x + plan.center.width <= plan.panel.region!.x);
    }
  }
  assert.equal(planWorkspaceColumns({columns: 120, sidebarOpen: true, panelOpen: false}).sidebar.mode, 'docked');
  assert.equal(planWorkspaceColumns({columns: SIDEBAR_DOCKED_COLUMNS + 1 + CENTER_MIN_COLUMNS, sidebarOpen: true, panelOpen: false}).sidebar.mode, 'docked');
  assert.equal(planWorkspaceColumns({columns: SIDEBAR_DOCKED_COLUMNS + CENTER_MIN_COLUMNS, sidebarOpen: true, panelOpen: false}).sidebar.mode, 'compact');
  assert.equal(planWorkspaceColumns({columns: SIDEBAR_COMPACT_COLUMNS + CENTER_MIN_COLUMNS, sidebarOpen: true, panelOpen: false}).sidebar.mode, 'drawer');
  // Both open at a medium width: the sidebar narrows to compact before the panel becomes a drawer.
  const both = planWorkspaceColumns({columns: 130, sidebarOpen: true, panelOpen: true});
  assert.deepEqual([both.sidebar.mode, both.panel.mode], ['compact', 'docked']);
  const tighter = planWorkspaceColumns({columns: 120, sidebarOpen: true, panelOpen: true});
  assert.deepEqual([tighter.sidebar.mode, tighter.panel.mode], ['docked', 'drawer'], 'when even a compact sidebar leaves no room, the panel is a drawer and the sidebar stays as it was');
  assert.deepEqual([planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true}).sidebar.mode, planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true}).panel.mode], ['docked', 'docked']);
  assert.equal(planWorkspaceColumns({columns: 90, sidebarOpen: true, panelOpen: true}).panel.mode, 'drawer');
});

test('drawers overlay the center without resizing the shell; suppression hides everything and gives the PTY the whole width', () => {
  const closed = planWorkspaceColumns({columns: 70, sidebarOpen: false, panelOpen: false});
  const drawer = planWorkspaceColumns({columns: 70, sidebarOpen: true, panelOpen: false});
  assert.equal(drawer.sidebar.mode, 'drawer');
  assert.equal(drawer.ptyColumns, closed.ptyColumns, 'opening a drawer is not a resize');
  assert.equal(columnAt(drawer, 5), 'sidebar', 'the drawer is on top where it overlaps');
  assert.equal(columnAt(drawer, 60), 'center');
  const narrow = planWorkspaceColumns({columns: 40, sidebarOpen: false, panelOpen: true});
  assert.deepEqual(narrow.panel, {mode: 'drawer', region: {x: 0, width: 40}}, 'below twice the drawer minimum a drawer takes the whole width');
  const suppressed = planWorkspaceColumns({columns: 200, sidebarOpen: true, panelOpen: true, suppressed: true});
  assert.deepEqual([suppressed.sidebar.mode, suppressed.panel.mode, suppressed.ptyColumns], ['hidden', 'hidden', 200]);
  const docked = planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true});
  assert.equal(columnAt(docked, SIDEBAR_DOCKED_COLUMNS), 'divider');
  assert.equal(columnAt(docked, 0), 'sidebar');
  assert.equal(columnAt(docked, 159), 'panel');
  assert.equal(frameColumn(docked, 0), SIDEBAR_DOCKED_COLUMNS + 1);
  assert.equal(columnAt(docked, 200), undefined);
  // Deterministic: the same input gives the same plan, so resizing back restores the earlier layout.
  assert.deepEqual(planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true}), docked);
});

const tree = (): WorkspaceResource[] => [{
  id: 'tmux', kind: 'section', label: 'TMUX', support: 'informational', children: [{
    id: 'tmux:$1', kind: 'tmuxSession', label: 'qa', support: 'activatable', activation: {kind: 'tmux', scope: 'session', target: '$1'}, children: [
      {id: 'tmux:$1:@1', kind: 'tmuxWindow', label: '0 code', support: 'activatable', activation: {kind: 'tmux', scope: 'window', target: '@1'}},
      {id: 'tmux:$1:@2', kind: 'tmuxWindow', label: '1 servers', support: 'activatable', activation: {kind: 'tmux', scope: 'window', target: '@2'}},
    ]}],
}];

test('resources: hidden-row expansion, stable ids, freshness, and an activatable claim needs a real activation path', () => {
  const roots = tree();
  assert.deepEqual(visibleRows(roots, new Set()).map(row => row.resource.id), ['tmux']);
  const open = visibleRows(roots, new Set(['tmux', 'tmux:$1']));
  assert.deepEqual(open.map(row => [row.resource.id, row.depth]), [['tmux', 0], ['tmux:$1', 1], ['tmux:$1:@1', 2], ['tmux:$1:@2', 2]]);
  assert.deepEqual(open.map(row => row.expandable), [true, true, false, false]);
  assert.deepEqual([...resourceIds(roots)].sort(), ['tmux', 'tmux:$1', 'tmux:$1:@1', 'tmux:$1:@2']);
  const fake = normalizeResource({id: 'x', kind: 'managedTarget', label: 'Codex', support: 'activatable'})!;
  assert.equal(fake.support, 'unsupported');
  assert.match(fake.reason!, /no supported way/u);
  assert.equal(isStale({observedAt: 1000}, 3000, 5000), false);
  assert.equal(isStale({observedAt: 1000}, 9000, 5000), true);
  assert.equal(isStale({}, 9000, 5000), true, 'unknown observation time is never fresh');
});

test('resources: hostile names are inert, bounded in length, count and depth', () => {
  const hostile = normalizeResource({id: 'evil', kind: 'tmuxSession', label: '\u001b]8;;https://x\u0007click\u001b[2J‮\nname' + 'x'.repeat(500),
    detail: 'cmd\u0000\u0007', support: 'informational', reason: '\u001b[31mred'})!;
  for (const text of [hostile.label, hostile.detail!, hostile.reason!]) assert.doesNotMatch(text, /[\u0000-\u001f\u007f-\u009f‮]/u);
  assert.ok(hostile.label.length <= 80);
  assert.equal(resourceText('  a \n\t b  '), 'a b');
  // Whole sequences go, not just their ESC: no `]0;PWNED` or `[31m` debris that reads like part of the name.
  assert.equal(resourceText('evil\u001b]0;PWNED\u0007 session'), 'evil session');
  assert.equal(resourceText('\u001b[31mred\u001b[0m window'), 'red window');
  assert.equal(resourceText('\u009b2Jclear\u009d8;;https://x\u009clink'), 'clearlink');
  let deep: WorkspaceResource = {id: 'leaf', kind: 'tmuxPane', label: 'leaf', support: 'informational'};
  for (let i = 0; i < 10; i++) deep = {id: `n${i}`, kind: 'section', label: `n${i}`, support: 'informational', children: [deep]};
  const normalized = normalizeResource(deep)!;
  let depth = 0;
  for (let node: WorkspaceResource | undefined = normalized; node; node = node.children?.[0]) depth += 1;
  assert.equal(depth, 4, 'at most four levels');
  const wide = normalizeResource({id: 'root', kind: 'section', label: 'root', support: 'informational',
    children: Array.from({length: 2000}, (_, i) => ({id: `c${i}`, kind: 'tmuxPane' as const, label: `c${i}`, support: 'informational' as const}))})!;
  assert.equal(wide.children!.length, 511, 'at most 512 resources in all');
});

const key = (kind: Key['kind'], value?: string): Key => (value === undefined ? {kind} : {kind, value}) as Key;

test('focus: protected owners keep every key; the composer keeps typing and its draft; regions get their bindings', () => {
  const base = {composerEmpty: true, sidebarOpen: true, panelOpen: true};
  for (const owner of ['PASSTHROUGH', 'APPROVAL', 'CHOICE', 'SEARCH', 'AGENT_MESSAGE', 'PANEL', 'TRANSCRIPT'] as WorkspaceOwner[]) {
    for (const k of [key('up'), key('escape'), key('enter'), key('complete'), key('text', '/')]) assert.equal(routeWorkspaceKey(k, {...base, owner}), undefined, `${owner} ${k.kind}`);
  }
  for (const k of [key('left'), key('right'), key('up'), key('complete'), key('focusPrevious'), key('text', '1'), key('escape')]) {
    assert.equal(routeWorkspaceKey(k, {...base, owner: 'COMPOSER'}), undefined, `default composer bindings take nothing (${k.kind})`);
  }
  // An opt-in composer binding applies only with an empty draft, and never to typing.
  const optIn: Binding[] = [...DEFAULT_BINDINGS, {action: 'sidebar.focus', context: 'composerEmpty', key: {kind: 'left'}}, {action: 'panel.toggle', context: 'composerEmpty', key: {kind: 'text', text: 'p'}}];
  assert.equal(routeWorkspaceKey(key('left'), {...base, owner: 'COMPOSER', bindings: optIn}), 'sidebar.focus');
  assert.equal(routeWorkspaceKey(key('left'), {...base, owner: 'COMPOSER', composerEmpty: false, bindings: optIn}), undefined, 'an active draft wins');
  assert.equal(routeWorkspaceKey(key('text', 'p'), {...base, owner: 'COMPOSER', bindings: optIn}), undefined, 'typing always reaches the shell');
  assert.equal(routeWorkspaceKey(key('down'), {...base, owner: 'LEFT_SIDEBAR'}), 'sidebar.down');
  assert.equal(routeWorkspaceKey(key('enter'), {...base, owner: 'LEFT_SIDEBAR'}), 'sidebar.activate');
  assert.equal(routeWorkspaceKey(key('text', '/'), {...base, owner: 'LEFT_SIDEBAR'}), 'sidebar.search');
  assert.equal(routeWorkspaceKey(key('text', 'x'), {...base, owner: 'LEFT_SIDEBAR'}), undefined);
  assert.equal(routeWorkspaceKey(key('down'), {...base, owner: 'LEFT_SIDEBAR', sidebarOpen: false}), undefined, 'a closed region owns nothing');
  assert.equal(routeWorkspaceKey(key('pageDown'), {...base, owner: 'RIGHT_PANEL'}), 'panel.pageDown');
});

test('focus transitions: closing a focused region returns to the composer; cycling skips closed regions; passthrough return restores', () => {
  let state = {owner: 'COMPOSER' as WorkspaceOwner, sidebarOpen: false, panelOpen: false};
  state = applyFocusAction(state, 'sidebar.focus');
  assert.deepEqual(state, {owner: 'LEFT_SIDEBAR', sidebarOpen: true, panelOpen: false});
  assert.equal(applyFocusAction(state, 'focus.cycle').owner, 'COMPOSER', 'the panel is closed, so the cycle skips it');
  state = applyFocusAction(state, 'panel.toggle');
  assert.equal(state.owner, 'LEFT_SIDEBAR', 'opening the panel does not steal focus');
  assert.equal(applyFocusAction(state, 'focus.cycle').owner, 'RIGHT_PANEL');
  assert.deepEqual(applyFocusAction(state, 'sidebar.toggle'), {owner: 'COMPOSER', sidebarOpen: false, panelOpen: true});
  const panel = applyFocusAction(state, 'panel.focus');
  assert.deepEqual(applyFocusAction(panel, 'panel.close'), {owner: 'COMPOSER', sidebarOpen: true, panelOpen: false});
  assert.equal(applyFocusAction(panel, 'focus.return').owner, 'COMPOSER');
  assert.equal(applyFocusAction(panel, 'sidebar.down').owner, 'RIGHT_PANEL', 'region actions leave focus alone');
  assert.equal(resumeFocus(panel, {sidebarOpen: true, panelOpen: true}).owner, 'RIGHT_PANEL');
  assert.equal(resumeFocus(panel, {sidebarOpen: true, panelOpen: false}).owner, 'COMPOSER');
});

test('help derives from the bindings in effect', () => {
  assert.deepEqual(bindingHelp(DEFAULT_BINDINGS, 'panel').map(([chord]) => chord), ['↑', '↓', 'PgUp', 'PgDn', 'Esc', 'Tab', 'q']);
  assert.equal(resolveBinding(DEFAULT_BINDINGS, 'sidebar', key('escape')), 'focus.return');
  assert.deepEqual(bindingHelp(DEFAULT_BINDINGS, 'composerEmpty'), []);
});

test('drawers follow the keyboard: only a focused drawer is drawn, and opening one that can only be a drawer focuses it', () => {
  // 40 columns: both regions can only be full-width drawers.
  const both = {columns: 40, sidebarOpen: true, panelOpen: true};
  assert.deepEqual([planWorkspaceColumns(both).sidebar.mode, planWorkspaceColumns(both).panel.mode], ['drawer', 'drawer'], 'without focus every open drawer is drawn (as before)');
  const typing = planWorkspaceColumns({...both, focus: 'center'});
  assert.deepEqual([typing.sidebar, typing.panel], [{mode: 'hidden', tucked: true}, {mode: 'hidden', tucked: true}], 'nothing covers the composer being typed in');
  assert.equal(columnAt(typing, 5), 'center');
  const panel = planWorkspaceColumns({...both, focus: 'panel'});
  assert.deepEqual([panel.sidebar.mode, panel.panel.mode], ['hidden', 'drawer'], 'one drawer at a time: the focused one');
  assert.equal(columnAt(panel, 5), 'panel');
  assert.equal(panel.ptyColumns, 40, 'tucking is not a resize');
  // Docked regions are drawn whatever has focus.
  const wide = planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true, focus: 'center'});
  assert.deepEqual([wide.sidebar.mode, wide.panel.mode], ['docked', 'docked']);

  const composer = {owner: 'COMPOSER' as WorkspaceOwner, sidebarOpen: false, panelOpen: false};
  assert.equal(applyFocusAction(composer, 'sidebar.toggle', 160).owner, 'COMPOSER', 'a docked region opens without taking focus');
  assert.equal(applyFocusAction(composer, 'sidebar.toggle', 40).owner, 'LEFT_SIDEBAR', 'a drawer opens focused, or it would not be drawn');
  assert.equal(applyFocusAction({...composer, sidebarOpen: true}, 'panel.toggle', 120).owner, 'RIGHT_PANEL', 'beside a docked sidebar at 120 the panel is a drawer');
  assert.equal(applyFocusAction(composer, 'sidebar.toggle').owner, 'COMPOSER', 'without the width, focus is unchanged (as before)');
  // Leaving a drawer keeps it open (tucked); focusing it again shows it where it was.
  const inDrawer = applyFocusAction(composer, 'sidebar.toggle', 40);
  const back = applyFocusAction(inDrawer, 'focus.return', 40);
  assert.deepEqual(back, {owner: 'COMPOSER', sidebarOpen: true, panelOpen: false});
  assert.equal(planWorkspaceColumns({columns: 40, sidebarOpen: back.sidebarOpen, panelOpen: back.panelOpen, focus: regionOf(back.owner)}).sidebar.tucked, true);
  assert.deepEqual(applyFocusAction(back, 'sidebar.toggle', 40), {owner: 'LEFT_SIDEBAR', sidebarOpen: true, panelOpen: false}, '/sidebar on a tucked drawer shows it');
  assert.deepEqual(applyFocusAction(inDrawer, 'sidebar.toggle', 40), {owner: 'COMPOSER', sidebarOpen: false, panelOpen: false}, '/sidebar on the shown drawer closes it');
  assert.equal(applyFocusAction({owner: 'COMPOSER', sidebarOpen: true, panelOpen: false}, 'sidebar.toggle', 160).sidebarOpen, false, 'a docked region still toggles closed');
  assert.equal(regionOf('APPROVAL'), 'center');
});
