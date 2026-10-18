import type {Key} from '../terminal/keys.js';
import {background, foreground, UI_COLORS} from '../ui/palette.js';
import {displayWidth, truncateText} from '../util/text.js';
import {bindingHelp, DEFAULT_BINDINGS, type Binding, type WorkspaceActionId} from './keymap.js';
import {isStale, normalizeResource, resourceIds, visibleRows, type ActivationIntent, type ResourceRow, type WorkspaceResource} from './resources.js';

/**
 * Workspace Sidebar (#331): a keyboard-first list of resources. Moving the
 * selection only proposes a cached, read-only preview; activation happens on
 * an explicit action and only for an activatable resource. The controller
 * holds browsing state (selection by id, expansion, filter, scroll) and never
 * performs I/O; the frontend feeds it listings and performs the intents it
 * returns.
 */

export type SidebarOutcome =
  | {kind: 'none'}
  | {kind: 'preview'; resource: WorkspaceResource}
  | {kind: 'activate'; resource: WorkspaceResource; intent: ActivationIntent}
  | {kind: 'unavailable'; resource: WorkspaceResource; reason: string};

export class SidebarController {
  private roots: WorkspaceResource[] = [];
  readonly expanded = new Set<string>();
  selectedId?: string;
  /** A filter being typed (`/`), or applied. Matching rows show with their ancestors. */
  filter = '';
  searching = false;
  scroll = 0;
  private seen = new Set<string>();

  /** Replace the listing. Selection follows its id; a vanished selection moves to the row that took its place. */
  setResources(roots: readonly WorkspaceResource[]): void {
    const previousRows = this.rows();
    const previousIndex = Math.max(0, previousRows.findIndex(row => row.resource.id === this.selectedId));
    this.roots = roots.flatMap(root => normalizeResource(root) ?? []);
    const ids = resourceIds(this.roots);
    // Sections open the first time they appear; after that the person's choice is kept.
    for (const root of this.roots) if (!this.seen.has(root.id)) { this.expanded.add(root.id); this.seen.add(root.id); }
    for (const id of [...this.expanded]) if (!ids.has(id)) this.expanded.delete(id);
    if (!this.selectedId || !ids.has(this.selectedId)) {
      const rows = this.rows();
      this.selectedId = rows[Math.min(previousIndex, rows.length - 1)]?.resource.id;
    }
  }

  resources(): readonly WorkspaceResource[] { return this.roots; }

  rows(): ResourceRow[] {
    const query = this.filter.trim().toLowerCase();
    if (!query) return visibleRows(this.roots, this.expanded);
    // Filtering shows every match with its ancestors, regardless of expansion.
    const keep = new Set<string>();
    const visit = (resource: WorkspaceResource, ancestors: string[]): boolean => {
      const own = `${resource.label} ${resource.detail ?? ''}`.toLowerCase().includes(query);
      const child = (resource.children ?? []).map(item => visit(item, [...ancestors, resource.id])).some(Boolean);
      if (own || child) { keep.add(resource.id); ancestors.forEach(id => keep.add(id)); }
      return own || child;
    };
    this.roots.forEach(root => visit(root, []));
    return visibleRows(this.roots, keep).filter(row => keep.has(row.resource.id));
  }

  selected(): ResourceRow | undefined {
    return this.rows().find(row => row.resource.id === this.selectedId);
  }

