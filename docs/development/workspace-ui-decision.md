# Workspace UI decision: sidebar, detail panel and Git/GitHub (proposal, 2026-10-16)

**Status (2026-10-16): decided.** The maintainer approved (1) the experimental switch for v0.20, (2) Direction B
then C as the v0.21 direction, and (3) the Setup order below. Implemented for v0.20 and v0.19 on the stabilization
branches (see "Decisions and implementation" at the end); the v0.21 work is not started.

Original status: proposal for the maintainer; nothing here was implemented or removed. This is the final attempt at the
native workspace UI the maintainer asked for; it ends in a recommendation, not another redevelopment cycle. A second,
smaller proposal (Setup navigation) follows at the end.

## What exists on the v0.20 candidate (audit of `c71a4284`)

| Surface | What it shows | Size of the code |
|---|---|---|
| `/sidebar` (28 columns docked, 18 compact, drawer at ≤70) | tmux panes (only inside tmux), this repository's worktrees (Enter: `cd` the persistent shell), and three links: GitHub PRs and issues → `/github`, Agents → `/agents`, NMSh sessions → `/sessions` | workspace layer ~1,670 lines |
| `/panel` (36–72 columns, ~38% of the width) | a description of the sidebar's selection only ("Kind: section · 1 item inside · Enter opens /worktrees") | (same layer) |
| `/github` | read-only PRs, issues, checks and diffs through `gh`; merge *planning* only | ~2,890 lines |
| `/worktrees` | the worktree manager: list, open (`cd` in the same shell), create/remove with review | ~1,110 lines |
| `/sessions` | NMSh's live sessions (attach, rename, kill) | core, not workspace |

Already recorded as not wired in v0.20: sidebar rows for NMSh sessions, click-to-select rows, region-aware wheel.

**What physical QA and a capture show.** With `/sidebar` and `/panel` open at 120 columns (VHS still,
`zz-ws` capture in the release-track scratch), the terminal itself is left about **43 columns**: the prompt, the
welcome text and `git log --oneline` are cut. The sidebar holds six rows of content; the panel spends a third of the
screen on "Kind: section". That is the "disproportionately large and detached" the maintainer saw: the width costs
more than the content earns.

## What is NMSh's own, and what is better delegated

**NMSh's own** (no external tool knows these): the persistent shell and its sessions (live, detached, waiting for
input), the command queue, background tasks, input ownership, and switching the *same* shell between worktrees.

**Better delegated** to mature tools that already do them well: staging, diffs, history, branches and rebases
(Lazygit, GitUI, tig), PR/issue review and CI (gh, GitHub.com), file browsing (Yazi).

What their interaction models get right (studied, not copied):
- **Lazygit / GitUI:** a few panels with one clear focus, every action one key away, and a contextual key bar that
  only lists what works *here*. They own the whole terminal while open, then give it back.
- **Yazi / Serie:** dense, purpose-built views (Miller columns with preview; a commit graph) that are worth a full
  screen because the task is browsing.
- **gh / GitHub.com / GitHub Desktop:** the separation of *Changes* from *History*, and compact repository context
  in one header row (repo · branch · sync state); anything deeper opens a dedicated view or the browser
  (`gh pr view --web`, `gh browse`).

The common lesson: **context is one row; depth is a dedicated, full-screen tool you enter and leave.** NMSh's docked
columns sit in between: permanent width for a shallow listing.

## Three directions

### A. Improve the native UI (the one prototype)

A single compact *context column* replaces sidebar + panel: only NMSh-owned state, no permanent detail panel.

```
 Context                │ ❯ npm test
 ◆ notMyShell  main ↑2  │   ✔ 42 passing
 ─────────────────────  │
 Sessions               │ ❯ git status --short
  ● this one            │    M src/app/TerminalApp.ts
  ◇ api · waiting       │
 Worktrees              │ ✳ Cooking… · 12s
  › main                │ ╭─ ≡ Queue · 2 pending
    feature/x  ↓        │ ├─ next  npm run build
 Tasks                  │ ╰─ 2     npm test
  ∙ npm run dev 04:12   │ ❯ _
 ↑↓ select · Enter open · Esc composer
```

24 columns docked (drawer below 100), Enter opens the existing manager or switches the shell. Its value depends on
wiring session rows and task rows, which v0.20 does not have.

### B. Integrate existing tools (recommended default)

NMSh launches the mature tool in its own persistent shell, where full-screen passthrough already works, and returns
to the composer when it exits:

- `/git` → Lazygit, else GitUI, else tig, whichever `/tools` detects; none installed → a factual compact status
  (`git status --short --branch` in the transcript) plus a `/tools` hint. Never a dependency.
- `/github` (or `/pr`) → `gh pr status` / `gh pr list` in the transcript; `o` on a block opens it with
  `gh pr view --web`; `gh browse` for the repository. The read-only native `/github` stays as is for v0.20 and is
  re-evaluated against this.
- Repository context stays where it already is: one prompt row (project · cwd · branch · changes), with ahead/behind
  added there, not in a column.
