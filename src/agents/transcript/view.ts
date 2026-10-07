import type {AgentSession} from '../sessions/model.js';
import type {AgentViewState} from '../sessions/AgentViews.js';
import {displayText, projectObject} from './projection.js';
import {displayWidth, truncateAnsi} from '../../util/text.js';

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of displayText(text).split('\n')) {
    let line = '';
    for (const c of paragraph) {if (displayWidth(line + c) > width) {out.push(line); line = '';} line += c;}
    out.push(line);
  }
  return out;
}
/** Source has been loaded on semantic actions; render never reads disk/provider config. */
export function renderSemanticAgentView(session: AgentSession, view: AgentViewState, columns: number, height: number): string[] {
  const c = view.controller!;
  const width = Math.max(1, columns);
  const header = [`${session.harness} · ${session.title}`, `${session.level} · ${session.state} · Input: ${c.owner}`];
  if (c.owner === 'CHOICE' && session.pendingChoice) {
    const q = session.pendingChoice.questions[c.choiceQuestion];
    if (!q) return header.map(l => truncateAnsi(displayText(l), width));
    const hints = ['Up/Down options · Enter answer', q.multiSelect ? 'Tab toggle · type Other · Esc back' : 'Type Other · Esc back'];
    const prefix = [`Question ${c.choiceQuestion + 1}/${session.pendingChoice.questions.length}`, ...wrap(q.question.slice(0, width * 2), width), ...(q.question.length > width * 2 ? ['[question excerpt]'] : [])];
    const option = q.options[c.choiceSelected]!;
    const body = [...wrap(`> ${c.choiceSelected + 1}/${q.options.length} ${c.choiceToggled.has(option.label) ? '[x] ' : ''}${option.label.slice(0, width * 2)}`, width), ...wrap(option.description.slice(0, width * 2), width)];
    const other = `Other: ${c.choiceEditor.text.slice(-Math.max(1, width - 7))}`;
    const room = Math.max(1, height - hints.length - header.length - prefix.length - 1);
    return [...header, ...prefix, ...body.slice(0, room), other, ...hints].slice(0, height).map(l => truncateAnsi(displayText(l), width));
  }
  const footer: string[] = [];
  if (session.pendingChoice) {
    if (c.owner === 'CHOICE') {
      const q = session.pendingChoice.questions[c.choiceQuestion];
      if (q) footer.push(...wrap(q.question, width), ...q.options.flatMap((o, i) => wrap(`${i === c.choiceSelected ? '>' : ' '} ${c.choiceToggled.has(o.label) ? '[x] ' : ''}${o.label}: ${o.description}`, width)), ...wrap(`Other: ${c.choiceEditor.text}`, width), ...wrap('Up/Down options · Enter answer · Tab toggles multiple · Esc back', width));
    } else footer.push(...wrap('Question pending · Shift+Tab to answer', width));
  }
  if (session.pendingApproval) footer.push(...wrap(c.owner === 'APPROVAL' ? `Permission: ${session.pendingApproval.tool} · Ctrl+O allow once · Ctrl+C deny · Esc back` : 'Permission pending · Shift+Tab or /approval to review', width));
  if (c.owner === 'TRANSCRIPT') {
    footer.push(...wrap('Up/Down objects · Left/Right zoom · 1-5 detail · c copy visible · C copy full · Esc shell', width));
  } else if (c.owner === 'AGENT_MESSAGE' && session.level === 'managed' && !['exited', 'failed'].includes(session.state)) {
    footer.push(...wrap(`> ${view.input || '(type an agent message)'}`, width), ...wrap('Enter send · Tab transcript · Esc shell', width));
  } else if (session.level !== 'managed') footer.push(...wrap('Observed metadata only · Esc shell', width));
  if (view.message) footer.push(...wrap(view.message, width));
  if (c.feedback && Date.now() < c.feedbackUntil) footer.push(...wrap(c.feedback, width));
  const source = session.transcript;
  if (source?.incomplete) footer.push(...wrap(`Incomplete: ${source.incomplete}`, width));
  let body: string[];
  if (c.owner === 'APPROVAL' && session.pendingApproval) {
    body = wrap(JSON.stringify(session.pendingApproval.input ?? {tool: session.pendingApproval.tool, target: session.pendingApproval.target}, null, 2), width);
  } else if (c.owner === 'TRANSCRIPT' && view.focusedObject) {
    body = [`Object ${c.selected + 1}/${source?.objects.length ?? 0} · ${view.focusedObject.kind}`, ...wrap(projectObject(view.focusedObject, c.depth).text, width)];
  } else if (source) body = source.objects.slice(-20).flatMap(o => [...wrap(`${o.kind}: ${o.text}`, width), ...(o.text.length >= 400 ? ['[excerpt · Tab for full source]'] : [])]);
  else body = session.events.flatMap(e => e.kind === 'assistant' || e.kind === 'user' ? wrap(`${e.kind}: ${e.text}`, width) : []);
  const room = Math.max(1, height - header.length - footer.length - 2);
  const scroll = Math.min(view.scroll, Math.max(0, body.length - room));
  const start = c.owner === 'TRANSCRIPT' || c.owner === 'APPROVAL' ? scroll : Math.max(0, body.length - room - scroll);
  return [...header, '', ...body.slice(start, start + room), '', ...footer].slice(0, height).map(l => truncateAnsi(displayText(l), width));
}