  /** A region action from the keymap. Focus actions are not the sidebar's (applyFocusAction handles them). */
  dispatch(action: WorkspaceActionId): SidebarOutcome {
    const rows = this.rows();
    const index = rows.findIndex(row => row.resource.id === this.selectedId);
    const select = (next: number): SidebarOutcome => {
      const row = rows[Math.max(0, Math.min(rows.length - 1, next))];
      if (!row || row.resource.id === this.selectedId) return {kind: 'none'};
      this.selectedId = row.resource.id;
      return {kind: 'preview', resource: row.resource};
    };
    const current = rows[index];
    switch (action) {
      case 'sidebar.up': return select(index <= 0 ? 0 : index - 1);
      case 'sidebar.down': return select(index + 1);
      case 'sidebar.first': return select(0);
      case 'sidebar.last': return select(rows.length - 1);
      case 'sidebar.expand':
        if (current?.expandable && !current.expanded) { this.expanded.add(current.resource.id); return {kind: 'none'}; }
        return current?.expandable ? select(index + 1) : this.activate(current);
      case 'sidebar.collapse': {
        if (current?.expandable && current.expanded) { this.expanded.delete(current.resource.id); return {kind: 'none'}; }
        // On a child, Left moves to its parent, as in a file tree.
        const parent = current ? rows.slice(0, index).reverse().find(row => row.depth === current.depth - 1) : undefined;
        return parent ? select(rows.indexOf(parent)) : {kind: 'none'};
      }
      case 'sidebar.activate': return this.activate(current);
      case 'sidebar.search': this.searching = true; return {kind: 'none'};
      default: return {kind: 'none'};
    }
  }

  private activate(row: ResourceRow | undefined): SidebarOutcome {
    if (!row) return {kind: 'none'};
    if (row.resource.support === 'activatable' && row.resource.activation) return {kind: 'activate', resource: row.resource, intent: row.resource.activation};
    if (row.expandable) {
      if (row.expanded) this.expanded.delete(row.resource.id); else this.expanded.add(row.resource.id);
      return {kind: 'none'};
    }
    return {kind: 'unavailable', resource: row.resource, reason: row.resource.reason ?? 'this item cannot be opened here'};
  }

  /** Keys while the filter is being typed. Returns false for keys that are not the filter's (the caller handles them). */
  handleSearchKey(key: Key): boolean {
    if (!this.searching) return false;
    if (key.kind === 'text' || key.kind === 'paste') this.filter = (this.filter + key.value.replace(/[\p{Cc}\p{Cf}]/gu, '')).slice(0, 64);
    else if (key.kind === 'backspace') this.filter = Array.from(this.filter).slice(0, -1).join('');
    else if (key.kind === 'enter') this.searching = false;
    else if (key.kind === 'escape') { this.searching = false; this.filter = ''; }
    else return false;
    // The selection moves to the first row that matches by itself (not an ancestor shown for context).
    const query = this.filter.trim().toLowerCase();
    const rows = this.rows();
    const own = (row: ResourceRow) => `${row.resource.label} ${row.resource.detail ?? ''}`.toLowerCase().includes(query);
    const current = rows.find(row => row.resource.id === this.selectedId);
    if (!current || (query && !own(current))) this.selectedId = (query ? rows.find(own) : undefined)?.resource.id ?? rows[0]?.resource.id;
    return true;
  }
}

export interface SidebarRenderOptions {
  width: number;
  rows: number;
  /** The sidebar owns the keyboard. */
  focused: boolean;
  mode: 'docked' | 'compact' | 'drawer';
  safe: boolean;
  color: boolean;
  now: number;
  /** Listings older than this are labelled stale. */
  freshnessMs?: number;
  bindings?: readonly Binding[];
  /** A message from the last outcome (an unavailable reason, an activation failure). */
  message?: string;
}

interface Marks {focus: string; selected: string; active: string; collapsed: string; expanded: string; attention: string}

const marks = (safe: boolean): Marks => safe
  ? {focus: '>', selected: '>', active: '*', collapsed: '+', expanded: '-', attention: '!'}
  : {focus: '▸', selected: '›', active: '●', collapsed: '▸', expanded: '▾', attention: '!'};

/**
 * Exactly `rows` lines, each at most `width` cells. Focus, selection, the active resource, attention and staleness each
 * have their own mark, so none depends on color. Pure: no I/O and no clock reads beyond `now`.
 */
