import type {Key} from '../../terminal/keys.js';
import type {AgentSession} from '../sessions/model.js';
import type {AgentViewState} from '../sessions/AgentViews.js';
import {AgentInputController, agentKeyAction} from './controller.js';
import {applyEditingKey} from '../../input/editingKeys.js';
import {projectObject} from '../transcript/projection.js';
import {pickerArgument, pickerKey, selectedRow, type PickerKind, type PickerOpen, type PickerRow, type PickerState} from './pickers.js';
import type {ControlResult} from '../sessions/claudeAdapter.js';

export interface AgentSurfaceHost {
  shellEmpty: boolean;
  send(id: string, text: string): boolean;
  answer(id: string, requestId: string, allow: boolean): boolean;
  cancel(id: string): void;
  copy(text: string): void;
  copyReply(session: AgentSession, index: number): void;
  choose?(id: string, requestId: string, answers: Record<string, string>): boolean;
  /** NMSh's own pickers: built from what the provider published for this target; absent where unsupported. */
  openPicker?(session: AgentSession, kind: PickerKind): PickerOpen;
  /** Apply one picker row through the provider's control channel; the host re-renders when it settles. */
  applyPicker?(session: AgentSession, picker: PickerState, row: PickerRow): void;
}

/** `/model`, `/model sonnet`, `/effort`, `/effort high`: NMSh's own commands in a managed agent composer. A leading space sends the text to the agent verbatim. */
export function pickerCommand(text: string): {kind: PickerKind; argument: string} | undefined {
  const match = /^\/(model|effort)(?:[ \t]+(\S{1,96}))?[ \t]*$/u.exec(text);
  return match ? {kind: match[1] as PickerKind, argument: match[2] ?? ''} : undefined;
}

/**
 * Apply a picker choice and say what happened: the provider's acknowledgement (and when it takes effect), or its
 * refusal with the picker kept open. Never reports a change the provider did not acknowledge.
 */
