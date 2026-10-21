import {SNIPPETS, searchSnippets, type Snippet} from './snippets.js';

/**
 * The editor's searchable palette (#468): the built-in snippets of the file's format together with the editing actions the
 * editor already has (#463), found by typing. It lists; the editor runs the chosen entry.
 */
export type PaletteFormat = Snippet['format'];

export interface PaletteEntry {
  id: string;
  title: string;
  description: string;
  run: {kind: 'snippet'; snippet: Snippet} | {kind: 'action'; action: string};
}

const MARKDOWN_ACTIONS: ReadonlyArray<[action: string, title: string, description: string, keywords: string]> = [
  ['Action.Task', 'Toggle task', 'Check, uncheck or add a checkbox on the list items at the caret', 'task checkbox todo toggle'],
  ['Action.Renumber', 'Renumber list', 'Renumber the ordered list at the caret from its first number', 'renumber ordered list numbers'],
  ['Action.Link', 'Link', 'Make the selection a [link](url)', 'link url anchor'],
  ['Action.Image', 'Image', 'Insert ![alt](path)', 'image picture alt'],
  ['Action.Bold', 'Bold', 'Wrap or unwrap the selection in **', 'bold strong wrap'],
  ['Action.Italic', 'Italic', 'Wrap or unwrap the selection in *', 'italic emphasis wrap'],
  ['Action.Code', 'Inline code', 'Wrap or unwrap the selection in backticks', 'code inline backtick wrap'],
  ['Action.Strike', 'Strikethrough', 'Wrap or unwrap the selection in ~~', 'strike strikethrough wrap'],
  ['Action.Footnote', 'Footnote', 'A numbered reference here and its definition at the end', 'footnote reference note'],
  ['Action.FootnoteRenumber', 'Renumber footnotes', 'Number the footnotes 1, 2, 3… in the order they are referenced', 'footnote footnotes renumber number order'],
  ['Action.Problems', 'Problems…', 'Check links, images, anchors and footnotes (offline) and jump to each finding', 'problems diagnostics lint check broken links images errors warnings'],
  ['Action.Headings', 'Go to heading…', 'Search the document\'s headings and jump to one', 'heading outline navigate jump toc contents'],
  ['Action.Back', 'Back to previous position', 'Return to where you were before the last jump', 'back return previous jump'],
];
const TABLE_ACTIONS: ReadonlyArray<[string, string, string, string]> = [
  ['Action.RowAdd', 'Table: add row', 'A new empty row below the caret row', 'table row add insert'],
  ['Action.RowDelete', 'Table: delete row', 'Remove the caret\'s body row', 'table row delete remove'],
  ['Action.ColumnAdd', 'Table: add column', 'A new empty column to the right', 'table column add insert'],
  ['Action.ColumnDelete', 'Table: delete column', 'Remove the caret\'s column', 'table column delete remove'],
  ['Action.Align', 'Table: align column', 'Cycle none, left, centre, right', 'table align alignment'],
];

const PROBLEMS_ENTRY: PaletteEntry[] = [{id: 'Action.Problems', title: 'Problems…', description: 'Check links, images, ids and markup (offline) and jump to each finding', run: {kind: 'action', action: 'Action.Problems'}}];
const words0 = (query: string) => { const words = query.toLowerCase().split(/\s+/u).filter(Boolean); return words.length ? words : undefined; };

export function paletteEntries(format: PaletteFormat, query: string, inTable = false): PaletteEntry[] {
  const snippets: PaletteEntry[] = searchSnippets(query, format).map(snippet => ({id: snippet.id, title: snippet.title, description: snippet.description, run: {kind: 'snippet', snippet}}));
  if (format !== 'markdown') return [...snippets, ...(words0(query) ? PROBLEMS_ENTRY.filter(entry => words0(query)!.every(word => `${entry.title} ${entry.description}`.toLowerCase().includes(word))) : PROBLEMS_ENTRY)];
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const actions: PaletteEntry[] = [...(inTable ? TABLE_ACTIONS : []), ...MARKDOWN_ACTIONS]
    .filter(([, title, description, keywords]) => words.every(word => `${title} ${description} ${keywords}`.toLowerCase().includes(word)))
    .map(([action, title, description]) => ({id: action, title, description, run: {kind: 'action', action}}));
  return [...snippets, ...actions];
}

export const PALETTE_SIZE = SNIPPETS.length;
