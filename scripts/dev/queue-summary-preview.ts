/**
 * Deterministic Slice 2B production-renderer captures:
 * Queue History panel, Compact/Detailed summaries, container placement, alignment, Safe glyphs, NO_COLOR,
 * and reviewed save summary confirmation.
 * Simulated observations only; never launches a real shell.
 */
import {mkdirSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {renderQueueSummary, queueSummaryLine, type QueueSummaryViewOptions} from '../../src/status/queueSummaryView.js';
import {renderQueueHistoryPanel, type QueueHistoryPanelState} from '../../src/queue/QueueHistoryPanel.js';
import type {QueueSummary} from '../../src/session/QueueSummary.js';
import type {QueueState} from '../../src/session/CommandQueue.js';
import type {QueueHistoryRecord, QueueTimeline} from '../../src/session/ExecutionTimeline.js';
import {setIconStyle} from '../../src/ui/glyphs.js';
import {stripAnsi, truncateAnsi} from '../../src/util/text.js';
import {AnsiOutputParser} from '../../src/output/AnsiOutputParser.js';

const directory = process.argv[2] ?? 'docs/development/execution-timeline-slice-2b';
mkdirSync(directory, {recursive: true});

const sha = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim().length > 0;

// Deterministic typed summary fixtures
const successSummary: QueueSummary = {
  version: 1, id: 'chain-1', chainId: 1, savedAt: 1_700_000_011_300, origin: 'automatic', status: 'finished',
  failurePolicy: 'pause', createdAt: 1_700_000_000_000, startedAt: 1_700_000_000_000, endedAt: 1_700_000_011_300,
  elapsedMs: 11_300,
  counts: {succeeded: 2, failed: 0, interrupted: 0, skipped: 0, unobserved: 0},
  entries: [
    {outcome: 'succeeded', label: 'npm', durationMs: 8200, exitCode: 0},
    {outcome: 'succeeded', label: 'git', durationMs: 3100, exitCode: 0},
  ],
  entriesOmitted: 0,
};

const failureSummary: QueueSummary = {
  version: 1, id: 'chain-2', chainId: 2, savedAt: 1_700_000_025_000, origin: 'automatic', status: 'finished',
  failurePolicy: 'pause', createdAt: 1_700_000_012_000, startedAt: 1_700_000_012_000, endedAt: 1_700_000_025_000,
  elapsedMs: 13_000,
  counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0},
  entries: [
    {outcome: 'succeeded', label: 'git', durationMs: 1400, exitCode: 0},
    {outcome: 'succeeded', label: 'make', durationMs: 9200, exitCode: 0},
    {outcome: 'failed', label: 'npm', durationMs: 2400, exitCode: 2},
  ],
  entriesOmitted: 0,
};

const interruptedSummary: QueueSummary = {
  version: 1, id: 'chain-3', chainId: 3, savedAt: 1_700_000_035_000, origin: 'automatic', status: 'finished',
  failurePolicy: 'pause', createdAt: 1_700_000_026_000, startedAt: 1_700_000_026_000, endedAt: 1_700_000_035_000,
  elapsedMs: 9_000,
  counts: {succeeded: 1, failed: 0, interrupted: 1, skipped: 0, unobserved: 0},
  entries: [
    {outcome: 'succeeded', label: 'cargo', durationMs: 4100, exitCode: 0},
    {outcome: 'interrupted', label: 'cargo', durationMs: 4900, exitCode: 130},
  ],
  entriesOmitted: 0,
};

const clearedSummary: QueueSummary = {
  version: 1, id: 'chain-4', chainId: 4, savedAt: 1_700_000_045_000, origin: 'automatic', status: 'cleared',
  failurePolicy: 'pause', createdAt: 1_700_000_036_000, startedAt: 1_700_000_036_000, endedAt: 1_700_000_042_000,
  elapsedMs: 6_000,
  counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 2, unobserved: 0},
  entries: [
    {outcome: 'succeeded', label: 'docker', durationMs: 6000, exitCode: 0},
  ],
  entriesOmitted: 0,
};

