# Configured completion bridge

v0.11 extends the existing CompletionSource and CompletionService. A lazy helper
loads the same trusted home zsh startup files as the managed shell, once per
helper generation. It runs detached, with its own hidden zpty; its terminal bytes
never reach the frontend. A private widget receives BUFFER/CURSOR from private
files and invokes `_main_complete` directly, bypassing foreign Tab widgets.
Only bounded NUL-delimited compadd data is returned. NMSh quotes, renders and
inserts candidates; completion never submits a command to the managed shell.

The helper is reused, expires after 60 seconds, and restarts on cwd changes,
explicit invalidation, cancellation, timeout or failure. Startup is bounded to
1500 ms; warm requests to 300 ms; output to 1 MiB and 4096 candidates. Unsupported
replacement contexts and failed helpers fall back to the existing native source.
Typing remains asynchronous. Cursor, cwd, buffer and service generation identify
requests. No history is written. Configuration is trusted executable code, not a
sandbox; helper isolation protects terminal ownership and managed-shell state.
Config may still have external side effects. No new frontend config evaluation
or runtime dependency is introduced.

Failures enter a five-second configured-provider cooldown. Superseding input
requests share bounded startup and serialize queries; canceled requests cannot
return candidates. A warm-query cancellation ends the helper, while a canceled
startup request leaves the shared initialization available to the newest input.
Explicit disposal ends initialization. Each completed managed-shell
command invalidates the helper. Live definitions added only to the managed shell
are not automatically replicated into the helper in this first bridge version.
Unsupported nested syntax, multiline and control-bearing input falls back;
middle-of-buffer native fallback is suppressed because the legacy helper has
no safe replacement protocol there. Configured candidate expiry is checked
before insertion. The frontend never blocks waiting for the helper.

Protocol semantics follow the upstream [completion widget documentation](https://zsh.sourceforge.io/Doc/Release/Completion-Widgets.html)
and [zpty lifecycle documentation](https://zsh.sourceforge.io/Doc/Release/Zsh-Modules.html#The-zsh_002fzpty-Module).

Descriptions, groups and compadd prefix/suffix data are mapped into existing
candidates. Callback-based suffix removal and arbitrary ZLE state changes are
outside v1. Native fzf-tab is unsupported. The existing optional fzf picker may
select structured candidates through its normal terminal handoff.

Implementation plan: first deterministic bridge/parser and lifecycle fixtures;
then bounded persistent transport; then composer cursor/invalidation integration
and picker selection; finally failure, quoting, Unicode, performance and cumulative
verification. Use the current checkout and one primary implementer. Physical QA
is additive and deferred. Version stays 0.7.0; PR targets #266 and stays unmerged.
