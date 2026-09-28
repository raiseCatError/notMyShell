# VHS development demos

These optional VHS tapes capture a welcome, settings navigation, and one ordinary command. They are development/demo tooling only; NMSh does not depend on VHS at runtime, and `npm test` does not invoke it.

## Run

From the repository root, install the normal project dependencies if needed, then run:

```sh
mkdir -p dev/tapes/output
vhs dev/tapes/welcome.tape
vhs dev/tapes/settings.tape
vhs dev/tapes/command.tape
```

VHS writes GIFs under `dev/tapes/output/`, which is ignored by Git. VHS is not installed automatically. Install it using the instructions in the [official VHS repository](https://github.com/charmbracelet/vhs) if you want to record these demos.

The tapes use real NMSh startup, wall-clock values, and the ambient Vespyr blink. They are illustrative recordings, not deterministic snapshots or CI assertions. The deterministic presentation mode tracked in #173 is not available yet; generated media should be reviewed before sharing and should not be committed as golden output until that mode is implemented.

The tape files are validated with `vhs validate 'dev/tapes/*.tape'`. To regenerate all recordings locally after a change, run each tape command above. Keep tapes short, avoid network access and optional provider binaries, and do not add Chat, Command Palette, or Native Prompt style coverage while those surfaces remain owned by the active v0.5 work.