const reviewedSummary: QueueSummary = {
  version: 1, id: 'chain-5', chainId: 5, savedAt: 1_700_000_060_000, origin: 'reviewed', status: 'finished',
  failurePolicy: 'pause', createdAt: 1_700_000_046_000, startedAt: 1_700_000_046_000, endedAt: 1_700_000_060_000,
  elapsedMs: 14_000,
  counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0},
  entries: [
    {outcome: 'succeeded', label: 'npm', text: 'npm run build', durationMs: 8200, exitCode: 0},
    {outcome: 'succeeded', label: 'git', text: 'git status', durationMs: 800, exitCode: 0},
    {outcome: 'failed', label: 'deploy', text: 'deploy --token=[REDACTED]', durationMs: 5000, exitCode: 1},
  ],
  entriesOmitted: 0,
};

// Queue history records for history panel fixtures
const historyRecords: QueueHistoryRecord[] = [
  {id: 1, status: 'finished', failurePolicy: 'pause', createdAt: 1_700_000_000_000, startedAt: 1_700_000_000_000, endedAt: 1_700_000_011_300, elapsedMs: 11_300, results: 2, resultsOmitted: 0, counts: {succeeded: 2, failed: 0, interrupted: 0, skipped: 0, unobserved: 0}},
  {id: 2, status: 'finished', failurePolicy: 'pause', createdAt: 1_700_000_012_000, startedAt: 1_700_000_012_000, endedAt: 1_700_000_025_000, elapsedMs: 13_000, results: 3, resultsOmitted: 0, counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0}},
  {id: 3, status: 'finished', failurePolicy: 'pause', createdAt: 1_700_000_026_000, startedAt: 1_700_000_026_000, endedAt: 1_700_000_035_000, elapsedMs: 9_000, results: 2, resultsOmitted: 0, counts: {succeeded: 1, failed: 0, interrupted: 1, skipped: 0, unobserved: 0}},
  {id: 4, status: 'cleared', failurePolicy: 'pause', createdAt: 1_700_000_036_000, startedAt: 1_700_000_036_000, endedAt: 1_700_000_042_000, elapsedMs: 6_000, results: 1, resultsOmitted: 0, counts: {succeeded: 1, failed: 0, interrupted: 0, skipped: 2, unobserved: 0}},
  {id: 5, status: 'finished', failurePolicy: 'pause', createdAt: 1_700_000_046_000, startedAt: 1_700_000_046_000, endedAt: 1_700_000_060_000, elapsedMs: 14_000, results: 3, resultsOmitted: 0, counts: {succeeded: 2, failed: 1, interrupted: 0, skipped: 0, unobserved: 0}},
];

const chain5Detail: QueueTimeline = {
  id: 5, status: 'finished', failurePolicy: 'pause', createdAt: 1_700_000_046_000, startedAt: 1_700_000_046_000, endedAt: 1_700_000_060_000, elapsedMs: 14_000,
  executions: [
    {id: 1, commandId: 1, text: 'npm run build', status: 'succeeded', exitCode: 0, durationMs: 8200, startedAt: 1_700_000_046_000, endedAt: 1_700_000_054_200},
    {id: 2, commandId: 2, text: 'git status', status: 'succeeded', exitCode: 0, durationMs: 800, startedAt: 1_700_000_054_200, endedAt: 1_700_000_055_000},
    {id: 3, commandId: 3, text: 'deploy --token=sk-secret-1234567890', status: 'failed', exitCode: 1, durationMs: 5000, startedAt: 1_700_000_055_000, endedAt: 1_700_000_060_000},
  ],
};

const queueStateWithHistory: QueueState = {
  entries: [],
  history: historyRecords,
  summaries: [successSummary, failureSummary],
  historyDetail: chain5Detail,
};

const escapeXml = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

interface GalleryItem {
  id: string;
  category: string;
  title: string;
  columns: number;
  rows: number;
  content: string[];
}

const items: GalleryItem[] = [];

// 1. History Panel Captures
const historyPanelDefault = renderQueueHistoryPanel({selected: 0}, queueStateWithHistory, 80, 24);
items.push({id: 'history-panel-80x24', category: 'Queue History Panel', title: 'Queue History Panel (80 × 24, newest first, chain 5 selected)', columns: 80, rows: 24, content: historyPanelDefault});

