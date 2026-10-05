import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROMPT_CONFIGURATION, DEFAULT_CONTEXT_RAIL, normalizePromptConfiguration} from '../src/prompt/configuration.js';
import {railPresentation, verticalRailRows} from '../src/prompt/railLayout.js';
import {planScreen, regionOf, cursorScreenRow, type ScreenPlanInput} from '../src/app/screenPlan.js';

const configuration = () => structuredClone(DEFAULT_PROMPT_CONFIGURATION);
const input = (position: 'bottom' | 'top' | 'flow', transcriptRows = 20): ScreenPlanInput => ({rows: 30, inputRows: 1,
  suggestions: 0, running: false, detached: false, hasOutput: transcriptRows > 0, contextPlacement: 'header',
  hasVisibleContext: true, composerLayout: 'twoLine', composerPosition: position, transcriptRows});

test('old Rail settings retain exact presentation defaults and Rows never encodes spacing', () => {
  const c = configuration(); c.contextRail = {mode: 'always', rows: 2, theme: 'followMain', style: 'followMain', overflow: 'priority'};
  assert.deepEqual(normalizePromptConfiguration(c).contextRail, {...DEFAULT_CONTEXT_RAIL, spacing: 'attached', mode: 'always', rows: 2});
  for (const spacing of ['attached', 'gap', 'spacious'] as const) {
    c.contextRail.spacing = spacing;
    assert.equal(normalizePromptConfiguration(c).contextRail.rows, 2);
  }
});

for (const [rows, spacing, height] of [[1, 'attached', 1], [1, 'gap', 2], [2, 'spacious', 4]] as const) {
  test(`Bottom ${rows} content row(s), ${spacing}: exact reserved geometry`, () => {
    const c = configuration(); c.contextRail.spacing = spacing;
    const p = railPresentation(c, rows, 100);
    const base = planScreen(input('bottom'));
    const composed = planScreen({...input('bottom'), railPresentation: p} as any);
    assert.equal(cursorScreenRow(composed, 0), cursorScreenRow(base, 0));
    assert.equal(composed.viewportRows, base.viewportRows - height);
    assert.equal(verticalRailRows(p, false).filter(row => row.kind === 'content').length, rows);
    assert.equal((composed as any).rail.slots.length, rows);
  });
}

for (const anchor of ['prompt', 'rail', 'above'] as const) {
  test(`Inside two-line ${anchor} divider has independent owned geometry`, () => {
    const c = configuration(); c.placement = 'composer'; c.contextRail.integration = 'inside';
    c.contextRail.dividerAnchor = anchor; c.contextRail.spacing = 'spacious';
    const composed = planScreen({...input('bottom'), contextPlacement: 'composer', railPresentation: railPresentation(c, 2, 100)} as any);
    const metadata = (composed as any).rail;
    assert.equal(metadata.presentation.anchor, anchor);
    assert.equal(metadata.slots.length, 2);
    assert.ok(metadata.edgeRow >= 0);
    assert.ok(metadata.end >= regionOf(composed, 'input')!.top);
    assert.ok(composed.regions.every(region => region.top >= 0 && region.top + region.height <= composed.rows));
  });
}

for (const position of ['bottom', 'top', 'flow'] as const) {
  test(`${position}: spaced Rail follows anchoring through empty, short, growing and resized views`, () => {
    const c = configuration(); c.composerPosition = position; c.contextRail.spacing = 'spacious';
    for (const rows of [30, 15]) for (const transcriptRows of [0, 1, 3, 80]) {
      const original = {...input(position, transcriptRows), rows};
      const base = planScreen(original);
      const composed = planScreen({...original, railPresentation: railPresentation(c, 2, 80)} as any);
      const shift = cursorScreenRow(composed, 0) - cursorScreenRow(base, 0);
      assert.equal(shift, position === 'flow' ? Math.max(0, 4 - base.transcript.height) : 0);
      const metadata = (composed as any).rail;
      assert.ok(metadata.slots.every((slot: any) => position === 'top' ? slot.top > regionOf(composed, 'input')!.top : slot.top < regionOf(composed, 'input')!.top));
      assert.ok(composed.regions.every(region => region.top >= 0 && region.top + region.height <= rows));
    }
  });
}

