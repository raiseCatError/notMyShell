import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRequest} from '../src/ask/resolver.js';
import {ASK_EXCLUDED, conceptDestination, CONCEPTS, matchConcepts} from '../src/ask/concepts.js';
import type {AskContext, AskOutcome} from '../src/ask/types.js';
import {slashCommands} from '../src/commands/slashCommands.js';
import {PROVIDER_FAMILIES} from '../src/providers/families.js';
import {SETTINGS_ENTRIES, SETTINGS_ROWS} from '../src/ui/SettingsPanel.js';

// Local understanding is irrelevant here: resolveRequest is the deterministic resolver and never calls a model.
const context: AskContext = {cwd: '/r', home: '/h', repoRoot: '/r', branch: 'main', dirty: true, worktrees: [], shell: 'zsh', defaultShell: 'zsh',
  shells: [{id: 'zsh', label: 'zsh', installed: true, installable: true}, {id: 'fish', label: 'Fish', installed: true, installable: true}, {id: 'bash', label: 'Bash', installed: true, installable: true}],
  sessions: [], transcripts: [], recentFiles: [], recentCommands: [], editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: Date.now(), files: []};
const resolve = (text: string) => resolveRequest(text, context);
const opens = (outcome: AskOutcome) => outcome.kind === 'proposal' && outcome.action.kind === 'slash' ? outcome.action.label : undefined;
const labels = (outcome: AskOutcome) => outcome.kind === 'choose' ? outcome.options.map(option => option.label) : [];

test('coverage audit: every public command, Settings area, provider family and planned area is known to Ask or explicitly excluded', () => {
  const covered = new Set(CONCEPTS.flatMap(concept => concept.covers ?? []));
  const surfaces = [
    ...new Set(slashCommands.map(command => command.name.split(' ')[0]!)),
    ...new Set([...SETTINGS_ROWS, ...SETTINGS_ENTRIES].map(row => `settings:${row.category}`)),
    ...PROVIDER_FAMILIES.map(family => `family:${family.family}`),
  ];
  const missing = surfaces.filter(surface => !covered.has(surface) && !(surface in ASK_EXCLUDED));
  assert.deepEqual(missing, [], 'classify each new surface in src/ask/concepts.ts (covers) or ASK_EXCLUDED');
  for (const surface of covered) assert.ok(surfaces.includes(surface), `${surface} is claimed but does not exist`);
});

test('catalog integrity: destinations are real NMSh commands; no hallucinated surfaces', () => {
  for (const concept of CONCEPTS) {
    for (const target of [concept.open, concept.configure]) if (target) assert.ok(conceptDestination({...concept, open: target}), `${concept.id}: ${target} parses`);
    assert.ok(concept.aliases.length && concept.description, concept.id);
  }
  const completion = CONCEPTS.find(concept => concept.id === 'completion')!;
  assert.equal(completion.support, 'no-ui', 'Completion has no settings surface of its own');
  assert.equal(completion.open, undefined);
  assert.ok(!slashCommands.some(command => command.name === '/completion'));
});

// Representative phrases per concept: canonical words and natural aliases (concept → expected destination or kind).
const MATRIX: Array<[string, string]> = [
  ['change chroma', '/chroma'], ['turn animated prompt colors off', 'answer:/chroma'], ['what is chroma', 'answer'],
  ['change my ghost text', '/providers'], ['autosuggestion settings', '/providers'], ['turn suggestions off', 'setting:none'], ['enable suggestions', 'setting:nmsh'],
  ['tab completion', 'answer'], ['completion settings', 'answer'],
  ['change smart folding', 'answer:/setup transcript'], ['stop collapsing output', 'answer:/setup transcript'],
  ['change my prompt', '/prompt'], ['change the theme', '/appearance'], ['open the palette', '/palette'], ['change the palette', '/appearance'],
  ['make fish my default shell', 'setting:fish'], ['how do i change the shell', 'choose'],
  ['show my old sessions', '/resume'], ['show live sessions', '/sessions'], ['find errors in my transcript', '/find errors'],
  ['change command history provider', '/providers'], ['where do i configure zoxide', '/providers'], ['jump to a recent directory', '/dirs'],
  ['change cursor blink', '/cursor'], ['change syntax highlighting', '/syntax'], ['change transcript layout', '/layout'],
  ['open the screensaver', '/screensaver'], ['show agent activity', '/agents'], ['what version am i running', '/version'], ['check for updates', '/update'],
  ['change keyboard shortcuts', '/keyboard'], ['open session presets', '/presets'], ['change live activity colors', '/activity'],
  ['change the welcome screen', '/providers'], ['configure the status strip', '/strip'], ['change nerd font icons', '/glyphs'],
  ['use nushell', 'unsupported'], ['open a new tab', 'unsupported'],
];

test('product vocabulary matrix (Local understanding Off)', () => {
  for (const [request, expected] of MATRIX) {
    const outcome = resolve(request);
    const got = outcome.kind === 'proposal' && outcome.action.kind === 'setting' ? `setting:${outcome.action.value}`
      : opens(outcome) ?? (outcome.kind === 'answer' && outcome.follow?.outcome && opens(outcome.follow.outcome) && expected.startsWith('answer:') ? `answer:${opens(outcome.follow.outcome)}` : outcome.kind);
    assert.equal(got, expected, `"${request}" → ${JSON.stringify(outcome).slice(0, 200)}`);
  }
});

test('autocomplete clarifies only between completion and ghost suggestions', () => {
  for (const request of ['how do i change my autocomplete stuff', 'autocomplete settings', 'auto complete', 'autocompelte settings']) {
    const outcome = resolve(request);
    assert.equal(outcome.kind, 'choose', request);
    assert.deepEqual(labels(outcome), ['Tab completion / completion menu', 'Ghost suggestions / predictive text'], request);
  }
  assert.deepEqual(matchConcepts('autocomplete ghost text').ambiguous, [], 'another word settles the shared one');
});

test('completion is answered factually and points at ghost suggestions; no invented Completion settings', () => {
  const outcome = resolve('completion settings');
  assert.equal(outcome.kind, 'answer');
  if (outcome.kind !== 'answer') return;
  assert.match(outcome.text, /no settings of its own/u);
  assert.doesNotMatch(outcome.text, /\/completion|Completion tab/u);
  assert.equal(outcome.follow?.outcome && opens(outcome.follow.outcome), '/providers');
});

test('explanations come from the catalog, and a comparison explains both', () => {
  const both = resolve('what is the difference between completion and suggestions');
  assert.equal(both.kind, 'answer');
  if (both.kind === 'answer') { assert.match(both.text, /Tab completion/u); assert.match(both.text, /Ghost suggestions/u); }
  for (const request of ['what does smart folding do', 'what are providers', 'what are session notices', 'what does agents track']) assert.equal(resolve(request).kind, 'answer', request);
  assert.match((resolve('what does /resume do') as {text: string}).text, /^\/resume:/u);
});

test('safety is unchanged: understood vocabulary never widens what Ask runs', () => {
  for (const request of ['delete untracked files', 'turn off chroma and delete my transcripts', 'sudo update nmsh', 'rm -rf the transcript', 'force push my prompt']) {
    assert.equal(resolve(request).kind, 'unsafe', request);
  }
  for (const [request] of MATRIX) {
    const outcome = resolve(request);
    if (outcome.kind === 'proposal') assert.ok(['slash', 'setting', 'switchShell', 'read'].includes(outcome.action.kind), request);
    if (outcome.kind === 'proposal' && outcome.action.kind === 'read') assert.fail(`${request} must not read`);
  }
});
