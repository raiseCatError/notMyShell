import test from 'node:test';
import assert from 'node:assert/strict';
import {isolateConfig} from './support/isolatedConfig.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {DEFAULT_PROMPT_CONFIGURATION} from '../src/prompt/configuration.js';
import {
  CONFIG_GROUPS, CONFIG_GROUP_BY_CATEGORY, CONFIG_GROUP_BY_ID, configGroup, renderSettingsPanel, SETTINGS_ROWS, statusLineCount, statusSection, visibleSettingsRows,
  type SettingsPanelState, type StatusSections,
} from '../src/ui/SettingsPanel.js';
import {groupedWindow, groupLines} from '../src/ui/groupedList.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const state = (patch: Partial<SettingsPanelState> = {}): SettingsPanelState => ({section: 'root', view: 'config', selectedIndex: 0, glyphStyle: 'nerd', onboarding: false, ...patch});
const config = DEFAULT_PROMPT_CONFIGURATION;
const render = (patch: Partial<SettingsPanelState>, columns = 90, height = 60) => renderSettingsPanel(state(patch), columns, height, {configuration: config}).map(stripAnsi);
const isHeader = (line: string) => (CONFIG_GROUPS as readonly string[]).includes(line.trim());

test('Config: every setting belongs to a deliberate group, in the curated order, with no one-row groups', () => {
  for (const row of SETTINGS_ROWS) {
    const root = (() => { let current = row; while (current.parent) current = SETTINGS_ROWS.find(item => item.id === current.parent) ?? current; return current; })();
    assert.ok(CONFIG_GROUP_BY_ID[root.id] || CONFIG_GROUP_BY_CATEGORY[root.category], `${row.id} (${root.category}) has a group`);
  }
  const rows = visibleSettingsRows(state({showAdvanced: true}), config);
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(configGroup(row), (counts.get(configGroup(row)) ?? 0) + 1);
  assert.deepEqual([...counts.keys()], [...CONFIG_GROUPS].filter(group => counts.has(group)), 'groups appear in the curated order and each once');
  for (const [group, count] of counts) assert.ok(count >= 3, `${group} has ${count} rows`);
  // A child always follows its parent inside the same group.
  rows.forEach((row, index) => {
    if (!row.parent) return;
    const parentIndex = rows.findIndex(item => item.id === row.parent);
    assert.ok(parentIndex >= 0 && parentIndex < index, `${row.id} after ${row.parent}`);
    assert.equal(configGroup(rows[parentIndex]!), configGroup(row));
  });
});

test('Config renders group headings; headings are not selectable and not part of the selection index', () => {
  const rows = visibleSettingsRows(state(), config);
  const lines = render({contentIndex: 0});
  const headings = lines.filter(isHeader);
  assert.deepEqual(headings.slice(0, 4), ['  General', '  Appearance', '  Prompt & Composer', '  Editor'].map(item => item.trim()).map(item => `  ${item}`));
  // The selected row is always an actual setting: walk the whole list.
  for (let index = 0; index < rows.length; index += 7) {
    const shown = render({contentIndex: index});
    const pointer = shown.filter(line => /^ {2}› /u.test(line));
    assert.equal(pointer.length, 1, `one pointer at ${index}`);
    assert.ok(pointer[0]!.includes(rows[index]!.label), `pointer on ${rows[index]!.label}`);
    assert.ok(!isHeader(pointer[0]!.replace('›', ' ')));
  }
  const total = groupLines(rows, configGroup).filter(line => line.kind === 'item').length;
  assert.equal(total, rows.length, 'headings add lines, never rows');
});

test('Config: parent/child indentation survives grouping, and Advanced rows sit inside their own groups', () => {
  const lines = render({showAdvanced: true, contentIndex: 0}, 90, 200);
  const at = (label: string) => lines.findIndex(line => line.includes(label) && !isHeader(line));
  assert.ok(at('Divider density') > at('History divider') && /^ {6}/u.test(lines[at('Divider density')]!), 'children indent under the parent');
  const general = lines.findIndex(line => line.trim() === 'General');
  const appearance = lines.findIndex(line => line.trim() === 'Appearance');
  assert.ok(at('Multiple detached sessions') > general && at('Multiple detached sessions') < appearance, 'an advanced General row is inside General, not at the bottom');
  const cursor = lines.findIndex(line => line.trim() === 'Cursor & Motion');
  const sessions = lines.findIndex(line => line.trim() === 'Sessions & Alerts');
  assert.ok(at('Cursor speed') > cursor && at('Cursor speed') < sessions, 'advanced cursor rows are inside Cursor & Motion');
  const withoutAdvanced = render({showAdvanced: false, contentIndex: 0}, 90, 200);
  assert.ok(!withoutAdvanced.some(line => line.includes('Multiple detached sessions')));
});