for (const layout of ['oneLine', 'twoLine'] as const) {
  test(`Right ${layout}: distinct cell budget preserves existing right anchor and editor space`, () => {
    const c = configuration(); c.composerLayout = layout; c.contextRail.relation = 'right'; c.contextRail.spacing = 'gap';
    const p = railPresentation(c, 2, 100, {left: 'project', right: 'zsh'});
    assert.ok(p.column + p.width < 100 - 3);
    assert.ok(p.editorColumns >= 24);
    const base = {...input('bottom'), composerLayout: layout};
    const composed = planScreen({...base, railPresentation: p} as any);
    assert.equal((composed as any).rail.slots.length, 2);
    assert.equal(cursorScreenRow(composed, 0), cursorScreenRow(planScreen(base), 0));
    const narrow = railPresentation(c, 2, 20, {left: 'project', right: 'zsh'});
    assert.equal(narrow.width, 0);
    assert.ok(narrow.editorColumns >= 16);
  });
}

import {buildContextRail} from '../src/prompt/prompt.js';
import {stripAnsi} from '../src/util/text.js';

test('mirrored Rail reflects geometry and anchors highest priority without reversing text', () => {
  const c = configuration(); c.contextRail.mode = 'always';
  c.modules = [{id:'project',visible:true,condition:'always',surface:'contextRail'},
    {id:'exitStatus',visible:true,condition:'always',surface:'contextRail'}];
  const context = {cwd:'/qa',project:'Readable',exitStatus:42};
  c.contextRail.direction = 'forward';
  const forward = stripAnsi(buildContextRail(context,100,c)[0]!);
  c.contextRail.direction = 'mirrored';
  const mirrored = stripAnsi(buildContextRail(context,100,c)[0]!);
  assert.ok(forward.indexOf('42') < forward.indexOf('Readable'));
  assert.ok(mirrored.indexOf('42') > mirrored.indexOf('Readable'));
  assert.ok(!mirrored.includes('elbadaeR'));
  assert.notEqual(mirrored, forward);
});

import {prepareRail, paintRailComposition, railCompositionPreview} from '../src/prompt/railComposition.js';
import {TerminalApp} from '../src/app/TerminalApp.js';
import {setIconStyle} from '../src/ui/glyphs.js';
import type {TerminalFrame} from '../src/terminal/TerminalRenderer.js';

const context = {cwd:'/qa', project:'Readable', branch:'rail-qa', exitStatus:42,
  shell:{current:'zsh' as const,differs:false},toolchains:['node' as const,'python' as const]};
const routed = () => {
  const c = configuration(); c.contextRail.mode='always';
  c.modules=[{id:'project',visible:true,condition:'always',surface:'mainPrompt'},
    {id:'shell',visible:true,condition:'always',surface:'rightContext'},
    {id:'gitBranch',visible:true,condition:'inRepository',surface:'contextRail'},
    {id:'exitStatus',visible:true,condition:'always',surface:'contextRail'}];
  return c;
};

for (const relation of ['vertical','right'] as const) for (const anchor of ['prompt','rail','above'] as const) {
  test(`${relation} Inside ${anchor}: composition paints distinct frame/divider ownership`, () => {
    const c=routed(); c.placement='composer'; c.contextRail.integration='inside'; c.contextRail.relation=relation;
    c.contextRail.dividerAnchor=anchor; c.contextRail.rows=2; c.contextRail.spacing='spacious';
    const rows=railCompositionPreview(context,100,c).map(stripAnsi);
    assert.ok(rows.some(row=>row.includes('rail-qa')));
    assert.ok(rows.some(row=>row.includes('zsh')));
    assert.ok(rows.some(row=>row.includes('echo hello')));
    assert.ok(rows.every(row=>row.length<=120));
    if (relation === 'vertical') assert.equal(verticalRailRows(prepareRail(context,100,c).presentation, false).filter(row=>row.kind === 'gap').length, 2, 'Spacious preserves two independent gap descriptors');
    assert.ok(rows.every(row=>!/[╭╮╰╯│├┌┐└┘]/u.test(row)), 'Inside uses horizontal lines only');
    if(anchor==='above')assert.ok(rows[0]!.startsWith('─') && !rows[0]!.includes('Readable') && !rows[0]!.includes('rail-qa'));
  });
}

test('right placement, spacing and mirroring never overlap shell or composer cells', () => {
  for(const spacing of ['attached','gap','spacious'] as const) for(const direction of ['forward','mirrored'] as const) for(const columns of [100,40,20]){
    const c=routed();c.contextRail.relation='right';c.contextRail.spacing=spacing;c.contextRail.direction=direction;
    const prepared=prepareRail(context,columns,c);
    const rows=railCompositionPreview(context,columns,c).map(stripAnsi);
    assert.ok(rows.every(row=>[...row].length<=columns+8));
    const prompt=rows.find(row=>row.includes('zsh'));
    if(prompt && prepared.presentation.width)assert.ok(prompt.lastIndexOf('zsh')>prompt.indexOf('42'));
    if(columns===20)assert.equal(prepared.presentation.width,0);
  }
});

