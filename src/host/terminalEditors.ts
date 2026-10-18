import type {ProviderDescriptor} from '../providers/providers.js';
import type {HostEnvironment} from './HostActions.js';

/**
 * Terminal editors /open and `o` in /view can hand a file to when VISUAL and EDITOR are unset (#366). A curated list,
 * detected on PATH only: detection never runs an editor, and NMSh never installs one (no recipes; the upstream page is
 * named instead). `environment` means VISUAL/EDITOR, the default. Line and column forms live in editorArguments.
 */
export type TerminalEditorId = 'environment' | 'nvim' | 'hx' | 'micro' | 'vim' | 'nano' | 'emacs' | 'kak';

export interface TerminalEditorDescriptor extends ProviderDescriptor<TerminalEditorId> {
  /** The command NMSh composes, before the file arguments (Emacs needs -nw to stay in the terminal). */
  argv?: readonly string[];
}

export const TERMINAL_EDITORS: readonly TerminalEditorDescriptor[] = [
  {id: 'environment', family: 'editor', label: 'VISUAL / EDITOR', kind: 'native',
    description: 'The editor your shell names in VISUAL or EDITOR; when neither is set, choose one below'},
  {id: 'nvim', family: 'editor', label: 'Neovim', kind: 'external', executable: 'nvim', argv: ['nvim'],
    description: 'Opens at the line (+N)', source: 'https://neovim.io'},
  {id: 'hx', family: 'editor', label: 'Helix', kind: 'external', executable: 'hx', argv: ['hx'],
    description: 'Opens at the line and column (file:N:C)', source: 'https://helix-editor.com'},
  {id: 'micro', family: 'editor', label: 'Micro', kind: 'external', executable: 'micro', argv: ['micro'],
    description: 'Opens at the line and column (+N:C)', source: 'https://micro-editor.github.io'},
  {id: 'vim', family: 'editor', label: 'Vim', kind: 'external', executable: 'vim', argv: ['vim'],
    description: 'Opens at the line (+N)', source: 'https://www.vim.org'},
  {id: 'nano', family: 'editor', label: 'nano', kind: 'external', executable: 'nano', argv: ['nano'],
    description: 'Opens at the line and column (+N,C)', source: 'https://www.nano-editor.org'},
  {id: 'emacs', family: 'editor', label: 'Emacs', kind: 'external', executable: 'emacs', argv: ['emacs', '-nw'],
    description: 'In the terminal (-nw), at the line and column (+N:C)', source: 'https://www.gnu.org/software/emacs/'},
  {id: 'kak', family: 'editor', label: 'Kakoune', kind: 'external', executable: 'kak', argv: ['kak'],
    description: 'Opens at the line (+N)', source: 'https://kakoune.org'},
];

export const TERMINAL_EDITOR_IDS: readonly TerminalEditorId[] = TERMINAL_EDITORS.map(editor => editor.id);

export function terminalEditor(id: string): TerminalEditorDescriptor | undefined {
  return TERMINAL_EDITORS.find(editor => editor.id === id);
}

/** The curated editors found on this host's PATH, in catalog order. */
export function installedTerminalEditors(host: Pick<HostEnvironment, 'which'>): TerminalEditorDescriptor[] {
  return TERMINAL_EDITORS.filter(editor => editor.executable && host.which(editor.executable));
}