test('Config search keeps matching headings only, with no empty heading and highlighted matches', () => {
  for (const query of ['cursor', 'notif', 'divider', 'theme', 'zzzz', 'sess', 'local', 'color']) {
    const lines = render({searchQuery: query, contentIndex: 0}, 90, 80);
    const body = lines.slice(lines.findIndex(line => line.includes('╰')) + 1);
    const stop = body.findIndex(line => line.trim() === '');
    const list = stop < 0 ? body : body.slice(0, stop);
    list.forEach((line, index) => { if (isHeader(line)) assert.ok(list[index + 1] && !isHeader(list[index + 1]!), `${query}: heading "${line.trim()}" has a row under it`); });
    const rows = visibleSettingsRows(state({searchQuery: query}), config);
    const expectedGroups = new Set(rows.map(configGroup));
    assert.deepEqual(new Set(list.filter(isHeader).map(line => line.trim())), new Set([...expectedGroups].filter(group => list.some(line => line.trim() === group))), query);
  }
  const lines = render({searchQuery: 'cursor'}, 90, 60);
  assert.ok(lines.some(line => line.trim() === 'Cursor & Motion'));
  assert.ok(!lines.some(line => line.trim() === 'Editor'), 'groups without a match disappear');
  const styled = renderSettingsPanel(state({searchQuery: 'cursor'}), 90, 60, {configuration: config});
  assert.ok(styled.some(line => line.includes('\u001b[4m')), 'matches stay highlighted');
});

test('Config keeps the selected row visible, avoids orphan headings, and stays bounded on short and narrow terminals', () => {
  const rows = visibleSettingsRows(state({showAdvanced: true}), config);
  for (const height of [10, 14, 20, 30]) for (const columns of [30, 50, 90]) {
    for (let index = 0; index < rows.length; index += 3) {
      const out = renderSettingsPanel(state({showAdvanced: true, contentIndex: index}), columns, height, {configuration: config});
      assert.ok(out.length <= height, `${columns}x${height} fits`);
      for (const line of out) assert.ok(displayWidth(line) <= columns, `${columns}: ${stripAnsi(line)}`);
      const text = out.map(stripAnsi);
      assert.equal(text.filter(line => /^ {2}› /u.test(line)).length, 1, `${columns}x${height}: the selected row is on screen (${index})`);
      if (columns >= 50) assert.ok(text.some(line => /^ {2}› /u.test(line) && line.includes(rows[index]!.label.slice(0, 3))), `${columns}x${height}: row ${index} is the selected one`);
      // A heading is never the last line of the list (the line before the blank/description is a row or a cue).
      const last = text.findLastIndex(line => isHeader(line));
      if (last >= 0 && last < text.length - 1) assert.ok(text[last + 1] !== '' && !/^\s*↓/u.test(text[last + 1]!), `${columns}x${height}@${index}: no orphan heading`);
    }
  }
  assert.match(stripAnsi(renderSettingsPanel(state(), 60, 12, {configuration: config}).at(-1) ?? ''), /Esc|search|change/u, 'the footer survives a short terminal');
});

test('the shared window never ends on a heading and keeps the selected row\'s heading when it fits', () => {
  const items = Array.from({length: 40}, (_, index) => ({id: index, group: `G${Math.floor(index / 5)}`}));
  const lines = groupLines(items, item => item.group);
  assert.equal(lines.filter(line => line.kind === 'header').length, 8);
  for (const budget of [4, 7, 10]) for (let selected = 0; selected < lines.length; selected += 1) {
    if (lines[selected]!.kind === 'header') continue;
    const {start, end} = groupedWindow(lines, selected, budget);
    assert.ok(end - start <= budget && selected >= start && selected < end, `selected visible (${budget}, ${selected})`);
    assert.notEqual(lines[end - 1]!.kind, 'header', `no trailing heading (${budget}, ${selected})`);
  }
  const header = lines.findIndex((line, index) => index > 10 && line.kind === 'header');
  const window = groupedWindow(lines, header + 2, 8);
  assert.ok(window.start <= header, 'the heading above the selected row is in view');
});