test('preview/live group projection is identical across placement, rows, direction, spacing and anchors', () => {
  const app=new TerminalApp();let frame:TerminalFrame|undefined;
  try {
    app['dimensions']=()=>({columns:100,rows:30});app['fetchSuggestions']=async()=>{};
    app['renderer'].render=next=>{frame=next;};app['context']=context;
    app['editor'].insert('echo hello');
    for(const position of ['bottom','top','flow'] as const) for(const relation of ['vertical','right'] as const)
      for(const anchor of ['prompt','rail','above'] as const) for(const layout of ['oneLine','twoLine'] as const){
        const c=routed();c.composerPosition=position;c.composerLayout=layout;c.placement='composer';
        c.contextRail={...c.contextRail,relation,dividerAnchor:anchor,integration:'inside',spacing:'spacious',rows:2,direction:'mirrored'};
        app['promptConfiguration']=c;app['render']();
        const liveContext=app['promptContext']();const prepared=prepareRail(liveContext,100,c);
        const plan=app['planFrame'](100,30);
        const group=plan.rail!;
        const live=frame!.rows.slice(group.start,group.end).map(stripAnsi);
        const preview=railCompositionPreview(liveContext,100,c).map(stripAnsi);
        assert.deepEqual(live,preview,`${position} ${relation} ${anchor} ${layout}`);
        assert.ok(frame!.cursorColumn<=prepared.presentation.editorColumns+3);
      }
    const framed = routed();
    framed.placement = 'composer';
    framed.contextRail = {...framed.contextRail, relation: 'right', integration: 'inside', rows: 2};
    app['promptConfiguration'] = framed;
    app['editor'].clear();
    app['editor'].insert('echo ' + 'abcdefghij'.repeat(18));
    app['render']();
    const plan = app['planFrame'](100, 30);
    const inputRegion = regionOf(plan, 'input')!;
    const layout = app['layoutEditorInput'](100, inputRegion.height);
    for (const [index, row] of layout.rows.entries()) {
      assert.ok(stripAnsi(frame!.rows[inputRegion.top + index]!).includes(row.text), 'Frame preserves every visible wrapped command character');
    }
    assert.equal(frame!.cursorColumn, layout.caretColumn + 1, 'Terminal cursor is one-based');
    assert.equal(frame!.rows.slice(plan.rail!.start, plan.rail!.end).map(stripAnsi).filter(row => row.includes('zsh')).length, 1, 'Right Context remains on its own Main row'); 
    app['passthrough'] = true;
    assert.equal(app['preparedRail'](100).presentation.rows, 0, 'Raw passthrough removes spacing, frame and horizontal Rail');
  }finally{app['stop'](0);app['session'].kill();}
});

test('composition uses semantic NO_COLOR and safe glyph policy without touching transcript output', () => {
  const previous=process.env.NO_COLOR;process.env.NO_COLOR='1';setIconStyle('safe');
  try {
    const c=routed();c.placement='composer';c.contextRail.integration='inside';c.contextRail.dividerAnchor='above';
    const rows=railCompositionPreview(context,80,c);
    assert.ok(rows.every(row=>!row.includes('\x1b')&&!/[╭╮╰╯│├]/u.test(row)));
    assert.ok(rows[0]!.startsWith('-'));
  }finally{if(previous===undefined)delete process.env.NO_COLOR;else process.env.NO_COLOR=previous;setIconStyle('nerd');}
});

test('new composition regions stay bounded/nonoverlapping across detached, resize and constrained heights', () => {
  for(const position of ['bottom','top','flow'] as const) for(const relation of ['vertical','right'] as const)
    for(const anchor of ['prompt','rail','above'] as const) for(const height of [8,15,30]) for(const total of [0,1,80]){
      const c=configuration();c.composerPosition=position;c.placement='composer';
      c.contextRail={...c.contextRail,integration:'inside',relation,dividerAnchor:anchor,spacing:'spacious',rows:2};
      for(const detached of [false,true]){
        const plan=planScreen({...input(position,total),rows:height,detached,viewStart:0,contextPlacement:'composer',railPresentation:railPresentation(c,2,80)});
        let end=0;
        for(const region of plan.regions){assert.ok(region.top>=end,JSON.stringify({position,relation,anchor,height,total,detached,regions:plan.regions}));end=region.top+region.height;assert.ok(end<=height);}
      }
    }
});


