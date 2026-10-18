import type {ModEntry, ModKind} from './model.js';
import {displayText} from '../transcript/projection.js';
import type {Key} from '../../terminal/keys.js';
import {cycleTab, tabCycleDelta} from '../../ui/PanelShell.js';

export const MOD_TABS = ['All', 'Portable', 'Provider-native', 'Context Packs'] as const;
export type ModAction = {kind: 'Search' | 'Back' | 'ActivateAction' | 'Refresh' | 'BackspaceSearch' | 'Toggle' | 'Inspect'} | {kind: 'TypeSearch'; text: string} | {kind: 'SelectTab' | 'Navigate'; direction: number} | {kind: 'ProviderNext'} | {kind: 'Scroll'; rows: number};
/** What a static inspection found: Claude's component summary, and a mod's hooks and calls. */
export interface ModInspection {details?: string; hooks: string[]; calls: string[]; error?: string}
export class ModsController {
  private inventory: ModEntry[] = [];
  tab: 'All' | ModKind = 'All';
  provider?: string;
  query = '';
  owner: 'PANEL' | 'SEARCH' = 'PANEL';
  selected = 0;
  scroll = 0;
  details = false;
  refreshing = false;
  stale = false;
  message?: string;
  /** A change waiting for Enter: turning the entry on or off through the provider's own command. */
  confirm?: {key: string; enable: boolean};
  /** A provider command in flight, in words ("Disabling skins…"). */
  busy?: string;
  readonly inspections = new Map<string, ModInspection>();
  get selectedEntry(): ModEntry | undefined {return this.rows[this.selected];}
  /** Every entry, unfiltered (the host checks a change against the full listing). */
  get entries(): readonly ModEntry[] {return this.inventory;}
  inventoryEntry(key: string | undefined): ModEntry | undefined {return key ? this.inventory.find(entry => entry.key === key) : undefined;}
  get providers(): string[] {return [...new Set(this.inventory.flatMap(i => [i.provider, ...i.applicability]))].filter(p => p !== 'nmsh').sort();}
  get rows(): ModEntry[] {
    const q = this.query.toLowerCase();
    return this.inventory.filter(i => (this.tab === 'All' || i.kind === this.tab) && (!this.provider || i.provider === this.provider || i.applicability.includes(this.provider))
      && [i.name, i.id, i.provider, i.profileId, i.kind, i.source, i.scope, i.description, i.version].filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  setProvider(provider?: string): void {this.provider = provider; this.selected = 0; this.details = false;}
  setInventory(items: ModEntry[]): void {
    const key = this.rows[this.selected]?.key;
    this.inventory = items;
    this.selected = Math.max(0, this.rows.findIndex(i => i.key === key));
  }
  dispatch(action: ModAction): 'close' | 'refresh' | 'toggle' | 'inspect' | undefined {
    // While a provider command runs, keys wait: its result decides what the list shows next.
    if (this.busy) return undefined;
    if (this.confirm) {
      // A pending change owns Enter and Esc; anything else cancels it so nothing changes by accident.
      const pending = this.confirm;
      this.confirm = undefined;
      if (action.kind === 'ActivateAction' && this.selectedEntry?.key === pending.key) {this.confirm = pending; return 'toggle';}
      if (action.kind !== 'Back') this.message = 'Change cancelled.';
      return undefined;
    }
    switch (action.kind) {
      case 'Toggle': {
        const entry = this.selectedEntry;
        if (!entry) break;
        if (!entry.toggle?.supported) {this.message = entry.toggle ? `Can't toggle here: ${entry.toggle.reason}` : 'NMSh has no supported way to turn this on or off.'; break;}
        if (entry.enabled === 'unknown') {this.message = 'Its current state is unknown, so NMSh will not change it.'; break;}
        this.confirm = {key: entry.key, enable: entry.enabled === 'no'}; this.message = undefined; break;
      }
      case 'Inspect': if (this.selectedEntry) {this.details = true; this.scroll = 0; return 'inspect';} break;
      case 'Search': this.owner = 'SEARCH'; this.details = false; break;
      case 'TypeSearch': this.query += displayText(action.text).slice(0, Math.max(0, 256 - this.query.length)); this.selected = 0; break;
      case 'BackspaceSearch': this.query = [...this.query].slice(0, -1).join(''); this.selected = 0; break;
      case 'Back': if (this.owner === 'SEARCH') {this.query = ''; this.owner = 'PANEL'; this.selected = 0;} else if (this.details) this.details = false; else return 'close'; break;
      case 'Navigate': if (this.details) this.scroll = Math.max(0, this.scroll + action.direction); else {this.selected = Math.max(0, Math.min(this.rows.length - 1, this.selected + action.direction)); this.scroll = 0;} break;
      case 'Scroll': this.scroll = Math.max(0, this.scroll + action.rows); break;
      case 'ActivateAction': if (this.rows.length) {this.details = true; this.owner = 'PANEL'; this.scroll = 0;} break;
      case 'SelectTab': this.tab = cycleTab(MOD_TABS, this.tab, action.direction); this.selected = 0; this.details = false; break;
      case 'ProviderNext': {const filters = [undefined, ...this.providers]; this.setProvider(filters[(filters.indexOf(this.provider) + 1) % filters.length]); break;}
      case 'Refresh': return 'refresh';
    }
    return undefined;
  }
  async refresh(load: () => Promise<ModEntry[]>): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true; this.message = undefined;
    try {this.setInventory(await load()); this.stale = false;} catch (error) {this.stale = true; this.message = displayText(error instanceof Error ? error.message : 'Refresh failed').slice(0, 200);}
    finally {this.refreshing = false;}
  }
}

export function modsKeyAction(key: Key, owner: 'PANEL' | 'SEARCH'): ModAction | undefined {
  if (key.kind === 'escape' || key.kind === 'interrupt') return {kind: 'Back'};
  if (key.kind === 'up' || key.kind === 'down') return {kind: 'Navigate', direction: key.kind === 'up' ? -1 : 1};
  if (key.kind === 'pageUp' || key.kind === 'pageDown' || key.kind === 'wheelUp' || key.kind === 'wheelDown') return {kind: 'Scroll', rows: key.kind === 'pageUp' || key.kind === 'wheelUp' ? -5 : 5};
  if (owner === 'SEARCH') {
    if (key.kind === 'enter') return {kind: 'ActivateAction'};
    if (key.kind === 'text' || key.kind === 'paste') return {kind: 'TypeSearch', text: key.value};
    if (key.kind === 'backspace') return {kind: 'BackspaceSearch'};
    return undefined; // Tab does not switch filters during editing.
  }
  const delta = tabCycleDelta(key);
  if (delta) return {kind: 'SelectTab', direction: delta};
  if (key.kind === 'enter') return {kind: 'ActivateAction'};
  if (key.kind === 'text') {
    if (key.value === ' ') return {kind: 'Toggle'};
    if (key.value.toLowerCase() === 'i') return {kind: 'Inspect'};
    if (key.value === '/') return {kind: 'Search'};
    if (key.value.toLowerCase() === 'r') return {kind: 'Refresh'};
    if (key.value.toLowerCase() === 'p') return {kind: 'ProviderNext'};
  }
  return undefined;
}
