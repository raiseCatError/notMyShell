# v0.10 compatibility coverage (unreleased)

The deterministic fixture suite runs through real nested PTYs and persistent zsh.
It is automated protocol coverage, not GUI or physical host certification.

Run all checks with `npm run build`, `npm run typecheck`, `npm test` and
`git diff --check`. For a focused pass:

```sh
env -u NO_COLOR node --import=tsx --test tests/compatibilityHarness.test.ts tests/muxInterop.test.ts
```

Existing color snapshots require truecolor; remove an inherited `NO_COLOR` for
that run. Dedicated no-color tests still set their own environment. On this local
machine default parallelism twice timed out in Terminal.app sandbox teardown;
a full `npm test -- --test-concurrency=4` passed. This is recorded as a teardown
concurrency concern, not a physical host failure or a hidden passing retry.

## Category matrix

| Category | Automated coverage | Optional real tools | Physical QA |
| --- | --- | --- | --- |
| Ordinary finite CLI | stdout/stderr, exit 7, lifecycle, journal ownership, persistent `$?` | Tool-specific behavior not evaluated by new fixtures | Pending git/gh/ls/eza/brew/npm/pnpm as available |
| Noisy finite | 1000 bounded lines, completion, folding, narrow resize, full copy/journal retained | Existing suite exercises command output | Pending representative real builds |
| Streaming | 650 ms cadence, LIVE, resize, Ctrl+C, no passthrough/folding | ping/tail/dev servers not evaluated by new fixtures | Pending |
| Canonical inline input | newline input, termios before/after, return | Real prompts not evaluated | Pending |
| Raw inline interactive | bracketed paste, keyboard protocol, mouse reports, resize, exit restore | Existing inline trust-picker fixture | Pending |
| Fullscreen TUI | alternate screen, full size, resize, protocol ownership, exit restore | Existing `less` and GNU screen tests where installed | Pending vim/nano/fzf/lazygit/btop |
| Agent-style UI | raw UI, paste, mouse, resize, Ctrl+C, clean composer return | No paid account required; actual agent tools not evaluated | Pending available tools |
| Nested PTY | node-pty inner agent, input/output forwarding and resize | tmux/GNU screen skip automatically if absent | Pending selection and key modifiers |
| Shell augmentation | Existing provider/adapter unit tests only | zoxide/Atuin real behavior not evaluated in this pass | Pending |

The fixture file is `tests/fixtures/compatibility.mjs`: finite, noisy, streaming,
canonical, inline, fullscreen, agent and nested modes. Interactive modes clean up
keyboard/paste/mouse/cursor requests before exit. The nested mode uses the
existing node-pty dependency; no new packages, accounts or network are needed.
All fixtures and LiveSandbox resources have explicit teardown.

## Host matrix

| Host | Automated evidence | Optional local real tool | Current physical QA |
| --- | --- | --- | --- |
| Ghostty | capability, probe, renderer, frontend profile tests | Not a GUI launch | Pending |
| Terminal.app | baseline persistent editor/paste/resize fixture | Not a GUI launch | Pending |
| iTerm2 | passive profile and reattach fixture | Not evaluated | Pending |
| Kitty | passive profile and reattach fixture | Not evaluated | Pending |
| WezTerm | passive profile and reattach fixture | Not evaluated | Pending |
| tmux | conservative capability nesting, synthetic Shift mouse guards | tmux 3.7c passed local PTY tests | Physical terminal selection/key forwarding pending |
| Supacode / other embedded hosts | generic baseline, nested PTY and agent fixtures | Not evaluated | Pending; no support certification |

## tmux ownership and limits

Existing `muxInterop` and `liveHardening` coverage exercises NMSh inside tmux,
tmux inside NMSh, full size, resizing, shell job suspension, bracketed paste,
mouse-mode replay, pane/server closure and NMSh live-session reattach. The new
mouse-enabled client test detaches and reattaches an actual tmux client: NMSh's
frontend survives in the pane and the same live session remains attached. A
fullscreen fixture subsequently receives the pane size (minus tmux's status row)
and exits back to the composer.

Both tmux and GNU screen remain optional. CI skips unavailable tools; deterministic
nested PTY coverage always runs. Mouse `on` was configured only on a private test
server. Tests never change user tmux configuration. Synthetic Shift reports test
NMSh guards; they cannot certify the GUI's native selection gesture. tmux owns
outer mouse handling, while the foreground TUI owns reports inside passthrough.
Use Ctrl+J for multiline if extended Shift+Enter forwarding is unavailable;
verify terminal/tmux selection modifiers physically. No multiplexer features or
automatic tmux escape tunneling are added to NMSh.

See [multiplexer architecture](../architecture/multiplexer-interop.md) for older
observations and environment persistence limits. This new matrix does not extend
those historical observations into fresh physical passes.
