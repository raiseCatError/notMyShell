import test from 'node:test';
import assert from 'node:assert/strict';
import {checkMermaidSource, diagramKey, isMermaidLanguage, MERMAID_LIMITS, mermaidConfig, mermaidSources, LOCKED_KEYS} from '../src/diagrams/mermaid.js';
import {parseBlocks} from '../src/markdown/blocks.js';

const theme = {scheme: 'dark' as const, text: '#f2f0ec', accent: '#c5b9e8', line: '#b0b8c2'};

test('a fence is a Mermaid diagram by its first info word, case-insensitively', () => {
  assert.equal(isMermaidLanguage('mermaid'), true);
  assert.equal(isMermaidLanguage('Mermaid'), true);
  assert.equal(isMermaidLanguage('mmd'), false);
  assert.equal(isMermaidLanguage(undefined), false);
  assert.equal(isMermaidLanguage('mermaidjs'), false);
});

test('ordinary diagrams pass the bounds; the reason names the limit otherwise', () => {
  assert.deepEqual(checkMermaidSource('flowchart LR\n  A --> B'), {ok: true});
  assert.match((checkMermaidSource('   \n ') as {reason: string}).reason, /empty/u);
  const long = `flowchart LR\n${'  A --> B\n'.repeat(MERMAID_LIMITS.lines)}`;
  assert.match((checkMermaidSource(long) as {reason: string}).reason, /lines/u);
  const wide = `flowchart LR\n  A["${'x'.repeat(MERMAID_LIMITS.chars)}"]`;
  assert.match((checkMermaidSource(wide) as {reason: string}).reason, /characters/u);
  const label = `flowchart LR\n  A["${'y'.repeat(MERMAID_LIMITS.lineChars + 1)}"]`;
  assert.match((checkMermaidSource(label) as {reason: string}).reason, /line/u);
});

test('nesting is bounded before anything is drawn: subgraphs, blocks and braces', () => {
  const depth = MERMAID_LIMITS.nesting + 1;
  const subgraphs = `flowchart TB\n${Array.from({length: depth}, (_, i) => `subgraph s${i}`).join('\n')}\nA\n${'end\n'.repeat(depth)}`;
  assert.match((checkMermaidSource(subgraphs) as {reason: string}).reason, /nested/u);
  const loops = `sequenceDiagram\n${'loop x\n'.repeat(depth)}A->>B: hi\n${'end\n'.repeat(depth)}`;
  assert.match((checkMermaidSource(loops) as {reason: string}).reason, /nested/u);
  const braces = `stateDiagram-v2\n${'state a {\n'.repeat(depth)}x --> y\n${'}\n'.repeat(depth)}`;
  assert.match((checkMermaidSource(braces) as {reason: string}).reason, /nested/u);
  // Just inside the limit is fine; braces inside quoted labels do not count.
  const fine = `flowchart TB\n${Array.from({length: MERMAID_LIMITS.nesting}, (_, i) => `subgraph s${i}`).join('\n')}\nA["{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{"]\n${'end\n'.repeat(MERMAID_LIMITS.nesting)}`;
  assert.deepEqual(checkMermaidSource(fine), {ok: true});
});

test('directives are limited in number but allowed (the security keys are locked in the configuration)', () => {
  assert.deepEqual(checkMermaidSource('%%{init: {"theme": "forest"}}%%\nflowchart LR\n  A --> B'), {ok: true});
  const many = `${'%%{init: {"theme": "forest"}}%%\n'.repeat(MERMAID_LIMITS.directives + 1)}flowchart LR\n  A --> B`;
  assert.match((checkMermaidSource(many) as {reason: string}).reason, /directives/u);
});

test('the configuration is NMSh\'s: strict security, no HTML labels, bounded text and edges, security keys locked', () => {
  const config = mermaidConfig(theme);
  assert.equal(config.securityLevel, 'strict');
  assert.equal(config.startOnLoad, false);
  assert.equal(config.htmlLabels, false);
  assert.equal((config.flowchart as {htmlLabels: boolean}).htmlLabels, false);
  assert.equal(config.maxTextSize, MERMAID_LIMITS.chars);
  assert.equal(config.maxEdges, MERMAID_LIMITS.edges);
  assert.equal(config.deterministicIds, true);
  for (const key of ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'htmlLabels', 'dompurifyConfig', 'themeCSS', 'suppressErrorRendering']) assert.ok(LOCKED_KEYS.includes(key), key);
  assert.deepEqual(config.secure, [...LOCKED_KEYS]);
  // Only JSON values: it travels as data.
  assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  assert.equal(mermaidConfig({...theme, scheme: 'light'}).theme, 'default');
  assert.equal(config.theme, 'dark');
  assert.equal(mermaidConfig({...theme, scheme: 'mono'}).theme, 'neutral');
  assert.equal((config.themeVariables as Record<string, string>).primaryBorderColor, theme.accent);
});

test('the cache key changes with the text and the theme, not with anything else', () => {
  const a = diagramKey('flowchart LR\n A-->B', theme);
  assert.equal(a, diagramKey('flowchart LR\n A-->B', {...theme}));
  assert.notEqual(a, diagramKey('flowchart LR\n A-->C', theme));
  assert.notEqual(a, diagramKey('flowchart LR\n A-->B', {...theme, accent: '#000000'}));
  assert.notEqual(a, diagramKey('flowchart LR\n A-->B ', theme));
  assert.match(a, /^[0-9a-f]{64}$/u);
});

test('the diagrams of a document are found wherever a fence may be: quotes, lists and details included', () => {
  const text = ['# Doc', '```mermaid', 'flowchart LR', '  A --> B', '```', '> ```mermaid', '> sequenceDiagram', '> A->>B: x', '> ```', '- item', '', '  ```Mermaid', '  pie', '  "a": 1', '  ```', '```js', 'x', '```'].join('\n');
  assert.deepEqual(mermaidSources(parseBlocks(text, {html: true, math: true})), ['flowchart LR\n  A --> B', 'sequenceDiagram\nA->>B: x', 'pie\n"a": 1']);
});
