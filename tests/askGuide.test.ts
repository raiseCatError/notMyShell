import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveRequest} from '../src/ask/resolver.js';
import {CONCEPTS, conceptDestination, GUIDE_SECTIONS} from '../src/ask/concepts.js';
import {askStarters, everythingOutcome, sectionOutcome} from '../src/ask/guide.js';
import type {AskContext, AskOutcome} from '../src/ask/types.js';
import {parseSlashCommand} from '../src/commands/slashCommands.js';

const context = {cwd: '/r', home: '/h', worktrees: [], shell: 'zsh', defaultShell: 'zsh', shells: [], sessions: [], transcripts: [], recentFiles: [], recentCommands: [],
  editor: {label: 'Zed', available: true}, providers: [], sessionMode: 'service', now: 0, nmsh: {shell: 'Fish (default zsh)', chroma: 'Aurora'}} as AskContext;
const labels = (outcome: AskOutcome) => outcome.kind === 'choose' ? outcome.options.map(option => option.label) : [];

test('/guide, /ask guide and natural requests open the same guide (Local understanding Off)', () => {
  assert.deepEqual(parseSlashCommand('/guide'), {kind: 'ask', request: 'guide'});
  const guide = resolveRequest('guide', context);
  for (const request of ['guide me through nmsh', 'show me what nmsh can do', 'what can nmsh do']) assert.deepEqual(labels(resolveRequest(request, context)), labels(guide), request);
  assert.deepEqual(labels(guide), [...GUIDE_SECTIONS.map(section => section.title), 'Everything NMSh can do']);
});

test('/ask help and "what can you do" give Ask\'s own overview with a way into the guide', () => {
  for (const request of ['help', 'what can you do']) {
    const help = resolveRequest(request, context);
    assert.equal(help.kind, 'answer');
    assert.match(help.kind === 'answer' ? help.text : '', /Ask can help with:[\s\S]*what did I just do/u);
    assert.ok(help.kind === 'answer' && help.next?.some(option => option.label === 'Open the full NMSh guide'));
  }
});

test('derived from the catalog: every public concept is in a section; nothing internal or invented', () => {
  const inSections = new Set(GUIDE_SECTIONS.flatMap(section => section.concepts));
  for (const concept of CONCEPTS) assert.ok(inSections.has(concept.id), `${concept.id} is in the guide`);
  for (const id of inSections) assert.ok(CONCEPTS.some(concept => concept.id === id), `${id} is a real concept`);
  const everything = everythingOutcome();
  const text = everything.kind === 'answer' ? everything.text : '';
  for (const concept of CONCEPTS.filter(item => item.support !== 'unsupported')) assert.ok(text.includes(concept.label), concept.label);
  assert.doesNotMatch(text, /Nushell|split panes/u, 'unsupported things are not listed as features');
});

test('sections: what, why, where, current facts, and actions that open the real surfaces (their own rules apply)', () => {
  const shells = sectionOutcome('shells', context);
  assert.equal(shells.kind, 'answer');
  if (shells.kind !== 'answer') return;
  assert.match(shells.text, /Shell · \/shell · now: Fish \(default zsh\)/u);
  assert.match(sectionOutcome('chroma', context).kind === 'answer' ? (sectionOutcome('chroma', context) as {text: string}).text : '', /now: Aurora/u);
  for (const option of shells.next ?? []) {
    if (option.outcome?.kind === 'proposal') {
      assert.equal(option.outcome.action.kind, 'slash', 'guide actions navigate; changes happen in the surface, with its confirmation');
      assert.ok(option.outcome.action.kind === 'slash' && option.outcome.action.slash.kind !== 'unknown');
    }
  }
  for (const concept of CONCEPTS) if (concept.open) assert.ok(conceptDestination(concept));
});

test('empty /ask starters come from strong facts only', () => {
  assert.deepEqual(askStarters({repoRoot: '/r', dirty: true, branch: 'main', recent: [{command: 'ls', exitCode: 0, lines: 1}]}).map(option => option.label),
    ['Show Git status', 'Explain my recent command', 'Help with this branch', 'Guide me through NMSh']);
  assert.deepEqual(askStarters({}).map(option => option.label), ['Open settings', 'What can NMSh do?', 'Guide me through NMSh']);
  assert.ok(!askStarters({repoRoot: '/r', dirty: false}).some(option => option.label === 'Show Git status'), 'a clean repo does not suggest status');
});
