# Context Modules and the Context Engine

NMSh runs around a real persistent zsh, Bash or Fish session. Its native modules
present useful context about that session and workspace — the project, Git,
runtimes, cloud and cluster contexts, the machine, an AI agent's session —
without taking over shell execution or running anything the workspace chose.

> **Release status.** v0.17.0 shipped the foundation: typed fact metadata,
> native module routing and the Context Rail. Everything else described here —
> capability scheduling, the first-party module catalog, declarative Context
> Packs, Status Strip routing and Status Strip 2.0, `/modules` and Claude Code agent context — shipped in
> v0.18.0.

## From capability to presentation

```text
shell lifecycle (prompt, command end) / editor demand / explicit refresh
    → Context Engine: trusted core capabilities, scheduled on demand
    → typed facts (value + provenance, freshness, trust, sensitivity, persistence)
    → modules: native built-ins and declarative Context Pack modules
    → Surface Router
    → Main Prompt / Right Context / Context Rail / Status Strip
```

| Concept | Responsibility |
|---|---|
| Capability | A named operation implemented and audited in NMSh core, such as "the nearest project manifest" or "the active Kubernetes context". It declares what it reads, which environment variables it may see, its cost, timeout, cache lifetime and the privacy class of its fields |
| Fact | One resolved value with its source and evidence, collection time, freshness, trust, sensitivity, persistence policy and resolution cost |
| Module | A presentation definition: the facts it uses, visibility condition, show-on-command words, priority, icon, semantic role and preferred surface |
| Surface Router | Places each module from its definition and your saved choice, without collecting data |
| Context Pack | Installable **data** describing modules over core capabilities. It cannot run anything |

## Facts

Every fact carries, besides its value:

