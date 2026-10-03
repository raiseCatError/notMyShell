# Optional shell tools

`/tools`, Settings → Tools and the command palette open one terminal-native
browser. Discover searches the offline curated catalog by name, description or
category. Within categories missing tools precede installed tools. Installed
contains detected executables; Configure contains only real supported adapters;
Errors contains retained installation failures or missing selected providers.
No marketplace, update feed, network discovery or required external tool exists.

Up/Down selects, Left/Right changes tabs, typing searches, Enter opens details,
Esc returns/clears/closes. Details show executable/version evidence, category,
source and install package. `I` previews installation when missing, `C` opens a
supported configuration adapter, `P` opens the existing provider chooser, and
`R` explicitly refreshes detection. Toolchain detail labels consume offline
Linguist through Chroma identity colors; status text remains separate.

Detection uses the existing cached provider resolver and bounded version probes,
in batches of three on opening/refresh. Rendering never launches a probe or
fetches network data. Installed means an executable is present, not that a daemon,
credential, zsh hook or environment is healthy. Configured means an installed
tool is selected in NMSh settings, not that its shell hooks are active. Hook
inspection/setup is deferred and never inferred. Direct shell tools work normally.

Conservative Recommended tools: zoxide, fzf, ripgrep, fd and jq. Other entries are
optional/specialized. First-run discovery follows glyph/prompt setup, defaults
to Skip, and offers Recommended or Choose individually. Both choices only browse;
Recommended filters Discover. No bulk installation or shell-hook modification.
Legacy completed onboarding remains complete. The additive `toolsSetupComplete`
boolean uses the existing normalizer/atomic NMSh preference writer.

Installation recipes are fixed Homebrew package argv, offered only when brew is
available. Unsupported package managers get official-source guidance without
execution; no sudo, shell interpolation, install scripts or custom taps. Each
install shows the command and software-change scope, starts on No, and requires
a fresh explicit confirmation. Shared TaskProgress reports actual completion
and failures, with bounded captured diagnostics, detached process ownership and
timeout/disposal cleanup. Installation never configures hooks/providers; after
success availability is rechecked. No tools were installed during development.

The shared configuration panel implements Starship module toggles only, with
supported-value previews, explicit apply, backup and atomic unknown-preserving
writes. Native fallback works with all tools missing. Tool failures are retained
only within the open browser; persistence across browser reopen, bulk selection,
hook activation detection/setup and additional package managers remain deferred.

NO_COLOR retains text state cues, Safe glyph mode retains keyboard operation,
and progress respects reduced motion. Extremely small widths necessarily clip
descriptive/help rows; use a wider terminal to review installation/configuration.
No mouse interaction is required.
