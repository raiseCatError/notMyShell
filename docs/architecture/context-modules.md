# Context Modules and the Context Engine

NMSh runs around a real persistent zsh, Bash or Fish session. Its native modules
present useful context about that session and workspace without taking over shell
execution. The Context Engine is the current engineering direction for sharing
that context across NMSh's presentation surfaces.

This guide describes the implementation released in v0.17.0, the latest
published stable release.
Installable Context Packs are a direction, not an available public extension API.

## From capability to presentation

```text
shell lifecycle / editor demand / explicit refresh
    → trusted core capability services
    → immutable facts
    → native modules
    → Surface Router
    → Main Prompt / Context Rail / Right Context
```

| Concept | Responsibility |
|---|---|
| Capability | A named operation implemented and governed by trusted NMSh core code, such as obtaining the session directory or Git branch |
| Fact | A resolved value with its source, collection time, freshness, trust, sensitivity, persistence policy and resolution cost |
| Module | A presentation definition using declared facts, visibility conditions, priority, icons and width policy |
| Surface Router | Selects a supported destination from module definitions and saved user choices, without collecting data |
| Context Pack | A planned installable collection of declarative module descriptions; it grants no arbitrary execution authority |

Facts form a read-only model: consumers use resolved values rather than mutate them
or refresh them during painting. The current adapter converts the existing
`PromptContext` snapshot into typed facts, retaining compatibility with providers
and historical prompts. This is not yet a general-purpose capability scheduler or
a complete replacement of every legacy context field.

Collection occurs outside rendering. Existing shell lifecycle and editor-demand
paths refresh context; rendering reads the available snapshot. A failure means
unavailable context, not a guessed value or permission to try another executable.
Modules receive a restricted projection of their fact inputs and visibility
inputs, rather than filesystem, process or network handles.

## Presentation surfaces

| Surface | Purpose |
|---|---|
| Main Prompt | Stable identity and navigation context, such as directory, project and Git |
| Right Context | Independently anchored context at the right edge of the prompt area |
| Context Rail | Live contextual modules attached to the composer, with their own geometry and priority fitting |

`/prompt` exposes module routing: **Auto**, **Main Prompt**, **Right Context**,
**Context Rail** and **Hidden**. Auto uses the module's defined preference; it does
not dynamically move a module between surfaces when space runs out. Explicit
choices override that preference. Existing saved left/right placement remains in
effect unless a surface is explicitly chosen; upgrades do not automatically move
existing modules into the Rail.

The Rail can be **Vertical** or **Right of Prompt**, with one or two content rows.
Relation, Direction, Integration, Spacing and Divider Anchor are independent
presentation choices. Theme and style can follow the Main Prompt or use supported
Rail choices. Inside integration uses horizontal divider geometry rather than
vertical box borders. Priority fitting compacts or drops whole module groups to
fit available space.

A Rail placed Right of Prompt remains separate from Right Context. The shell
indicator, when placed on the right, keeps its independent prompt anchor; the Rail
must fit or drop before covering that anchor. Narrow layouts still prioritize the
composer and transcript. `screenPlan.ts` supplies the geometry used by drawing,
cursor placement, hit testing, viewport capacity and PTY sizing.

Rail mode **Auto** reserves no rows without visible routed content. **Always**
reserves the configured rows, and **Off** reserves none. New Rail settings use
Auto, one row, Vertical, Follow Main direction, Outside integration, Gap spacing,
Prompt Level divider anchoring, Follow Main theme/style and Priority overflow.
Existing valid saved settings retain their presentation.

The Rail is Native module presentation. External prompt providers and Prompt None
suppress it while retaining its settings. Fullscreen/raw passthrough hides it
along with NMSh's other frontend chrome. Rail content is not written to the
transcript or archived as a live aggregate.

## Current first-party modules

The existing registry is the starting point for the ecosystem, rather than a
second plugin framework.

| Module group | Current modules |
|---|---|
| Identity and navigation | Project, working directory |
| Version control | Git branch, Rich Git status |
| Session | Exit status, current shell |
| Tooling | Marker-based toolchain context, opt-in discovered tools |
| Command context | Kubernetes context, Docker context |

Visibility can depend on repository presence, a nonzero exit status or the command
being composed. Toolchains, Kubernetes and Docker support show-on-command
conditions. Auto preferences put identity/Git in Main Prompt, shell/inventory in
Right Context, and command contexts in Context Rail. Legacy saved placement still
wins when no new surface is selected.

`/shell` exposes the current-shell module's **Hidden**, **When not default** and
**Always** policies, plus **Left** or **Right** placement. These edit the same module
state used by `/prompt`; they do not select a different shell. When not default
compares the active session backend with the configured default for new sessions.
Changing Side preserves visibility, including Hidden.

## Discovery and security

**Entering a repository must never itself execute arbitrary repository-controlled
code through NMSh context discovery.** Normal user-configured shell startup/hooks
and explicitly selected external prompt providers are separate trust boundaries;
context discovery does not inherit their execution authority.

Metadata discovery uses parser-only reads with file-size and traversal bounds.
The contextual metadata reader refuses leaf symlinks and special files. Toolchain
markers and local inventory are evidence, not permission to execute a discovered
binary. Kubernetes authentication `exec` entries are never run to find a context.
Discovery does not source `.envrc`, run project scripts or installers, evaluate
configuration as code, or contact the network.

When a probe is needed, trusted core code owns the executable identity, allowed
operations, environment, time and output limits. The contextual Git collector uses
trusted Git rather than repository/PATH candidates, disables hooks and fsmonitor,
and does not inspect submodules. Status fails closed for repository configuration
that could require filters, includes, partial-clone fetching or extra worktree
configuration; branch/root may remain available. Missing status is not presented
as proof of a clean repository.

Fact-derived display text is bounded and neutralizes terminal controls and bidi
formatting controls. Display text is not reused as a filesystem path or shell
command. Secret facts and facts marked never-store are suppressed; display-only
facts can appear live but are excluded from prompt snapshots. Only snapshot-safe
facts may enter historical presentation. Privacy policy survives value refresh.

## Declarative Context Packs: the direction

A Context Pack will describe modules and request known capabilities. It will not
supply shell commands, JavaScript, executable paths, arbitrary arguments, hooks,
code-evaluating templates or includes. Core remains responsible for collection,
cache and execution policy. Merely installing a pack must not grant new execution
powers, and a repository must not activate an executable extension by being opened.

There is no finalized pack format, installer or public module SDK in this
checkpoint. General capability scheduling, fuller migration of legacy context and
a bounded expansion of high-value first-party modules remain upcoming. Status
Strip module routing is deferred. Any executable extension tier would require a
separate sandbox and capability design; it is outside the data-only pack model.

## Further reading

- [Architecture overview](../../ARCHITECTURE.md): the frontend, shell transport, transcript and shared screen plan.
- [Native prompt customization](prompt-customization.md): style, theme, vibrance and Chroma.
- [Shell adapters](shell-adapter.md): the real zsh, Bash and Fish backends.
- [Roadmap](../../ROADMAP.md#current-engineering-focus--native-modules-and-context-engine): implemented and upcoming scope.
- [Security policy](../../SECURITY.md): NMSh's trust boundaries.
- [Demo gallery](../demos.md#see-notmyshell-in-motion): the reel and feature recordings.
