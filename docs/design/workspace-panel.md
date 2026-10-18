# Workspace detail panel (#332)

Part of the workspace program ([#330](https://github.com/raiseCatError/notMyShell/issues/330)); shared foundation and integration contract: [workspace.md](workspace.md).

The panel explains what is selected or current; it is not an editor and never interprets PTY output. Content is
typed (`heading`, `text`, `muted`, `warning`, `field`, `diff`, `blank`), names its **source** and observation time,
and says when it is **partial**. Providers are pure functions over data the caller already holds:

| Provider | Input | Notes |
| --- | --- | --- |
| `resourceDetail` | a sidebar resource | what Enter would do, in words, or why it cannot be opened |
| `worktreeDetail` | a `/worktrees` record | Git's facts only; an unknown status is never shown as clean |
| `diffContent` | local `git diff` text | hunks through the GitHub review diff's `parsePatch` and line sanitizer; binary and rename-only files named; a line budget with an explicit "cut here"; the `diff --git` heading read from its own line in linear time (a name containing ` b/` stays whole; quoted headers show as `diff`) |
| `factDetail` | a Context Engine fact | the displayable value under its privacy policy, evidence, collection age, freshness, policy and what the capability reads (#305 explain view) |

`PanelController` keeps scroll per content id (kept when the same content is refreshed, and restored when the
person goes back to content still in the cache) and a bounded cache of recent content by id, so moving the sidebar selection can show a **cached preview** without asking any owner again. `renderPanel`
returns exactly rows × width: title with the focus mark, a source/age row (`stale` past the freshness window,
`time unknown` without an observation), an optional partial row, wrapped text, cut (not wrapped) diff lines keeping
their `+`/`-`/`\` marker, and, while focused, the position and key help.

Module diagnostics (why a module shows or not, collection timings, engine health) belong to #365, implemented on the
workflow track in #368 (`ModulesPanel`, `/doctor`). `factDetail` only presents what a `ContextFact` already carries;
at integration the panel should show #365's explain output for a module rather than grow a second diagnostics view.

Not in this slice: provider task/plan presentation (needs #339's normalized, provider-owned task state), approval
details (owned by the Managed Target approval flow), GitHub PR detail (the `/github` manager renders it today), and
editor hand-off commands.