export async function applyPickerChoice(view: AgentViewState, picker: PickerState, row: PickerRow, ops: {
  setModel(model: string | undefined): Promise<ControlResult>; setEffort(level: string | null): Promise<ControlResult>; render(): void;
}): Promise<boolean> {
  const c = view.controller!;
  picker.busy = true; picker.message = undefined; ops.render();
  const result = picker.kind === 'model' ? await ops.setModel(row.value ?? undefined) : await ops.setEffort(row.value);
  picker.busy = false;
  if (!result.ok) {
    // In the open picker the refusal stays beside the rows; a direct `/model x` reports it on the conversation.
    if (c.owner === 'PICKER' && c.picker === picker) picker.message = `Not changed: ${result.reason}`;
    else { view.message = `${picker.kind === 'model' ? 'Model' : 'Effort'} not changed: ${result.reason}`; if (c.picker === picker) c.picker = undefined; }
    ops.render(); return false;
  }
  if (c.picker === picker) { c.picker = undefined; c.owner = 'AGENT_MESSAGE'; }
  view.message = picker.kind === 'model'
    ? `Model → ${row.label}. Claude acknowledged; it applies from the next model call and is confirmed when Claude reports it.`
    : row.value === null ? 'Effort → model default. Claude acknowledged; applies from the next turn.' : `Effort → ${row.value}. Claude acknowledged; applies from the next turn (this session only).`;
  ops.render();
  return true;
}
/** Adapter operations are supplied by the host; this controller is never a portable API. */
export function handleAgentInput(view: AgentViewState, session: AgentSession, key: Key, host: AgentSurfaceHost): boolean {
  const c = view.controller ??= new AgentInputController();
  if (c.editor.text !== view.input) c.editor.replaceText(view.input);
  if (c.owner === 'PICKER') {
    const picker = c.picker;
    if (!picker || session.level !== 'managed') { c.picker = undefined; c.owner = 'AGENT_MESSAGE'; return false; }
    const outcome = pickerKey(picker, key);
    if (outcome === 'close') { c.picker = undefined; c.owner = 'AGENT_MESSAGE'; }
    else if (outcome === 'apply') { const row = selectedRow(picker); if (row) host.applyPicker?.(session, picker, row); }
    return false;
  }
  const action = agentKeyAction(key, c.owner);
  if (!action) return false;
  if (session.level !== 'managed') {
    if (action.kind === 'Back') return true;
    if (action.kind === 'ScrollTranscript') {c.dispatch(action); view.scroll = c.scroll;}
    return false;
  }
  view.message = undefined;
  const count = session.transcript?.objects.length ?? 0;
  if (c.owner === 'CHOICE') {
    const pending = session.pendingChoice;
    const question = pending?.questions[c.choiceQuestion];
    if (!pending || !question || c.approvalRequestId !== pending.requestId) {c.owner = 'AGENT_MESSAGE'; view.message = 'Question is no longer available.'; return false;}
    if (action.kind === 'Navigate') c.choiceSelected = Math.max(0, Math.min(question.options.length - 1, c.choiceSelected + action.direction));
    else if (action.kind === 'EditMessage') {
      if (action.key.kind === 'complete' && question.multiSelect) {const label = question.options[c.choiceSelected]!.label; if (c.choiceToggled.has(label)) c.choiceToggled.delete(label); else c.choiceToggled.add(label);}
      else applyEditingKey(c.choiceEditor, action.key);
    } else if (action.kind === 'Choose') {
      const answer = c.choiceEditor.text.trim() || (question.multiSelect ? [...c.choiceToggled].join(', ') : question.options[c.choiceSelected]!.label);
      if (!answer) {view.message = 'Select at least one option with Tab or type an answer.'; return false;}
      c.choiceAnswers[question.question] = answer;
      if (c.choiceQuestion === pending.questions.length - 1 && !host.choose?.(session.id, pending.requestId, c.choiceAnswers)) {
        view.message = 'Question response is unavailable. Your answer is retained; Enter retries.';
        return false;
      }
      c.choiceQuestion++; c.choiceSelected = 0; c.choiceToggled.clear(); c.choiceEditor.clear();
      if (c.choiceQuestion >= pending.questions.length) c.owner = 'AGENT_MESSAGE';
    } else if (action.kind === 'Back') c.owner = 'AGENT_MESSAGE';
    return false;
  }
  if (action.kind === 'FocusApproval') {
    if (session.pendingChoice && !session.pendingApproval) {c.owner = 'CHOICE'; c.approvalRequestId = session.pendingChoice.requestId; c.choiceQuestion = 0; c.choiceSelected = 0; c.choiceAnswers = {}; c.choiceToggled.clear(); c.choiceEditor.clear(); return false;}
    if (!session.pendingApproval) {view.message = 'No pending permission request.'; return false;}
    c.approvalRequestId = session.pendingApproval.requestId;
  }
  if (action.kind === 'Approve' || action.kind === 'Deny') {
    if (c.owner !== 'APPROVAL' || !c.approvalRequestId || session.pendingApproval?.requestId !== c.approvalRequestId || !host.answer(session.id, c.approvalRequestId, action.kind === 'Approve')) view.message = 'Permission request is no longer available.';
    c.owner = 'AGENT_MESSAGE'; c.approvalRequestId = undefined; return false;
  }
  if (action.kind === 'SendMessage') {
    const text = c.editor.text;
    if (!text.trim()) return false;
    if (text.trim() === '/approval') {
      if (session.pendingApproval) {c.owner = 'APPROVAL'; c.approvalRequestId = session.pendingApproval.requestId; c.editor.clear(); view.input = '';}
      else view.message = 'No pending permission request.';
      return false;
    }
    const command = pickerCommand(text);
    if (command) {
      const opened = host.openPicker?.(session, command.kind) ?? {ok: false as const, reason: `/${command.kind} is not available for this target.`};
      c.editor.clear(); view.input = '';
      if (!opened.ok) { view.message = opened.reason; return false; }
      const picker = opened.picker;
      if (command.argument) {
        const row = pickerArgument(picker, command.argument);
        if (row) { c.picker = picker; host.applyPicker?.(session, picker, row); return false; }
        picker.message = `No ${command.kind === 'model' ? 'model' : 'effort level'} named "${command.argument}"; choose one below.`;
      }
      c.picker = picker; c.owner = 'PICKER';
      return false;
    }
    const copy = /^\/copy(?:\s+(\d+))?\s*$/u.exec(text.trim());
    if (copy) {host.copyReply(session, Number(copy[1] ?? 1)); c.editor.clear();}
    else if (session.level !== 'managed' || !host.send(session.id, text)) view.message = 'This target is not accepting messages.';
    else c.editor.clear();
  } else if (action.kind === 'Interrupt') {
    if (session.state === 'working' || session.state === 'approval') host.cancel(session.id); else return true;
  } else if (action.kind === 'CopyFull' || action.kind === 'CopyVisible') {
    const object = session.transcript?.load(c.selected);
    if (object) host.copy(projectObject(object, action.kind === 'CopyFull' ? 5 : c.depth).text);
    else view.message = 'No eligible source object selected.';
  } else c.dispatch(action, {shellEmpty: host.shellEmpty, count});
  view.input = c.editor.text; view.scroll = c.scroll;
  if (c.owner === 'COMPOSER') return true;
  if (c.owner === 'TRANSCRIPT') {
    view.focusedObject = session.transcript?.load(c.selected);
    if (view.focusedObject) {
      const p = projectObject(view.focusedObject, c.depth);
      // Left/right skip missing levels while explicit depth uses documented fallback.
      if (action.kind === 'ZoomIn') c.depth = p.depths.find(d => d > p.depth && d >= c.depth) ?? p.depths.at(-1)!;
      else if (action.kind === 'ZoomOut') c.depth = p.depth;
      else c.depth = p.depth;
      c.feedback = `Detail ${c.depth}/5`; c.feedbackUntil = Date.now() + 1500;
    }
  }
  return false;
}
