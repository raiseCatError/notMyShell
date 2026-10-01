# VHS development demos

These optional VHS tapes capture welcome, Settings v2, an ordinary command and native history selection. They are development tooling only; NMSh does not depend on VHS at runtime, and `npm test` does not invoke it.

## Run

From the repository root, install the normal project dependencies if needed, then run:

```sh
npm run build
mkdir -p dev/tapes/output
vhs validate 'dev/tapes/*.tape'
vhs dev/tapes/welcome.tape
vhs dev/tapes/settings.tape
vhs dev/tapes/command.tape
vhs dev/tapes/intelligence.tape
```

VHS writes GIFs under `dev/tapes/output/`, which is ignored by Git. VHS is not installed automatically. Install it using the instructions in the [official VHS repository](https://github.com/charmbracelet/vhs) if you want to record these demos.

The launch helper isolates HOME/preferences, disables update checks, opts out of the session service and uses the current `NMSH_DETERMINISTIC=1` seam. It never edits user config or attaches an existing session. Each tape exits so the helper can remove its private directory. Deterministic presentation freezes decorative motion and the completion clock only; real command durations, scheduling, font, build identity and cwd still vary. Review captures before sharing; these are not pixel goldens.

Prefer VHS 0.12.1 or later: the previously tested host 0.12.0 binary reported success without materializing recordings. Validation is useful locally; visual-golden CI is deferred because font/host/timing differences would make it fragile. No end-user QA or optional-tool installation is required. Keep captures short and offline.
