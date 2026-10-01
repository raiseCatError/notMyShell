import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {helpMarkdown} from '../src/help/helpContent.js';
import {authoredMarkdown, renderMarkdown, supportsHyperlinks} from '../src/help/markdown.js';
import {slashCommands} from '../src/commands/slashCommands.js';
import {displayWidth, stripAnsi} from '../src/util/text.js';

const render = (source: string, columns = 40, hyperlinks = false) => renderMarkdown(authoredMarkdown(source), {columns, hyperlinks});
const plain = (rows: string[]) => rows.map(stripAnsi);

test('headings, paragraphs and emphasis', () => {
  const rows = plain(render('# Title\n\nSome **bold** and *italic* and `code` text.\n\n## Next\nmore'));
  assert.deepEqual(rows, ['Title', '', 'Some bold and italic and code text.', '', 'Next', 'more']);
});

test('paragraphs wrap to the width and never exceed it', () => {
  const rows = render('word '.repeat(40), 22);
  assert.ok(rows.length > 5);
  for (const row of rows) assert.ok(displayWidth(row) <= 22);
  const long = render('x'.repeat(100), 15);
  for (const row of long) assert.ok(displayWidth(row) <= 15);
  assert.equal(plain(long).join(''), 'x'.repeat(100));
});

test('lists keep hanging indents', () => {
  const rows = plain(render('- first item that wraps around\n- second\n1. numbered', 16));
  assert.equal(rows[0], '• first item');
  assert.ok(rows[1]!.startsWith('  '));
  assert.ok(rows.includes('• second'));
  assert.ok(rows.includes('1. numbered'));
});

test('code blocks are literal and not reflowed or interpreted', () => {
  const rows = plain(render('```\n**not bold** [x](http://a.b)\n```', 60));
  assert.deepEqual(rows, ['  **not bold** [x](http://a.b)']);
});

test('tables align columns and fall back to labelled rows when narrow', () => {
  const source = '| Command | Meaning |\n| --- | --- |\n| `/a` | first |\n| `/bb` | second |';
  const wide = plain(render(source, 40));
  assert.equal(wide.length, 4);
  assert.match(wide[0]!, /^ {2}Command │ Meaning$/u);
  assert.match(wide[2]!, /^ {2}\/a {6}│ first$/u);
  const narrow = render(source, 12);
  for (const row of narrow) assert.ok(displayWidth(row) <= 12);
  assert.ok(plain(narrow).join(' ').includes('/bb'));
});

test('links use OSC 8 only when enabled and only for http(s)', () => {
  const on = render('See [docs](https://example.com/a).', 60, true).join('');
  assert.ok(on.includes('\u001B]8;;https://example.com/a\u001B\\'));
  const off = plain(render('See [docs](https://example.com/a).', 60, false));
  assert.equal(off[0], 'See docs (https://example.com/a).');
  const unsafe = render('[x](javascript:alert) [y](https://a.b/\u001B]8;;)', 60, true).join('');
  assert.ok(!unsafe.includes('\u001B]8;;javascript'));
  assert.ok(!/\u001B\]8;;https:\/\/a\.b\/\u001B/u.test(unsafe));
});

test('control sequences in source cannot reach the terminal', () => {
  const rows = render('hi \u001B[2J\u001B]0;title\u0007 there\u0000', 60);
  assert.ok(!rows.join('').includes('\u001B[2J'));
  assert.ok(!rows.join('').includes('\u0007'));
});

test('no-color path carries no color escapes and keeps code visible', () => {
  const saved = process.env.NO_COLOR;
  try {
    process.env.NO_COLOR = '1';
    const rows = render('# H\n`code` and **b**', 40);
    assert.ok(rows.every(row => !/\u001B\[(38|48);/u.test(row)));
    assert.ok(plain(rows).join('\n').includes('`code`'));
  } finally {
    if (saved === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved;
  }
});

test('hyperlink support detection', () => {
  assert.equal(supportsHyperlinks({TERM_PROGRAM: 'ghostty'}), true);
  assert.equal(supportsHyperlinks({TERM_PROGRAM: 'Apple_Terminal'}), false);
  assert.equal(supportsHyperlinks({TERM_PROGRAM: 'Apple_Terminal', NMSH_HYPERLINKS: '1'}), true);
  assert.equal(supportsHyperlinks({TERM_PROGRAM: 'ghostty', NMSH_HYPERLINKS: '0'}), false);
});

test('/help renders every command and fits narrow terminals', () => {
  for (const columns of [20, 40, 100]) {
    const rows = renderMarkdown(helpMarkdown(), {columns, hyperlinks: false});
    for (const row of rows) assert.ok(displayWidth(row) <= columns);
    const text = plain(rows).join('\n');
    for (const command of slashCommands) assert.ok(text.includes(command.name.split(' ')[0]!), command.name);
    assert.ok(text.includes('Alt+A'));
  }
});

test('the Markdown renderer is imported only by NMSh-owned help code', () => {
  const allowed = new Set(['src/help/helpContent.ts', 'src/app/TerminalApp.ts', 'src/help/markdown.ts']);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts') && /help\/markdown\.js/u.test(readFileSync(path, 'utf8')) && !allowed.has(path)) offenders.push(path);
    }
  };
  walk('src');
  assert.deepEqual(offenders, []);
  const app = readFileSync('src/app/TerminalApp.ts', 'utf8');
  assert.equal((app.match(/renderMarkdownText\(/gu) ?? []).length, 1, 'only /help renders authored Markdown');
});