- `/worktrees` and `/sessions` stay as NMSh commands (they are NMSh's own).

### C. Retire the docked sidebar and detail panel

Remove `/sidebar` and `/panel` from the default experience; keep worktrees, sessions, tasks and GitHub reachable
through their commands and the Direction B integrations.

## Comparison

| | Current | A. Context column | B. Integrate | C. Retire |
|---|---|---|---|---|
| Useful content | 6 rows + panel that restates them | sessions, worktrees, tasks (needs wiring) | the full power of Lazygit/gh | commands only |
| Width taken at 120 columns | up to ~77 (center ~43) | 24 (center 95) | 0 at rest; full screen only while used | 0 |
| Visual cohesion | detached columns, own styles | uses NMSh's queue/task/selection styles | the tools' own look while open | n/a |
| Performance | listings refresh on open | same | none at rest | none |
| Maintenance | ~1,670 lines + frame/keymap/hit-testing tests | similar, plus new wiring | small: detection + launch + fallback | removes code |
| Risk to PTY sizing and focus | docked regions resize the PTY | same | none (full-screen passthrough is existing) | none |

## Recommendation (decision gate)

The prototype (A) is better than the current UI only once session and task rows are wired, and even then it spends
a column on what the composer area, the queue preview and the task bar now show in place. It is not *meaningfully*
better than B for its cost. So:

1. **v0.20:** do not present `/sidebar` and `/panel` as finished features. Smallest safe step: label them
   *Preview* in `/help` and the CHANGELOG (no code removed, no release-branch rewrite), or hide them behind an
   experimental switch if the maintainer prefers. Everything they link to stays reachable by command.
2. **v0.21:** implement Direction B (`/git`, `/github` delegation, ahead/behind in the prompt), then retire the
   docked sidebar and detail panel (Direction C) in the same release, with a migration note.
3. Keep `/worktrees`, `/sessions`, background tasks and the queue as NMSh's native surfaces.

Maintainer decision needed: (1) Preview label vs experimental switch for v0.20; (2) approval of B then C for v0.21.

## Setup navigation (proposal, separate from the above)

Physical QA found theme settings scattered across Prompt and Appearance in an order where dependent rows come first.
Implemented on `fix/v019-setup-ux`: previews that show real results (screen savers on a sample screen, Random's
real choices), a Chroma preview that follows the setting, a Chroma row that says what hides or stills it, and a
legible activity-wording example. **Proposed, not implemented** (changes the step order everyone has learned):

1. **Look** (renamed Appearance, now first after Terminal): Theme family → variant → accent → theme text → UI
   chrome, then **Chroma** (the only place it is chosen) with its dependent rows indented under it.
2. **Prompt**: provider and prompt style; Chroma appears here as one read-only line ("Chroma: Aurora · change it in
   Look") instead of a second control.
3. **Motion**: Reduced Motion and Decorative effects move here from Appearance, beside the motion rows they govern,
   so "why does Chroma not move" is answered on the same step.
4. Idle & activity, Editor, Transcript, and the rest unchanged.

A test already guarantees every setting stays reachable from Setup; the reorder keeps that guarantee.

## Decisions and implementation (2026-10-16)

**v0.20: experimental switch (implemented, `fix/v020-workspace-experimental` → `stabilize/v0.20.0`).** A persisted
`workspacePanels` setting, Off by default and Off for any configuration that does not have it (nothing else in a
saved configuration changes). Settings → Layout → *Workspace sidebar & panel* and Setup → Editor show it, labelled
experimental. While Off: `/sidebar`, `/panel` and their focus forms open nothing and say how to turn it on;
`keymap.json` workspace bindings are kept as written but take no key, and `/keys` says so; the PTY always has every
column. Turning it Off closes open regions and returns focus to the composer. The gate is one check on the actions
that open or focus a region (`WorkspaceHost.perform`), so geometry, PTY sizing, passthrough and focus code are
unchanged when it is On. `/worktrees`, `/sessions`, `/github` and `/background` never depend on it. Help, `/sidebar`
and `/panel` descriptions, the Ask concept, the CHANGELOG and v0.20 physical QA pass 1 (now 1.0a–c required, 1.1–1.7
as optional 1E, recorded Deferred) say the same.

**v0.21 direction (approved, not started).** Direction B: delegate Git to Lazygit (the conservative default) or GitUI,
Serie or GitOUI by explicit choice, `gh` for PRs and issues, launched in the persistent shell through the existing
full-screen passthrough; keep `/worktrees`, `/sessions`, background tasks and the queue native. Then Direction C:
retire the docked sidebar and detail panel once nothing important depends on them. No further sidebar redesign.

**Setup order (implemented, `fix/v019-setup-order` → `stabilize/v0.19.0`, merged forward into `stabilize/v0.20.0`).**
Start → Terminal → **Look → Prompt → Motion** → Cursor → Editor → the rest unchanged, as proposed above. Look is the
only place Setup chooses Chroma; Prompt shows it as a read-only line whose Enter goes to Look's Chroma row; Motion
starts with Reduced Motion, Decorative effects, Shimmer and Milestone effects (the Shimmer preview moved with its
row). `/setup look` and `/setup motion` are new entries; `/setup appearance` and `/setup chroma` still work. Found
and fixed on the way: `/setup chroma` counted its row over hidden theme rows and selected Theme Studio.