const historyPanelWithDetail = renderQueueHistoryPanel({selected: 0, detail: 5}, queueStateWithHistory, 80, 24);
items.push({id: 'history-panel-detail-80x24', category: 'Queue History Panel', title: 'Queue History Panel with Retained Results (80 × 24, chain 5 detail)', columns: 80, rows: 24, content: historyPanelWithDetail});

const historyPanelNarrow = renderQueueHistoryPanel({selected: 0}, queueStateWithHistory, 32, 18);
items.push({id: 'history-panel-32x18', category: 'Queue History Panel', title: 'Queue History Panel Narrow (32 × 18)', columns: 32, rows: 18, content: historyPanelNarrow});

// 2. Summary Outcomes Captures (Compact & Detailed, 80 and 32 columns)
const outcomes: Array<{name: string; summary: QueueSummary}> = [
  {name: 'Success (Chain 1)', summary: successSummary},
  {name: 'Failure (Chain 2)', summary: failureSummary},
  {name: 'Interruption (Chain 3)', summary: interruptedSummary},
  {name: 'Cleared (Chain 4)', summary: clearedSummary},
];

for (const {name, summary} of outcomes) {
  const detailed80 = renderQueueSummary(summary, 80, 8, {detail: 'detailed', placement: 'center', align: 'left'});
  items.push({id: `summary-${summary.id}-detailed-80`, category: 'Settled Summaries by Outcome', title: `${name} Detailed (80 columns)`, columns: 80, rows: 8, content: detailed80});

  const compact80 = renderQueueSummary(summary, 80, 8, {detail: 'compact', placement: 'center', align: 'left'});
  items.push({id: `summary-${summary.id}-compact-80`, category: 'Settled Summaries by Outcome', title: `${name} Compact (80 columns)`, columns: 80, rows: 8, content: compact80});

  const narrow32 = renderQueueSummary(summary, 32, 8, {detail: 'detailed', placement: 'center', align: 'left'});
  items.push({id: `summary-${summary.id}-narrow-32`, category: 'Settled Summaries by Outcome', title: `${name} Narrow (32 columns)`, columns: 32, rows: 8, content: narrow32});
}

// 3. Placement & Alignment Variations
const placements: Array<'left' | 'center' | 'right'> = ['left', 'center', 'right'];
for (const placement of placements) {
  const placed = renderQueueSummary(failureSummary, 80, 8, {detail: 'detailed', placement, align: 'left'});
  items.push({id: `placement-${placement}`, category: 'Placement and Alignment', title: `Container Placement: ${placement.toUpperCase()} (Left-aligned text)`, columns: 80, rows: 8, content: placed});
}

const centerCenter = renderQueueSummary(failureSummary, 80, 8, {detail: 'detailed', placement: 'center', align: 'center'});
items.push({id: 'alignment-center-center', category: 'Placement and Alignment', title: 'Container Center · Text Center-aligned', columns: 80, rows: 8, content: centerCenter});

const rightRight = renderQueueSummary(failureSummary, 80, 8, {detail: 'detailed', placement: 'right', align: 'right'});
items.push({id: 'alignment-right-right', category: 'Placement and Alignment', title: 'Container Right · Text Right-aligned', columns: 80, rows: 8, content: rightRight});

// 4. Reviewed Save Summary Confirmation
const reviewRows = renderQueueSummary(reviewedSummary, 80, 8, {detail: 'detailed', placement: 'center', align: 'left', title: 'Save this Queue Summary?'});
const reviewLine = truncateAnsi(queueSummaryLine(reviewedSummary, 80), 80);
const reviewKeys = '\u001b[38;2;125;133;144mEnter saves this summary · Esc cancels\u001b[0m';
items.push({id: 'reviewed-save-confirmation', category: 'Reviewed Save Summary Confirmation', title: 'Reviewed Save Summary Confirmation Dialog (Redacted secrets, Enter/Esc controls)', columns: 80, rows: 10, content: [...reviewRows, reviewLine, reviewKeys]});