test('detached Flow keeps the same PTY capacity when spaced integrated input scrolls offscreen', () => {
  const c = configuration();
  c.placement = 'composer';
  c.contextRail = {...c.contextRail, rows: 2, spacing: 'spacious', integration: 'inside', dividerAnchor: 'above'};
  const settings = {...input('flow', 80), contextPlacement: 'composer' as const, railPresentation: railPresentation(c, 2, 80)};
  const follow = planScreen(settings);
  const detached = planScreen({...settings, detached: true, viewStart: 0});
  assert.equal(regionOf(detached, 'input'), undefined);
  assert.equal(detached.ptyRows, follow.ptyRows);
  assert.equal(detached.viewportRows, follow.viewportRows);
});


test('cached Rail geometry still paints the current Main Chroma presentation time', () => {
  const c = routed();
  c.presentation = {...c.presentation, preset: 'aurora', motion: 'travel', semantic: 'override'};
  c.modules[0]!.surface = 'contextRail';
  const prepared = prepareRail(context, 100, c, 0);
  const plan = planScreen({...input('bottom'), railPresentation: prepared.presentation});
  const paint = (time: number) => {
    const rows = Array<string>(30).fill('');
    paintRailComposition(rows, plan, prepared, context, 100, c, time);
    return rows[plan.rail!.slots[0]!.top]!;
  };
  assert.notEqual(paint(1000), paint(0));
  assert.equal(stripAnsi(paint(1000)), stripAnsi(paint(0)));
});

test('new Rail defaults use Gap but existing explicit Attached survives migration', () => {
  assert.equal(DEFAULT_CONTEXT_RAIL.spacing, 'gap');
  assert.equal(normalizePromptConfiguration({}).contextRail.spacing, 'gap');
  assert.equal(normalizePromptConfiguration({contextRail: {mode: 'always', rows: 1}}).contextRail.spacing, 'attached');
  assert.equal(normalizePromptConfiguration({contextRail: {...DEFAULT_CONTEXT_RAIL, spacing: 'attached'}}).contextRail.spacing, 'attached');
});


for (const anchor of ['prompt', 'rail', 'above'] as const) {
  test(`horizontal-only Inside ${anchor}: Rail lies between shared boundaries`, () => {
    const c = routed();
    c.placement = 'composer';
    c.contextRail = {...c.contextRail, integration: 'inside', dividerAnchor: anchor, rows: 2, spacing: 'spacious'};
    const prepared = prepareRail(context, 100, c);
    const plan = planScreen({...input('bottom'), contextPlacement: 'composer', railPresentation: prepared.presentation});
    const rows = railCompositionPreview(context, 100, c).map(stripAnsi);
    assert.ok(rows[0]!.includes('─'), 'Upper boundary precedes or aligns with Rail');
    assert.ok(rows.at(-1)!.startsWith('─'), 'Bottom boundary encloses composer');
    assert.ok(plan.rail!.edgeRow <= plan.rail!.slots[0]!.top);
    assert.ok(plan.rail!.slots.every(slot => slot.top < regionOf(plan, 'separator')!.top));
    assert.ok(rows.every(row => !/[│┃║╭╮╰╯├┤┌┐└┘]/u.test(row)));
  });
}

test('Right Outside keeps Main horizontal boundaries separate from the Rail rectangle', () => {
  const c = routed(); c.placement = 'composer';
  c.contextRail = {...c.contextRail, relation: 'right', integration: 'outside', spacing: 'gap', rows: 2};
  const prepared = prepareRail(context, 100, c);
  const rows = railCompositionPreview(context, 100, c).map(stripAnsi);
  assert.equal(rows[0]!.length, prepared.presentation.column - prepared.presentation.gap);
  assert.equal(rows.at(-1)!.length, rows[0]!.length);
  c.contextRail.integration = 'inside';
  const integrated = railCompositionPreview(context, 100, c).map(stripAnsi);
  assert.equal(integrated[0]!.length, 100);
  assert.equal(integrated.at(-1)!.length, 100);
});

test('forced Right at narrow width yields to usable inline editor before far-right context', () => {
  const c = routed(); c.composerLayout = 'oneLine';
  c.modules = c.modules.map(module => module.surface === 'mainPrompt' ? {...module, visible: false} : module);
  c.contextRail = {...c.contextRail, relation: 'right', rows: 1};
  const prepared = prepareRail(context, 20, c);
  assert.equal(prepared.presentation.width, 0);
  assert.equal(prepared.presentation.editorColumns, 20);
  const rows = railCompositionPreview(context, 20, c).map(stripAnsi);
  assert.ok(rows.some(row => row.includes('echo hello')));
});
