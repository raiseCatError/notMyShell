# Session presets v1

Refs #153. `/presets`, the shared command-palette action, and `nmsh --preset
<name>` describe NMSh startup configurations, independent of terminal profiles
and mise. `nmsh --presets` lists without executing. The one shared panel provides
create, list, inspect, launch and confirmed delete. `/resume` remains the place
to reattach the live sessions they create.

## Storage and explicit creation

`presets.json` is an additive sidecar beside the existing `config.json`, using
the shared platform/XDG config-directory resolver. Existing preferences and
transcripts are not reset or migrated. An absent sidecar means an empty list.

```json
{
  "version": 1,
  "presets": [
    {
      "name": "project",
      "cwd": "/work/project",
      "commands": ["mise run build", "git status --short"]
    }
  ]
}
```

Names are case-sensitive, 1–64 ASCII letters/numbers/spaces/underscore/hyphen,
starting with a letter/number. cwd must be an accessible absolute directory.
Commands are supplied explicitly, at most 16 / 16 KiB total; the form uses one
shell command per line. It never captures history, transcript commands, shell
state or environment dumps. Do not put passwords/tokens or secret values in
startup commands: reference existing environment tooling instead. There are no
stored environment values, provider/layout overrides or inferred project state.

Writes use a private 0600 staged file, atomic rename, exclusive writer lock and
an intervening-change guard. Malformed/unknown-version files, symlinks, duplicate
names and busy storage are reported and preserved. Unknown fields are ignored
on read and excluded from writes. Storage is limited to 100 presets / 256 KiB.
A crash leaving `presets.json.lock` requires checking that no writer is active
before manually removing that specific lock; NMSh does not guess lock ownership.

## Acknowledgement and launch

The first launch shows the exact quoted real `cd` and saved commands, wrapped
without elision and scrollable with PgUp/PgDn. Default No/Enter or Esc runs
nothing. An affirmative review records `acknowledged`, a SHA-256 digest of cwd
and ordered commands. Matching content needs no repeated confirmation; changes
require acknowledgement again. Saving a new preset never imports an
acknowledgement. A stale inspected snapshot cannot acknowledge changed storage.
This acknowledgement is separate from mise's per-inspection metadata consent.

Launch bypasses automatic startup restoration and creates a **new** service
session from the launcher's current cwd. A UI launch detaches its current live
session, preserving it for `/resume`; it never changes that old shell's cwd or
environment. Presets require the existing live-session service: an in-process
fallback is rejected before startup, since it cannot provide resumability.
No window/tab/profile authority is added.

The new real zsh reaches its initial prompt, then the frontend submits visible
`cd -- '<cwd>'` via its ordinary command path. Each subsequent startup command
waits for the preceding real prompt. Entries, output, timing and cwd enter the
normal transcript/journal. NMSh does not `chdir()` and pretend zsh followed.
Initial cwd is verified, including equivalent symlink/trailing-slash paths.
Failed cd/commands stop the remainder factually. Ctrl+C cancels the remaining
queue. Interactive commands retain normal passthrough behavior. Slash-prefixed
startup text remains real shell input, not an NMSh frontend action.

Preset launch postpones ordinary first-run setup to a later regular launch;
existing config defaults still apply and no onboarding preferences are reset.
Startup scheduling waits for frontend journaling/UI readiness and shell prompt
readiness. The queue is frontend-owned and is not persisted/replayed: if the
frontend exits partway through, the running command survives in its live shell,
but unsubmitted startup commands do not resume automatically. After completed
startup, detach/reattach and `/resume` use the existing session identity and
journal, with no startup replay or live-session protocol/schema change.

V1 deliberately excludes edit/rename UI, environment snapshots, arbitrary
workflow graphs, terminal-host profiles, provider/layout overrides, installation
and multi-shell support. Recreate a preset to change it through the UI; manual
sidecar edits remain subject to validation and acknowledgement.

Automated coverage uses isolated config/live-service sandboxes for storage,
consent, CLI/UI launches, literal paths, transcript order and resumability.
Ghostty/Terminal.app physical validation remains pending.