const sections = (): StatusSections => [
  statusSection('Build & Platform', [{label: 'Version', value: '0.7.0'}, {label: 'Build', value: 'abc123', tone: 'muted'}]),
  statusSection('Shell & Session', [{label: 'Shell', value: 'zsh'}, {label: 'Shell switching', value: 'unavailable', tone: 'warning'}, {label: 'Session', value: 'live', tone: 'success'}]),
  statusSection('Terminal', [{label: 'Terminal', value: 'Ghostty'}, {label: 'Terminal size', value: '120×40'}]),
  statusSection('Storage', [{label: 'Session journal', value: 'active'}, {label: 'Config file', value: '~/.config/nmsh/config.json', tone: 'muted'}]),
];

test('Status: named headings, factual rows, tones intact, and scrolling that never strands a heading', () => {
  const all = renderSettingsPanel(state({view: 'status'}), 80, 60, {status: sections()});
  const text = all.map(stripAnsi);
  const headings = ['Build & Platform', 'Shell & Session', 'Terminal', 'Storage'];
  headings.forEach(title => assert.ok(text.some(line => line.trim() === title), title));
  assert.ok(text.findIndex(line => line.trim() === 'Shell & Session') > text.findIndex(line => line.includes('Build:')), 'sections keep their order');
  assert.ok(text.some(line => /^ {4}Version:\s+0\.7\.0$/u.test(line)), 'rows sit indented under their heading');
  assert.ok(all.some(line => stripAnsi(line).includes('unavailable') && line.includes('\u001b[')), 'tone colors are kept');
  assert.equal(sections().flat().length, 9, 'sections are still plain item lists');
  // statusLineCount counts headings and the blank lines between sections: 4 headings + 9 rows + 3 blanks.
  assert.equal(statusLineCount(sections()), 16);
  // Scrolling through a short viewport: every row is reachable and no heading ends the viewport.
  const seen = new Set<string>();
  for (let offset = 0; offset <= statusLineCount(sections()); offset += 1) {
    const out = renderSettingsPanel(state({view: 'status', contentIndex: offset}), 50, 9, {status: sections()}).map(stripAnsi);
    const body = out.filter(line => line.trim() && !line.includes('─') && !/Settings\s+Status/u.test(line) && !/to switch/u.test(line));
    for (const line of body) { const row = /^\s{4}(.+?):/u.exec(line); if (row) seen.add(row[1]!); }
    const last = body.at(-1)!;
    assert.ok(!headings.includes(last.trim()), `offset ${offset}: the viewport does not end on "${last.trim()}"`);
    for (const line of out) assert.ok(displayWidth(line) <= 50);
  }
  assert.equal(seen.size, 9, 'every row is reachable by scrolling');
  // Narrow widths stay bounded.
  for (const columns of [20, 30]) for (const line of renderSettingsPanel(state({view: 'status'}), columns, 30, {status: sections()})) assert.ok(displayWidth(line) <= columns);
});

test('the real Status report is grouped into named sections with the same facts', async () => {
  const isolation = isolateConfig();
  const app = new TerminalApp();
  try {
    const titles = app['statusSections']().map((section: {title?: string}) => section.title);
    for (const title of ['Build & Platform', 'Shell & Session', 'Terminal', 'Local Understanding', 'NMSh & Providers', 'Services & Activity', 'Storage']) assert.ok(titles.includes(title), title);
    assert.ok(titles.every((title: string | undefined) => title), 'every section is named');
    const labels = app['statusSections']().flat().map((item: {label: string}) => item.label);
    for (const label of ['Version', 'Build', 'Platform', 'Node', 'Shell', 'Session', 'Working directory', 'Terminal size', 'Prompt provider', 'Composer', 'Completion sources', 'Session notices', 'Agent activity', 'Config file']) assert.ok(labels.includes(label), label);
    const byTitle = (title: string) => app['statusSections']().find((section: {title?: string}) => section.title === title)!.map((item: {label: string}) => item.label);
    assert.ok(byTitle('Local Understanding').includes('Mode'));
    assert.ok(byTitle('Services & Activity').includes('Agent activity'));
    assert.ok(byTitle('Storage').includes('Config file'));
    app['openSettingsPanel']('status');
    const rows = app['settingsPanelRows'](100).map(stripAnsi);
    assert.ok(rows.some(line => line.trim() === 'Build & Platform'));
    assert.ok(rows.some(line => /Version:/u.test(line)));
    // Status is still read-only.
    const before = JSON.stringify(app['promptConfiguration']);
    for (const key of [{kind: 'enter'}, {kind: 'text', value: ' '}, {kind: 'right'}] as const) app['handleKey'](key as never);
    assert.equal(JSON.stringify(app['promptConfiguration']), before);
  } finally { app['stop'](0); app['session'].kill(); isolation.restore(); }
});