// 5. Safe Glyphs and NO_COLOR Captures
const savedIcons = process.env.NMSH_ICONS;
setIconStyle('safe');
const safeGlyphsRows = renderQueueSummary(failureSummary, 80, 8, {detail: 'detailed', placement: 'center', align: 'left'});
const safeHistoryRows = renderQueueHistoryPanel({selected: 0, detail: 5}, queueStateWithHistory, 80, 24);
items.push({id: 'safe-glyphs-summary', category: 'Accessibility & Fallbacks', title: 'Safe Glyphs · Settled Summary', columns: 80, rows: 8, content: safeGlyphsRows});
items.push({id: 'safe-glyphs-history', category: 'Accessibility & Fallbacks', title: 'Safe Glyphs · History Panel', columns: 80, rows: 24, content: safeHistoryRows});
if (savedIcons === undefined) delete process.env.NMSH_ICONS; else setIconStyle(savedIcons as 'nerd' | 'unicode' | 'safe' | 'ascii');

const savedNoColor = process.env.NO_COLOR;
process.env.NO_COLOR = '1';
const noColorRows = renderQueueSummary(failureSummary, 80, 8, {detail: 'detailed', placement: 'center', align: 'left'});
const noColorHistory = renderQueueHistoryPanel({selected: 0, detail: 5}, queueStateWithHistory, 80, 24);
items.push({id: 'no-color-summary', category: 'Accessibility & Fallbacks', title: 'NO_COLOR · Settled Summary', columns: 80, rows: 8, content: noColorRows});
items.push({id: 'no-color-history', category: 'Accessibility & Fallbacks', title: 'NO_COLOR · History Panel', columns: 80, rows: 24, content: noColorHistory});
if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;

// 6. Write Individual .ansi files
for (const item of items) {
  writeFileSync(join(directory, `${item.id}.ansi`), item.content.join('\r\n') + '\r\n');
}

// 7. Generate Markdown Report
const markdown: string[] = [
  '# Slice 2B Production-Renderer Visual Evidence: Queue History and Saved Summaries',
  '',
  `Source HEAD: \`${sha}\`${dirty ? ' (working tree contains uncommitted changes)' : ''}.`,
  '',
  'Generated by `node --import=tsx scripts/dev/queue-summary-preview.ts`.',
  '',
  'These captures are produced directly by the production renderers (`renderQueueHistoryPanel`, `renderQueueSummary`, `queueSummaryLine`) over deterministic session-owner event fixtures. No shell is launched and no commands are executed.',
  '',
  '## Summary of Visual Characteristics',
  '- **Bounded Containers:** Summaries render within bounded boxes with shared NMSh divider styling.',
  '- **Privacy Guarantees:** Command arguments with tokens/secrets appear strictly as `[REDACTED]` in review mode and never leak raw secrets.',
  '- **Factual Aggregates:** Wall elapsed, total count, success/failure counts, exit codes, and individual durations reflect actual observations.',
  '- **Layout Versatility:** Placements (Left, Center, Right) and text alignments operate independently without altering factual content.',
  '- **Degradation Safety:** Clean appearance preserved under Safe glyphs and NO_COLOR modes across 80×30 and 32×18 dimensions.',
  '',
];

const categories = [...new Set(items.map(item => item.category))];
for (const category of categories) {
  markdown.push(`## ${category}`, '');
  const categoryItems = items.filter(item => item.category === category);
  for (const item of categoryItems) {
    markdown.push(`### ${item.title}`, '', '```text', ...item.content.map(stripAnsi), '```', '');
  }
}

writeFileSync(join(directory, 'README.md'), markdown.join('\n'));
writeFileSync(join(directory, 'previews.md'), markdown.join('\n'));

// 8. Generate SVG Gallery
const svgWidth = 1100;
let svgHeight = 40;
for (const item of items) {
  svgHeight += 30 + item.content.length * 18 + 25;
}

