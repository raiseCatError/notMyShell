# v0.8 command intelligence and navigation

Development scope for [milestone #8](https://github.com/raiseCatError/notMyShell/milestone/8). This is an unmerged review stack, not a release record. Package version remains 0.7.0. Physical terminal validation is pending; use the [single QA checklist](../qa/v0.8.0-physical-qa.md).

## Authority and dependency order

The terminal host renders NMSh, which sends explicitly submitted input through SessionClient / nmshd / PTY to persistent real zsh. Completion, history, selection and correction operate in the frontend. Suggestions insert editor text; the user executes it separately. Raw PTY output, `/copy`, session restore and passthrough retain their existing ownership.

The stack starts at dev `2d0e8f904896af2947d109a42df85b097b8ebc9a`, fetched and checked against GitHub before development. Merge order is #193 → #233 → #234 → #235 → #236 → #237 → #238 → #239 → #240 → acceptance documentation. Each dependent PR targets the preceding branch. Nothing has been merged, tagged or released.

| Issue | Implemented development scope |
| --- | --- |
| #140 | Source-independent completion candidates and cancellable native capture |
| #141 | Descriptions, inline categories/groups, icons, fuzzy filtering, keyboard selection and ScreenPlan placement |
| #142 | External-source research delivered on the issue; no new external completion provider |
| #143 | Shell-approved command metadata, structured search, background journal projection and local deletion |
| #144 | Explicit optional local Atuin provider; Native default |
| #145 | Shared supplied-candidate picker boundary, Native/fzf/Television adapters and controlled host-terminal handoff |
| #147 | `/dirs`, palette action, native frecency and optional zoxide snapshot queries |
| #152 | Conservative command-not-found executable corrections that edit only |

All eight issues remain open. #155 is a prerequisite investigation rather than added milestone scope. Its existing #193 branch was updated by merging current dev, preserving published history. Broader startup/socket/storage optimization remains open.

## Completion

`CompletionCandidate` carries insertion and display values, description, kind, source, optional group, UTF-16 replacement range and buffer/cwd context. `CompletionSource` supplies this model without UI dependencies; later inspector work can consume the same metadata without being implemented here.

`NativeCompletionSource` retains the existing isolated native zsh capture helper. Tab is never forwarded into the persistent session PTY, and composer input is never submitted for execution to discover completions. Capture has a 1.5-second timeout and 1 MiB output cap. Parent contexts, including nested path prefixes, are cached for two seconds with 32 entries. Local subsequence filtering ranks exact/prefix matches first.

CompletionService aborts superseded requests; the app checks generation, buffer, cwd and UI eligibility before accepting results. Rows clear immediately when context changes. Acceptance also checks context before Tab, covering multiple decoded keys before the next render. Arrow keys navigate, Tab inserts and Escape dismisses.

Completion rows reuse shared actions, glyph selection and Chroma roles. Categories/groups are inline rather than separate nonselectable rows, preserving selection indices and layout geometry. ScreenPlan owns the suggestion region in Bottom, Top and Flow; narrow rows prioritize the label. Native source kinds are inferred from available values and suffixes, not a full CLI schema.

Quoted/escaped token replacement retains the earlier whitespace-boundary limitation. Configured-zsh completion parity and fzf-tab remain parked in #52. The existing native completion functions are retained; no third-party generator runtime is added.

## History and privacy

`/history` searches commands; `/resume` still searches sessions. Search combines plain text with `cwd:`, `project:`, `exit:`, `before:`, `after:`, `session:` and `duration:`. Quotes support spaces in filter values. Invalid known filters match nothing. Enter/Tab restores a result, and a separate Enter executes it.

New journal records add optional eligibility, start time and duration to the existing schema version 1. zsh preexec reports leading-space and unexported HISTORY_IGNORE eligibility through the authenticated marker, IPC, backlog and replay paths. Native indexing requires affirmative eligibility; older unknown records stay out. Transcripts remain intact independently of command-history policy. Project/cwd/exit/session/time/duration appear only when available.

HistoryService imports the existing exported HISTFILE or `~/.zsh_history`, parses multiline/metafied zsh data in batches, and reads session journals in a worker. The worker projects eligible command metadata without returning raw output. The index derives from authoritative sources; there is no second persisted command database. Queries yield every 2,048 records and return at most 100 composer results (500 through the index API). Import hashing/indexing yields every 1,024 records. App cancellation prevents stale query rows or deletion of a stale selected result.

Ctrl+X removes the selected record from NMSh search. Independent empty tombstone files named by SHA-256 IDs live in private `history-deletions.json.d`; concurrent frontends cannot replace each other's IDs. Earlier stack `history-deletions.json` version-1 IDs remain readable and union with tombstones. Corrupt/unreadable deletion metadata fails closed. Original journals and zsh/Atuin history are unchanged. Deletion applies to a record identity: another source or occurrence of the same command can remain. Other already-running frontends observe persisted deletions when they reload.

Native is the persisted default. Atuin runs only when selected and reads its local list using a bounded formatted CLI call, cached until history reload. Detection/status and fallback use the shared provider gallery. No recording, deletion or sync operation is invoked. Existing user hooks retain their behavior. Atuin's formatted durations are approximate; absent metadata stays unknown. Reading Atuin does not double-record, although imported and journal representations of one command can both appear.

No mandatory SQLite import or native binding is added. The supported Node floor includes releases before built-in SQLite availability/flag removal, and its synchronous API alone would not solve UI responsiveness. Current measured bounded queries support the derived-index approach; revisit storage/isolation if measurements warrant it. See [benchmarks](../performance-benchmarks.md).

## Pickers and navigation

Picker candidates contain an opaque ID, label, description and internal value. Native delegates to the existing composer search surface. fzf and Television receive flattened inert ordinal rows and return one exact known row. Unknown, transformed, oversized or multiple selections fail safely. The adapter never trusts returned text as a command.

The app hands off the host terminal only while idle, detaches its input listener, releases raw mode and renderer ownership, then restores them in `finally`. The managed shell PTY receives no picker input. Accept, cancel and error restore input/renderer state; resize aborts selection and preserves the draft. Missing/failing providers use Native. Config offers explicit persisted Native/fzf/Television choices without installation.

fzf default-command/options environment overrides are removed. Television receives temporary config, empty cable, isolated data/cache directories, zero query-history size, no preview and no remote channels. Adapter input is capped at 100k rows / 16 MiB, output at 64 KiB, interaction at five minutes. External tools own their appearance during handoff. Installed fzf transport was tested noninteractively; Television was absent locally and has contract tests, with real-tool QA pending. History supplies at most the newest 100 matching records; Native structured search remains the route across the full history. Bare `/history`, `/dirs` and palette actions open the configured picker; typed query forms keep Native incremental composer search.

`/dirs` ranks approved history cwd records by frequency and seven-day recency decay, with fuzzy filtering and a snapshot cache. Its palette entry comes from the shared slash-action registry. Selection inserts a literal quoted `cd -- 'path'`; only subsequent Enter sends it through normal shell submission and transcript capture. Plain `cd` is not intercepted. Stale/missing directory paths can fail visibly in zsh; no hidden chdir changes shell state.

Optional zoxide queries use the user's existing data location. Upstream query sorts/saves even with `--all`, so NMSh copies the bounded db.zo into a private temporary directory and queries only that copy. The original database/hooks remain unchanged. Queries are detached, time/output bounded and cached for 30 seconds; absent, incompatible or failing sources fall back to Native. A real installed zoxide fixture test verifies source-byte preservation. Directory-specific frecency ghost text is deferred; existing native `cd` argument completion remains available.

## Corrections

Exit 127 alone is insufficient. A simple unquoted command must have a matching command-not-found diagnostic and exactly one nearby executable in bounded cached absolute frontend PATH directories. One insertion/deletion/transposition is allowed; substitution is allowed only for longer words. Nearby alternatives suppress rather than lower confidence. Known executables returning 127, complex expressions, assignments, quoted/multiline/private input, dangerous targets and short ambiguous input are suppressed.

Tab edits the empty composer, Escape dismisses, and Enter never accepts/executes the suggestion automatically. Typing cancels background discovery, including ABA buffer changes. The row is transient frontend presentation in ScreenPlan, so it cannot enter `/copy`, transcripts or history. Narrow width, Safe glyph and NO_COLOR paths are tested.

Live-shell PATH mutations, live aliases/functions, history-based guesses and subcommand/flag correction are deferred. The current snapshots and native capture metadata do not establish sufficient authority for those cases. No subprocess is invoked to inspect an unknown command or discover a correction.

## External completion research and deferred scope

Evidence and primary links are recorded on [#142](https://github.com/raiseCatError/notMyShell/issues/142#issuecomment-5919411096); local Atuin findings are on [#144](https://github.com/raiseCatError/notMyShell/issues/144#issuecomment-5919625509).

Carapace's JSON export includes value/display/description/tag data and is a promising future transport. Its callbacks, bridges and configurations can execute code; a universal static-only safe mode was not established. It was absent locally, so no latency number is claimed. Fig-compatible TypeScript specs are useful formats but module imports/generators are executable; licensing requires per-spec/dependency auditing. Inshellisense exposes structured completion and useful parsing/cache patterns, but its generator execution, terminal architecture and currently declared Node range do not fit direct embedding. No code was copied and no provider follow-up issue was created.

Future external completion must default to inert audited data, with generators disabled until an explicit bounded execution model is defined. Current timeout/output limits are not a sandbox for arbitrary generators.

All explicitly parked work remains outside this stack, including #52, inspector #84, installer #9, wider terminal compatibility and #208 TMPDIR hygiene. Unrelated PRs #181, #182, #183, #226 and #227 are untouched. No new issues were created.

## Verification and acceptance

Each code layer ran build, typecheck, full tests and diff checks; focused regressions cover keyboard selection, cancellation, narrow/Safe/no-color presentation, journal/IPC privacy, real-zsh hooks, large histories and terminal handoff. Final cumulative local suite: 714 passed. Benchmark script types pass. Existing regression coverage exercises sessions, startup restore, Flow/Chat, passthrough, raw output and copy; this is automated coverage, not physical QA.

The navigation CI's first Node-22 run failed during existing GNU screen sandbox cleanup with ENOTEMPTY, cancelling Node 26. Investigation and the unchanged-head rerun are recorded on #238; both Node versions passed the rerun. A status viewport test assumption and runtime no-color correction help were corrected after recorded failures. An RTK-filtered final command returned an empty log with exit 1; raw proxy verification passed all 714 tests. The final code and acceptance heads receive workflow_dispatch because stacked targets do not automatically trigger the dev PR workflow.

Review dependencies in order, integrate only after review and CI gates, then perform the deduplicated physical checklist. Keep milestone issues open until release, including after integration and physical QA. Version/release preparation follows physical QA under separate authorization.
