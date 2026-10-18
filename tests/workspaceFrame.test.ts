import assert from 'node:assert/strict';
import test from 'node:test';
import {composeWorkspaceRows, fitRow, sliceColumns} from '../src/app/workspaceFrame.js';
import {planWorkspaceColumns} from '../src/workspace/layout.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const RED = '\u001B[31m';
const RESET = '\u001B[0m';

test('fitRow: exactly the width, erase-in-line removed, an open hyperlink closed, long rows cut', () => {
  const padded = fitRow(`${RED}ab\u001B[K`, 6);
  assert.equal(displayWidth(padded), 6);
  assert.ok(!padded.includes('\u001B[K'), 'erase-in-line would wipe the neighbouring region');
  assert.ok(padded.endsWith(RESET));
  assert.equal(displayWidth(fitRow('x'.repeat(20), 8)), 8);
  const link = fitRow('\u001B]8;;https://example.com\u001B\\site', 10);
  assert.ok(link.includes('\u001B]8;;\u001B\\'), 'a link left open would extend over the next region');
  const closed = fitRow('\u001B]8;;https://example.com\u001B\\site\u001B]8;;\u001B\\', 10);
  assert.equal(closed.split('\u001B]8;;\u001B\\').length - 1, 1, 'a closed link is not closed twice');
});

test('sliceColumns keeps the style in effect where it starts and keeps wide characters aligned', () => {
  const row = `${RED}0123456789${RESET}`;
  const slice = sliceColumns(row, 3, 4);
  assert.equal(stripAnsi(slice), '3456');
  assert.ok(slice.startsWith(RED));
  assert.equal(displayWidth(sliceColumns('a界b', 2, 2)), 2, 'a wide character cut by the edge becomes a space');
  assert.equal(stripAnsi(sliceColumns('abc', 1, 5)), 'bc   ');
});

test('docked regions: sidebar, dividers, center and panel fill each row exactly; the Status Strip row is full width', () => {
  const plan = planWorkspaceColumns({columns: 160, sidebarOpen: true, panelOpen: true});
  assert.equal(plan.sidebar.mode, 'docked');
  assert.equal(plan.panel.mode, 'docked');
  const rows = ['STATUS', 'center one', `${RED}center two\u001B[K`];
  const composed = composeWorkspaceRows({rows, plan, sidebar: ['side one', 'side two'], panel: ['panel one', 'panel two'],
    fullWidth: new Map([[0, 'STATUS STRIP AT FULL WIDTH']]), divider: '│'});
  assert.equal(composed.length, 3);
  for (const row of composed) assert.equal(displayWidth(row), 160);
  assert.match(stripAnsi(composed[0]!), /^STATUS STRIP AT FULL WIDTH/u);
  const plain = stripAnsi(composed[1]!);
  assert.ok(plain.startsWith('side one'));
  assert.equal(plain.indexOf('center one'), plan.center.x, 'center text starts at the center column');
  for (const divider of plan.dividers) assert.equal([...plain][divider], '│');
  assert.equal(plain.indexOf('panel one'), plan.panel.region!.x);
  assert.ok(stripAnsi(composed[2]!).includes('side two'), 'the sidebar spans the rows below the full-width row');
});

test('a focused drawer lies over the center without changing its width; the rest of the center stays visible', () => {
  const plan = planWorkspaceColumns({columns: 70, sidebarOpen: true, panelOpen: false, focus: 'sidebar'});
  assert.equal(plan.sidebar.mode, 'drawer');
  assert.equal(plan.ptyColumns, 70, 'opening a drawer never resizes the shell');
  const center = `${'abcdefghij'.repeat(7)}`;
  const [row] = composeWorkspaceRows({rows: [center], plan, sidebar: ['SIDEBAR'], divider: '│'});
  assert.equal(displayWidth(row!), 70);
  const plain = stripAnsi(row!);
  const width = plan.sidebar.region!.width;
  assert.ok(plain.startsWith('SIDEBAR'));
  assert.equal(plain[width], '│');
  assert.equal(plain.slice(width + 1), center.slice(width + 1));
  // The same drawer without the keyboard is tucked: nothing is drawn over the composer typing goes to.
  const tucked = planWorkspaceColumns({columns: 70, sidebarOpen: true, panelOpen: false, focus: 'center'});
  assert.equal(stripAnsi(composeWorkspaceRows({rows: [center], plan: tucked, sidebar: ['SIDEBAR'], divider: '│'})[0]!), center);
});

test('a panel drawer keeps its right edge, and at 40 columns a drawer takes the whole width', () => {
  const plan = planWorkspaceColumns({columns: 80, sidebarOpen: false, panelOpen: true, focus: 'panel'});
  assert.equal(plan.panel.mode, 'drawer');
  const [row] = composeWorkspaceRows({rows: ['x'.repeat(80)], plan, panel: ['PANEL'], divider: '│'});
  assert.equal(displayWidth(row!), 80);
  assert.equal(stripAnsi(row!).indexOf('PANEL'), plan.panel.region!.x);
  const narrow = planWorkspaceColumns({columns: 40, sidebarOpen: true, panelOpen: false, focus: 'sidebar'});
  const [small] = composeWorkspaceRows({rows: ['y'.repeat(40)], plan: narrow, sidebar: ['ONLY'], divider: '│'});
  assert.equal(displayWidth(small!), 40);
  assert.ok(!stripAnsi(small!).includes('y'));
  // A panel drawer beside a docked sidebar never reaches left of the center.
  const mixed = planWorkspaceColumns({columns: 92, sidebarOpen: true, panelOpen: true, focus: 'panel'});
  for (const composed of composeWorkspaceRows({rows: ['z'.repeat(mixed.center.width)], plan: mixed, sidebar: ['S'], panel: ['P'], divider: '│'})) {
    assert.equal(displayWidth(composed), 92);
  }
});