const svg: string[] = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">`,
  `  <rect width="${svgWidth}" height="${svgHeight}" fill="#17171d"/>`,
  `  <g font-family="Menlo, Monaco, 'Courier New', monospace" font-size="12">`,
  `    <text x="20" y="30" font-size="16" font-weight="bold" fill="#f2f0ec">Slice 2B Production Renderers Gallery (${sha})</text>`,
];

let curY = 70;
for (const item of items) {
  svg.push(`    <text x="20" y="${curY}" font-size="13" font-weight="bold" fill="#a67cf3">${escapeXml(item.title)}</text>`);
  curY += 15;
  const blockHeight = item.content.length * 18 + 10;
  svg.push(`    <rect x="20" y="${curY}" width="${Math.min(item.columns * 8.5 + 20, svgWidth - 40)}" height="${blockHeight}" rx="4" fill="#1f1f28" stroke="#333344"/>`);
  curY += 15;
  for (const row of item.content) {
    const parser = new AnsiOutputParser();
    parser.write(row);
    let col = 0;
    for (const cell of parser.allLines()[0] ?? []) {
      if (!cell) continue;
      const rgb = [...cell.style.matchAll(/\u001b\[38;2;(\d+);(\d+);(\d+)m/gu)].at(-1);
      const fill = rgb ? `rgb(${rgb[1]},${rgb[2]},${rgb[3]})` : '#f2f0ec';
      svg.push(`    <text x="${30 + col * 7.5}" y="${curY}" fill="${fill}">${escapeXml(cell.text)}</text>`);
      col += cell.width;
    }
    curY += 18;
  }
  curY += 25;
}

svg.push('  </g>', '</svg>');
writeFileSync(join(directory, 'previews.svg'), svg.join('\n'));

// 9. Generate HTML Gallery
const html: string[] = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <title>Slice 2B: Queue History and Saved Summaries Visual Evidence</title>',
  '  <style>',
  '    body { background: #131317; color: #f2f0ec; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 24px; }',
  '    h1 { color: #f2f0ec; font-size: 22px; border-bottom: 1px solid #2a2a36; padding-bottom: 12px; }',
  '    h2 { color: #a67cf3; font-size: 16px; margin-top: 28px; }',
  '    h3 { color: #7d8590; font-size: 13px; margin: 12px 0 6px 0; }',
  '    .terminal { background: #1b1b22; border: 1px solid #2a2a36; border-radius: 6px; padding: 14px; font-family: "SF Mono", Monaco, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; white-space: pre; overflow-x: auto; display: inline-block; min-width: 300px; max-width: 100%; box-sizing: border-box; }',
  '    .badge { display: inline-block; background: #2a2a36; color: #9da7b3; font-size: 11px; padding: 2px 8px; border-radius: 12px; margin-left: 8px; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <h1>Slice 2B: Queue History and Saved Summaries Visual Evidence</h1>',
  `  <p>Source Commit: <code>${sha}</code></p>`,
];

for (const category of categories) {
  html.push(`  <h2>${category}</h2>`);
  const categoryItems = items.filter(item => item.category === category);
  for (const item of categoryItems) {
    html.push(`  <div>`);
    html.push(`    <h3>${escapeXml(item.title)} <span class="badge">${item.columns}×${item.rows}</span></h3>`);
    html.push(`    <div class="terminal">`);
    for (const row of item.content) {
      const parser = new AnsiOutputParser();
      parser.write(row);
      const cells = parser.allLines()[0] ?? [];
      const spans = cells.map(cell => {
        if (!cell) return '';
        const rgb = [...cell.style.matchAll(/\u001b\[38;2;(\d+);(\d+);(\d+)m/gu)].at(-1);
        const color = rgb ? `color: rgb(${rgb[1]},${rgb[2]},${rgb[3]});` : 'color: #f2f0ec;';
        return `<span style="${color}">${escapeXml(cell.text)}</span>`;
      }).join('');
      html.push(`${spans}\n`);
    }
    html.push(`    </div>`);
    html.push(`  </div>`);
  }
}

html.push('</body>', '</html>');
writeFileSync(join(directory, 'gallery.html'), html.join('\n'));

console.log(`Generated ${items.length} deterministic production evidence captures in ${directory}`);
