/**
 * Workspace resources (#330/#331): what the Workspace Sidebar lists and how it
 * may be reached. A resource is a description of something another owner
 * keeps (tmux owns sessions/windows/panes, Git owns worktrees, GitHub owns
 * PRs, a provider owns its agent target); listing it never transfers that
 * ownership.
 *
 * State that the sidebar keeps apart, so none of them implies another:
 *
 *   selected   the row the sidebar's cursor is on (browsing; may show a cached preview)
 *   focused    whether the sidebar region owns the keyboard (WorkspaceFocus)
 *   active     what the owner reports as current (the attached tmux client's pane, this NMSh session)
 *   attention  something the owner reports needs the person (input wanted, approval, a failure)
 *   stale      the listing is older than its freshness window, or the owner could not be asked
 *
 * Support is explicit: `activatable` resources carry an activation intent the
 * caller can perform through a supported path; `informational` ones are shown
 * but cannot be activated; `unsupported` ones say why. A resource without a
 * truthful navigation path is never drawn as activatable.
 */

export type ResourceKind = 'section' | 'nmshSession' | 'managedTarget' | 'project' | 'worktree' | 'tmuxSession' | 'tmuxWindow' | 'tmuxPane' | 'githubPr' | 'githubIssue';
export type ResourceSupport = 'activatable' | 'informational' | 'unsupported';
export type Attention = 'input' | 'approval' | 'failed' | 'finished';

/** What activating a resource asks its owner to do. The caller performs it; the sidebar only proposes it. */
export type ActivationIntent =
  | {kind: 'tmux'; scope: 'session' | 'window' | 'pane'; target: string; socket?: string}
  | {kind: 'changeDirectory'; path: string}
  | {kind: 'nmshSession'; id: string}
  | {kind: 'managedTarget'; id: string}
  | {kind: 'openManager'; command: '/worktrees' | '/github' | '/agents' | '/sessions' | '/tmux'; argument?: string};

export interface WorkspaceResource {
  /** Stable identity across refreshes (`tmux:$1:@2:%3`, `worktree:/path`); selection follows it. */
  id: string;
  kind: ResourceKind;
  label: string;
  /** A short secondary text (a branch, a command, a path). */
  detail?: string;
  support: ResourceSupport;
  /** Why an informational/unsupported resource cannot be activated; shown, never hidden. */
  reason?: string;
  activation?: ActivationIntent;
  active?: boolean;
  attention?: Attention;
  /** Epoch ms when the owner was last asked; undefined when unknown. */
  observedAt?: number;
  children?: readonly WorkspaceResource[];
}

export const MAX_LABEL_CELLS = 80;
export const MAX_RESOURCES = 512;
export const MAX_DEPTH = 4;

/** External names (session titles, branch names, pane commands) are hostile text: controls, format characters and newlines become spaces. */
export function resourceText(value: string, limit = MAX_LABEL_CELLS): string {
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

/**
 * A resource as the sidebar may show it: text sanitized and bounded, children bounded in count and depth, and an
 * `activatable` claim downgraded to `unsupported` when no activation intent backs it.
 */
export function normalizeResource(resource: WorkspaceResource, depth = 0, budget = {remaining: MAX_RESOURCES}): WorkspaceResource | undefined {
  if (budget.remaining <= 0) return undefined;
  budget.remaining -= 1;
  const support: ResourceSupport = resource.support === 'activatable' && !resource.activation ? 'unsupported' : resource.support;
  const children = depth + 1 < MAX_DEPTH
    ? (resource.children ?? []).flatMap(child => normalizeResource(child, depth + 1, budget) ?? [])
    : [];
  return {
    ...resource,
    id: resourceText(resource.id, 512),
    label: resourceText(resource.label) || resource.kind,
    ...(resource.detail !== undefined ? {detail: resourceText(resource.detail)} : {}),
    support,
    ...(support !== resource.support ? {reason: 'no supported way to open this here'} : resource.reason !== undefined ? {reason: resourceText(resource.reason, 160)} : {}),
    ...(support === 'activatable' ? {} : {activation: undefined}),
    ...(children.length ? {children} : {children: undefined}),
  };
}

export interface ResourceRow {
  resource: WorkspaceResource;
  depth: number;
  /** Whether the row has children and whether they are shown. */
  expandable: boolean;
  expanded: boolean;
}

/** Rows in display order: a child is visible only when every ancestor is expanded. */
export function visibleRows(roots: readonly WorkspaceResource[], expanded: ReadonlySet<string>): ResourceRow[] {
  const rows: ResourceRow[] = [];
  const walk = (resource: WorkspaceResource, depth: number) => {
    const expandable = (resource.children?.length ?? 0) > 0;
    const open = expandable && expanded.has(resource.id);
    rows.push({resource, depth, expandable, expanded: open});
    if (open) for (const child of resource.children!) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

/** Every id in a tree, for reconciling selection and expansion after a refresh. */
export function resourceIds(roots: readonly WorkspaceResource[]): Set<string> {
  const ids = new Set<string>();
  const walk = (resource: WorkspaceResource) => { ids.add(resource.id); resource.children?.forEach(walk); };
  roots.forEach(walk);
  return ids;
}

/** Whether a listing observed at `observedAt` is past its freshness window (unknown observation time counts as stale). */
export function isStale(resource: Pick<WorkspaceResource, 'observedAt'>, now: number, freshnessMs: number): boolean {
  return resource.observedAt === undefined || now - resource.observedAt > freshnessMs;
}