export function renderSidebar(controller: SidebarController, options: SidebarRenderOptions): string[] {
  const width = Math.max(1, options.width);
  const rows = Math.max(1, options.rows);
  const m = marks(options.safe);
  const reset = options.color ? '\u001b[0m' : '';
  const tone = (color: {red: number; green: number; blue: number}, text: string, bold = false) =>
    options.color ? `${bold ? '\u001b[1m' : ''}${foreground(color)}${text}${reset}` : text;
  const fit = (text: string) => truncateText(text, width);
  const lines: string[] = [];

  const title = `${options.focused ? m.focus : ' '} Workspace${options.mode === 'compact' ? '' : options.focused ? ' (focused)' : ''}`;
  lines.push(tone(options.focused ? UI_COLORS.accent : UI_COLORS.secondary, fit(title), options.focused));
  const filter = controller.searching ? `/ ${controller.filter}_` : controller.filter ? `/ ${controller.filter}` : undefined;
  if (filter) lines.push(tone(UI_COLORS.accent, fit(filter)));

  const body = controller.rows();
  const footer: string[] = [];
  const selected = controller.selected();
  const freshness = options.freshnessMs ?? 30_000;
  if (options.message) footer.push(tone(UI_COLORS.failure, fit(options.message)));
  else if (selected && selected.resource.support !== 'activatable' && selected.resource.reason) footer.push(tone(UI_COLORS.subtle, fit(selected.resource.reason)));
  if (options.mode !== 'compact' && options.focused) {
    const help = bindingHelp(options.bindings ?? DEFAULT_BINDINGS, 'sidebar').filter(([, label]) => ['open', 'filter', 'back to the composer'].includes(label))
      .map(([chord, label]) => `${chord} ${label}`).join(' · ');
    footer.push(tone(UI_COLORS.subtle, fit(help)));
  }
  const height = Math.max(0, rows - lines.length - footer.length);
  const index = Math.max(0, body.findIndex(row => row.resource.id === controller.selectedId));
  // Keep the selection in view with the least scrolling.
  if (index < controller.scroll) controller.scroll = index;
  if (index >= controller.scroll + height) controller.scroll = index - height + 1;
  controller.scroll = Math.max(0, Math.min(controller.scroll, Math.max(0, body.length - height)));

  if (!body.length && height) lines.push(tone(UI_COLORS.subtle, fit(controller.filter ? '  nothing matches' : '  nothing to show yet')));
  for (const row of body.slice(controller.scroll, controller.scroll + height)) {
    const resource = row.resource;
    const isSelected = resource.id === controller.selectedId;
    const indent = '  '.repeat(Math.min(row.depth, options.mode === 'compact' ? 1 : 3));
    const expander = row.expandable ? `${row.expanded ? m.expanded : m.collapsed} ` : '  ';
    const active = resource.active ? `${m.active} ` : '';
    const attention = resource.attention && resource.attention !== 'finished' ? ` ${m.attention}${resource.attention}` : resource.attention === 'finished' ? ' (exited)' : '';
    const stale = resource.kind === 'section' && resource.observedAt !== undefined && isStale(resource, options.now, freshness) ? ' (stale)' : '';
    const detail = options.mode === 'compact' || !resource.detail ? '' : `  ${resource.detail}`;
    const lead = `${isSelected ? m.selected : ' '}${indent}${expander}${active}`;
    const label = `${resource.label}${attention}${stale}`;
    const room = Math.max(0, width - displayWidth(lead));
    const plain = truncateText(`${label}${displayWidth(label) < room ? truncateText(detail, room - displayWidth(label)) : ''}`, room);
    const text = `${lead}${plain}`;
    if (!options.color) { lines.push(fit(text)); continue; }
    const base = resource.support === 'activatable' ? (resource.active ? UI_COLORS.accent : UI_COLORS.primary) : UI_COLORS.subtle;
    const painted = isSelected && options.focused
      ? `${background(UI_COLORS.selection)}${foreground(UI_COLORS.primary)}${text}${' '.repeat(Math.max(0, width - displayWidth(text)))}${reset}`
      : `${foreground(base)}${text}${reset}`;
    lines.push(painted);
  }
  while (lines.length < rows - footer.length) lines.push('');
  lines.push(...footer);
  return lines.slice(0, rows);
}