| Field | Meaning |
|---|---|
| Source | The capability and its evidence (for example `package.json`, `~/.kube/config`) |
| Collected / freshness | When it was resolved; **fresh**, **stale** (last known, refreshing) or unknown — never presented as fresh when it is not |
| Trust | Where it came from: the live shell session, local metadata, a fixed system tool |
| Sensitivity | `public`, `private` or `secret` |
| Persistence | `snapshot-safe` (may be kept with a command's prompt in the transcript), `display-only` (live surfaces only) or `never-store` |
| Cost | `cheap`, `bounded-async` or `probe` |

Field policies refine this per field: for example an Azure subscription name is
snapshot-safe while its subscription and tenant ids are private and display-only.
Secret-class facts are never presented; display-only facts never enter prompt
snapshots, journals or exported settings. Every fact value crosses one
sanitization boundary (no controls, bidi formatting, prototypes, functions or
unbounded data) and every displayed string crosses the display boundary.

## The engine: demand, scheduling and caching

- **Demand-driven.** Only capabilities that a visible, routed module needs are
  resolved, and only the fields it uses. Hidden modules, modules on a surface that
  is not shown, and show-on-command modules whose command is not being typed
  cost nothing.
- **Off the typing path.** Collection is asynchronous; rendering reads facts
  already in memory and performs no filesystem, process or network work.
- **Scoped cache.** Results are keyed by capability, session, workspace and the
  environment variables the capability declared. A directory change stages a
  new scope; the old one stays visible until the new one settles (or 150 ms), so
  the prompt never flashes empty.
- **Bounded.** At most four resolutions run at once (per family: metadata 4,
  system 2, agent 1). Every resolution has a timeout; failures back off
  (5 s, 15 s, 60 s) and the last known value stays visible as stale. A
  capability's first resolution gets three times its timeout, so a cold start is
  not mistaken for a hung read.
- **Cancellation.** Superseded work (rapid `cd`) is cancelled; a late result can
  never appear for a scope that is no longer current.
- **Freshness.** Values expire after their capability's lifetime and refresh on
  the next demand while showing the stale value. A finished command marks the
  workspace, runtime, infrastructure, cloud, Git and agent facts for refresh,
  since a command can change any of them. Only visible time-based facts (clock,
  session duration, memory, battery, agent status) refresh on a timer.
- **Shell-reported environment.** Each prompt, the live zsh, Bash or Fish
  reports an allowlisted set of environment values (for example `PATH`,
  `AWS_PROFILE`, `KUBECONFIG`, `VIRTUAL_ENV`) and the mere *presence* of
  credential variables. Values outside the allowlist are never sent; credential
  values never are. A capability sees only the variables it declared.

`npm run bench:smoke` measures cold and warm collection, twenty rapid directory
changes, rendering every module on every surface, hidden modules and Git in a
large repository, with generous p95 budgets enforced in CI.

## Capabilities

| Capability | Reads |
|---|---|
| `project.package` | the nearest declarative manifest up to the repository root (`package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `deno.json`, `composer.json`, `pubspec.yaml`, `pom.xml`, `Project.toml`, `setup.cfg`) and lockfile names |
| `runtime.node`, `runtime.python`, `runtime.go`, `runtime.rust`, `runtime.java` | version pins (`.nvmrc`, `.python-version`, `go.mod`, `rust-toolchain.toml`, `.java-version`, `.tool-versions`, `mise.toml`, …), virtualenv/conda metadata, rustup settings, and the version of the executable the shell would run **from its install layout** (`node_version.h`, `GOROOT/VERSION`, the JDK `release` file, a versioned interpreter path) — never by running it |
| `env.toolVersions` | the `[tools]` table of `mise.toml` or `.tool-versions` lines |
| `env.direnv` | whether `.envrc` exists (never its content) and what direnv itself recorded in the shell (`DIRENV_FILE`) |
| `infra.kubernetes`, `infra.docker` | `current-context` and contexts of KUBECONFIG files (users and `exec` entries are never read); the Docker CLI's current context |
| `infra.terraform`, `infra.helm`, `infra.pulumi` | `*.tf` names and the selected workspace; `Chart.yaml`; `Pulumi.yaml` and the CLI's selected stack |
| `cloud.aws`, `cloud.gcp`, `cloud.azure` | profile, region and SSO metadata from AWS config (the credentials file only for an expiry time); the active gcloud configuration; the default Azure subscription |
| `system.os`, `session.user`, `session.jobs`, `session.duration`, `system.time`, `system.memory`, `system.battery`, `system.cpu`, `system.uptime` | OS release files; user, host and SSH presence (never the client address); the shell's job count; the clock; fixed system tools at absolute paths (`/usr/bin/vm_stat`, `/usr/bin/pmset`) or `/proc` and `/sys` on Linux; kernel CPU counters and uptime through Node (no process). The Status Strip's own items use these same capabilities |
| `vcs.git` | stash depth and upstream from Git's own files, alongside the existing Git branch/status collector |
| `agent.claude` | the private record Claude Code's status line hands to NMSh (see Agent context) |

Each module's detail view in `/prompt` lists exactly what it reads.

## What is collected, and what never is

Collected, locally and only when a module needs it: the files and environment
values listed above, bounded in size and parsed as data (JSON, TOML, YAML with
aliases limited, XML without entities, INI). Nothing is uploaded.

Never: running a project's scripts or a discovered binary to learn a version;
sourcing `.envrc` or any shell configuration; Kubernetes `exec` credential
plugins; cloud API calls or authentication; reading credential values, tokens
or private keys; broad environment dumps; network access of any kind.

## Modules

Native built-ins (Project, Path, Git branch, Rich Git, toolchains, exit status,
Kubernetes, Docker, current shell, discovered tools) keep their behavior. The
first-party catalog adds modules through bundled Context Packs:

| Pack | Modules |
|---|---|
| Project (`nmsh.project`) | Package; Node, Python, Go, Rust, Java (show on command) |
| Environment (`nmsh.environment`) | Tool versions (mise/asdf), direnv |
| Infrastructure (`nmsh.infrastructure`) | Terraform/OpenTofu, Helm, Pulumi (show on command) |
| Cloud (`nmsh.cloud`) | AWS, Google Cloud, Azure (show on command) |
| System (`nmsh.system`) | OS, user/host/SSH, jobs, session duration, time, battery, memory |
| VCS (`nmsh.vcs`) | Git stash, upstream (in a repository) |
| Agents (`nmsh.agents`) | Claude Code session, Claude Code limits (show on command) |

Show-on-command modules appear while you type a related command (`kubectl`,
`terraform`, `aws`, `npm`, `claude`, …) and cost nothing otherwise. Cloud,
infrastructure and agent modules are on by default in that mode; the rest start
hidden. Every module has a deterministic preview, works with Theme and Neutral
roles, shows Nerd Font icons or plain labels in Safe glyph mode, and fits by
priority on narrow screens.

## Surfaces

| Surface | Purpose |
|---|---|
| Main Prompt | Stable identity and navigation context, such as directory, project and Git |
| Right Context | Independently anchored context at the right edge of the prompt area |
| Context Rail | Live contextual modules attached to the composer, with their own geometry and priority fitting |
| Status Strip | One persistent row at the Top or Bottom of the NMSh pane with Left, Center and Right groups; routed modules carry a strip group and outrank the strip's own items when space runs out |

Choices per module: **Auto** (the module's preferred surface), **Main Prompt**,
**Right Context**, **Context Rail**, **Status Strip** where the module supports
it, and **Hidden**. Explicit choices win; saved left/right placement is kept;
upgrades never move existing modules.

The Rail can be **Vertical** or **Right of Prompt**, with one or two content rows.
Relation, Direction, Integration, Spacing and Divider Anchor are independent
presentation choices. Theme and style can follow the Main Prompt or use supported
Rail choices. Priority fitting compacts or drops whole module groups to fit. Rail
mode **Auto** reserves no rows without visible routed content, **Always** reserves
the configured rows, **Off** reserves none. The Rail is Native presentation:
external prompt providers and Prompt None suppress it (keeping its settings),
fullscreen programs hide it, and it is never written to the transcript.

## Configuring modules

`/prompt` → Modules has three tabs:

- **Modules** — what is in use, in prompt order: Space show/hide, Shift+↑↓
  reorder, ←→ option, P side, S surface, M mirror right side, Enter details.
- **Catalog** — every module grouped by category, with modules suggested by
  local evidence under **Recommended here**.
- **Packs** — bundled and installed Context Packs with their verified state;
  installed packs can be enabled, disabled or removed (with confirmation).

A module's details show what it reads, whether its value may be kept with
commands in history, and each fact's current state ("fresh · 3s ago", "last
known, refreshing", "unavailable (timed out after 1500 ms)", "not checked").
`/shell` edits the current-shell module's visibility and side.

## Context Packs

A Context Pack is a JSON document (`nmsh.context-pack/v1`, at most 64 KiB) with an
id, version, license, provenance, compatibility (`contextApi`, NMSh version), the
capabilities it requires, module records and optional recommendations. Module
records use only literal labels, a fixed set of formatters (version, percent,
duration, until, clock, …), conditions over declared fields, core icon ids,
semantic roles, surfaces, show-on-command words and priority.

**Packs are data, not plugins.** A pack cannot contain or reference shell text,
commands, argv, JavaScript, executable or file paths, templates, includes, hooks
or URLs. Parsing is strict and bounded: an unknown key is an error, so a future
field can never be silently accepted. A pack gains no authority by being
installed — it can only present facts that NMSh core already collects, under
their privacy policies. A pack requiring a capability this NMSh lacks is
**unsupported**, never partially active.

```text
nmsh packs                          bundled and installed packs and their state
nmsh packs inspect FILE             validate; show what it would read and add
nmsh packs install FILE [--sha256 HEX] [--replace] [--yes]
nmsh packs remove ID [--yes]
nmsh packs enable ID | disable ID
```

Installation shows what the pack reads and adds, then asks. With `--sha256` the
file must match that digest. Installs and removals are staged and atomic under
NMSh's config directory (`context-packs/`); a tampered or edited manifest is
reported as **integrity failed** and not loaded. Other states: enabled, disabled,
missing file, invalid, unsupported, incompatible. The `nmsh.*` namespace is
reserved for bundled packs. Installed modules start hidden.

Recommendations are deterministic and explain their evidence ("go.mod in this
project", "kubectl is installed"). They never install a pack or enable a module.
Entering a repository never installs, enables or executes anything.

There is no network registry or download: packs are local files you choose.

## Agent context

NMSh can show a Claude Code session's model, effort, context-window use and
rate limits through ordinary modules (`Claude Opus · Max · CTX 43%` and
`5H 61% · 7D 20%`).
It uses Claude Code's official status-line interface, never terminal scraping:

1. `nmsh agent-status setup` shows the exact change to Claude Code's
   `settings.json` (a `statusLine` command running `nmsh agent-status claude`)
   and applies it only on Yes; `nmsh agent-status remove` removes exactly that.
   An existing custom status line is reported, never replaced.
2. Claude Code runs the bridge with its status JSON. The bridge keeps an
   allowlist (model, effort, context window and token counts, 5-hour, 7-day and
   spend-limit use with their resets, duration, cost, lines changed, repository,
   worktree and pull request, session name) in a private file (mode 0600) under
   NMSh's runtime directory, tagged with the NMSh session it runs in; Claude's
   own session id is kept only as a short digest, and transcript paths are
   never stored. It prints a compact line for Claude Code using the same modules
   and theme.
3. The `agent.claude` capability reads only the record for the current NMSh
   session. Values are display-only (never kept in history); a report older
   than two minutes says how old it is, and an absent one shows nothing.
   Prompts, transcripts and terminal output are never read.

The Context Engine does not depend on Claude Code; another agent with a stable
structured interface could supply the same fact shape later.

## Discovery and security

**Entering a repository never executes repository-controlled code through NMSh
context discovery, contacts the network, or exposes secrets.** Normal
user-configured shell startup/hooks and explicitly selected external prompt
providers are separate trust boundaries; context discovery does not inherit
their execution authority.

Metadata reads refuse leaf symlinks and special files and are size-bounded.
Executables found on PATH are evidence, never permission: NMSh does not run
them for context, and refuses to even inspect one inside the current workspace,
writable by others or owned by another user. Only fixed system tools at absolute
paths are run (for memory and battery). The contextual Git collector uses trusted
Git, disables hooks and fsmonitor, does not inspect submodules, and fails status
closed for repository configuration that could run filters or fetch; missing
status is never shown as clean.

Fact-derived display text is bounded and neutralizes terminal controls and bidi
formatting. It is never reused as a path or command. Pack metadata, workspace
names and settings text cross the same boundary in `/prompt`, `nmsh packs` and
`nmsh agent-status`.

## Further reading

- [Context Engine design](../design/context-engine.md): architecture, invariants and test gates.
- [Architecture overview](../../ARCHITECTURE.md): the frontend, shell transport, transcript and shared screen plan.
- [Native prompt customization](prompt-customization.md): style, theme, vibrance and Chroma.
- [Shell adapters](shell-adapter.md): the real zsh, Bash and Fish backends.
- [Privacy](../privacy.md): what NMSh stores and never records.
- [Security policy](../../SECURITY.md): NMSh's trust boundaries.
