# Optional mise project awareness

Refs #253 / #154. NMSh works without mise. `/tools` → mise → **M project
awareness** is also reachable through Settings and the command palette's Tools
action. Opening it checks executable availability and standard local/ancestor
markers using filesystem metadata only. It never reads templates or invokes
mise, even after cwd changes. The ordinary tools catalog does not version-probe
mise. Existing real-zsh hooks remain authoritative.

**I inspect** and **R refresh** open a default-No confirmation showing the two
metadata commands and explaining template execution and remote task fetching.
Only affirmative intent invokes `mise ls --current --json`, then
`mise tasks ls --json`. No `trust`, activation, config edits, installation or
environment application occurs. Refresh requires renewed consent. Esc cancels
the review or aborts the active detached metadata process group.

The dedicated capture uses argv, ignored stdin, a three-second deadline per
command and 128 KiB combined stdout/stderr limit. stderr is discarded; failures
are generic. JSON parsing retains tool names/versions and task names only.
Unknown fields, including `env`, `run`, descriptions and source paths, never
enter UI/cache/persistence. Metadata remains in memory, bounded to 32 identities
keyed by canonical cwd, binary and ancestor marker/project stat identity. Config
changes invalidate an identity; explicit refresh reruns inspection. No typing or
rendering invocation exists. A failed inspection is cached factually.

Task Enter inserts a quoted visible `mise run '<task>'` into the composer. A
separate Enter submits it through ordinary real-zsh execution. Tasks may execute
project actions or install tools; returned names carry no safety endorsement.
Option-like/control-containing names are rejected. No environment values or new
settings are persisted.

Current upstream behavior was checked against the
[ls reference](https://mise.jdx.dev/cli/ls.html),
[task-list reference](https://mise.jdx.dev/cli/tasks/ls.html),
[template execution warning](https://mise.jdx.dev/templates.html), and tagged
[`v2026.9.18` task source](https://github.com/jdx/mise/blob/v2026.9.18/src/cli/tasks/ls.rs).
The tool JSON is an object of version arrays; task JSON is an array of objects.
Task listing may fetch remote task files and evaluates resolved task directories.
The consent screen therefore does not describe metadata as side-effect-free.

Standard marker coverage is conservative, not a full reimplementation of mise
config selection: `mise.toml`, `.mise.toml`, `.mise/config.toml`,
`.config/mise/config.toml`, `.tool-versions`. Environment-specific/custom config
may exist without a detected marker. Metadata inspection remains explicitly
available when installed. There is no automatic task argument editor, active
hook inference or persistent metadata/consent.

Fake executable tests cover trust boundaries, bounded failures, schema/cache,
quoting and composer integration. Physical QA remains separate and only needs
mise checks when already installed/configured.
