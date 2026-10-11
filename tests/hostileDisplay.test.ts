import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {buildContextLine, buildPromptLine, statusStripModules} from '../src/prompt/prompt.js';
import {safeContextText, sanitizeFactValue} from '../src/context/facts.js';
import {renderHistoricalContext} from '../src/output/TranscriptPresenter.js';
import {createWelcomeSnapshot, renderWelcome} from '../src/output/Welcome.js';
import {renderStatusStrip} from '../src/status/StatusStrip.js';
import {stripAnsi} from '../src/util/text.js';

// The physical QA case: mkdir -p /tmp/$'evil\e]0;PWNED\a'; cd into it.
const EVIL = 'evil\u001b]0;PWNED\u0007';
const CWD = `/tmp/${EVIL}`;
const IDENTITY = {version: '0.17.0', commit: 'abc1234', branch: 'main', builtAt: '2026-01-01T00:00:00Z', dirty: false};

/** No executable control bytes and none of the escape sequence's printable debris. */
function clean(rendered: string, where: string): void {
  const text = stripAnsi(rendered);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(text), `${where}: no control bytes`);
  assert.ok(!text.includes(']0;PWNED') && !text.includes('PWNED'), `${where}: no ]0;PWNED debris`);
  assert.ok(!text.includes('\ufffd'), `${where}: no replacement-character marker`);
  assert.match(text, /evil/u, `${where}: the readable name stays`);
}

test('hostile cwd through the real prompt, module, strip, history and welcome paths shows "evil" and nothing else of the sequence', () => {
  const context = {cwd: CWD, project: EVIL};
  const configuration = DEFAULT_PROMPT_CONFIGURATION;
  for (const placement of ['composer', 'header'] as const) clean(buildContextLine(context, 100, configuration, placement), `prompt (${placement})`);
  clean(buildPromptLine(context, 100), 'one-line prompt');
  assert.match(stripAnsi(buildContextLine({cwd: CWD}, 100, configuration, 'composer')), /\/tmp\/evil(?!\S*PWNED)/u, 'the path module itself reads /tmp/evil');
  const strip = normalizePromptConfiguration({...structuredClone(DEFAULT_PROMPT_CONFIGURATION), statusStrip: {enabled: true},
    modules: [{id: 'cwd', visible: true, condition: 'always', surface: 'statusStrip'}]});
  const items = statusStripModules(context, strip);
  assert.ok(items.length, 'the path module routed to the strip renders');
  clean(renderStatusStrip(strip.statusStrip, {}, 100, new Date(0), undefined, items.map(item => ({text: item.text, priority: item.priority}))), 'Status Strip');
  const history = renderHistoricalContext({cwd: CWD, project: EVIL, branch: `main\u001b[2J\u009b31m`}, 100);
  clean(history?.ansi ?? '', 'historical prompt');
  clean(renderWelcome(createWelcomeSnapshot(IDENTITY as never, CWD), 100).map(row => row.ansi).join('\n'), 'welcome');
  assert.equal(sanitizeFactValue(EVIL), 'evil', 'the fact cache boundary scrubs the same way');
});

test('the shared display scrubber removes whole sequences but keeps ordinary text and punctuation', () => {
  const cases: Array<[string, string, string]> = [
    ['evil\u001b]0;PWNED\u0007', 'evil', 'OSC to BEL'],
    ['evil\u001b]0;PWNED\u001b\\tail', 'eviltail', 'OSC to ST'],
    ['evil\u009d0;PWNED\u009ctail', 'eviltail', 'C1 OSC to C1 ST'],
    ['a\u001b[31mred\u001b[0m b\u009b2J', 'ared b', 'CSI and C1 CSI'],
    ['evil\u001b]0;PWNED', 'evil', 'unterminated OSC'],
    ['a\u001b[38;2;1', 'a', 'incomplete CSI'],
    ['x\u001b', 'x', 'lone ESC'],
    ['pay\u202eexe\u2066.\u2069\u200ftxt', 'payexe.txt', 'bidi controls'],
    ['a\u0000b\u007fc\u0085d', 'abcd', 'C0, DEL and C1 controls'],
  ];
  for (const [input, expected, label] of cases) assert.equal(safeContextText(input), expected, label);
  const ordinary = ['~/Projects/notMyShell', 'café — 東京 🚀', 'feature/ABC-123_fix.v2', 'a [b] (c) {d} #e @f %g ^h &i *j +k =l |m ;n :o "p" \'q\' <r> ?s ,t !u $v `w ~x',
    'C:\\Users\\name', 'path with  spaces', 'naïve Ελληνικά עברית العربية'];
  for (const text of ordinary) assert.equal(safeContextText(text), text, `unchanged: ${text}`);
});
