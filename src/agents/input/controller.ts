import {CommandEditor} from '../../input/CommandEditor.js';
import {applyEditingKey} from '../../input/editingKeys.js';
import type {Key} from '../../terminal/keys.js';

export type InputOwner = 'COMPOSER' | 'TRANSCRIPT' | 'PANEL' | 'SEARCH' | 'CHOICE' | 'APPROVAL' | 'AGENT_MESSAGE' | 'PASSTHROUGH';
export type AgentAction = {kind: 'FocusTranscript' | 'FocusApproval' | 'Back' | 'ZoomIn' | 'ZoomOut' | 'Approve' | 'Deny' | 'SendMessage' | 'Interrupt' | 'Choose' | 'CopyVisible' | 'CopyFull'}
  | {kind: 'Navigate'; direction: number} | {kind: 'SelectDetailDepth'; depth: number} | {kind: 'ScrollTranscript'; rows: number} | {kind: 'EditMessage'; key: Key};

/** Context-specific bindings only. Controllers consume actions, not literal sequences. */
export function agentKeyAction(key: Key, owner: InputOwner): AgentAction | undefined {
  if (owner === 'COMPOSER' || owner === 'PASSTHROUGH' || owner === 'PANEL' || owner === 'SEARCH') return undefined;
  if (key.kind === 'escape') return {kind: 'Back'};
  if (owner === 'APPROVAL') {
    if (key.kind === 'toggleDetails') return {kind: 'Approve'};
    if (key.kind === 'interrupt') return {kind: 'Deny'};
    if (key.kind === 'pageUp' || key.kind === 'pageDown' || key.kind === 'wheelUp' || key.kind === 'wheelDown') return {kind: 'ScrollTranscript', rows: key.kind === 'pageUp' || key.kind === 'wheelUp' ? -5 : 5};
    return undefined;
  }
  if (key.kind === 'wheelUp' || key.kind === 'wheelDown' || key.kind === 'pageUp' || key.kind === 'pageDown') return {kind: 'ScrollTranscript', rows: (key.kind === 'wheelUp' || key.kind === 'pageUp' ? 1 : -1) * (key.kind.startsWith('wheel') ? 3 : 10)};
  if (owner === 'CHOICE') {
    if (key.kind === 'enter') return {kind: 'Choose'};
    if (key.kind === 'up' || key.kind === 'down') return {kind: 'Navigate', direction: key.kind === 'up' ? -1 : 1};
    if (key.kind === 'text' || key.kind === 'paste' || key.kind === 'backspace' || key.kind === 'complete') return {kind: 'EditMessage', key};
    return undefined;
  }
  if (owner === 'TRANSCRIPT') {
    if (key.kind === 'up' || key.kind === 'down') return {kind: 'Navigate', direction: key.kind === 'up' ? -1 : 1};
    if (key.kind === 'left' || key.kind === 'right') return {kind: key.kind === 'left' ? 'ZoomOut' : 'ZoomIn'};
    if (key.kind === 'text' && /^[1-5]$/u.test(key.value)) return {kind: 'SelectDetailDepth', depth: Number(key.value)};
    if (key.kind === 'text' && key.value === 'c') return {kind: 'CopyVisible'};
    if (key.kind === 'text' && key.value === 'C') return {kind: 'CopyFull'};
    return undefined;
  }
  if (key.kind === 'complete') return {kind: 'FocusTranscript'};
  if (key.kind === 'focusPrevious') return {kind: 'FocusApproval'};
  if (key.kind === 'enter') return {kind: 'SendMessage'};
  if (key.kind === 'interrupt') return {kind: 'Interrupt'};
  if (key.kind === 'toggleDetails') return {kind: 'FocusTranscript'};
  // Up/Down move between the rows of a multiline draft, as in the shell composer.
  return {kind: 'EditMessage', key};
}

export class AgentInputController {
  owner: InputOwner = 'AGENT_MESSAGE';
  readonly editor = new CommandEditor();
  selected = 0;
  depth = 2;
  scroll = 0;
  feedback?: string;
  feedbackUntil = 0;
  approvalRequestId?: string;
  choiceQuestion = 0;
  choiceSelected = 0;
  choiceAnswers: Record<string, string> = {};
  choiceToggled = new Set<string>();
  readonly choiceEditor = new CommandEditor();
  /** The draft's wrap width and first-row prefix as the view last drew them, so vertical moves follow the screen. */
  composerColumns = 80;
  composerPrefix?: string;
  dispatch(action: AgentAction, context: {shellEmpty: boolean; count: number} = {shellEmpty: true, count: 0}): void {
    switch (action.kind) {
      case 'FocusTranscript': if (context.shellEmpty) {this.owner = 'TRANSCRIPT'; this.selected = Math.max(0, context.count - 1);} else this.feedback = 'Transcript shortcuts require an empty shell composer'; break;
      case 'FocusApproval': this.owner = 'APPROVAL'; break;
      case 'Back': this.owner = this.owner === 'TRANSCRIPT' ? 'COMPOSER' : this.owner === 'APPROVAL' || this.owner === 'CHOICE' ? 'AGENT_MESSAGE' : 'COMPOSER'; break;
      case 'Navigate': this.selected = Math.max(0, Math.min(context.count - 1, this.selected + action.direction)); this.scroll = 0; break;
      case 'ZoomIn': this.depth = Math.min(5, this.depth + 1); break;
      case 'ZoomOut': this.depth = Math.max(1, this.depth - 1); break;
      case 'SelectDetailDepth': this.depth = Math.max(1, Math.min(5, action.depth)); break;
      case 'ScrollTranscript': this.scroll = Math.max(0, this.scroll + action.rows); break;
      case 'EditMessage': {
        const key = action.key;
        if (key.kind === 'up') this.editor.moveUp(this.composerColumns, this.composerPrefix);
        else if (key.kind === 'down') this.editor.moveDown(this.composerColumns, this.composerPrefix);
        else applyEditingKey(this.editor, key, this.composerColumns, this.composerPrefix);
        break;
      }
    }
  }
}
