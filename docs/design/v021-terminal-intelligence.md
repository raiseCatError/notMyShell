# v0.21 — native viewing, terminal intelligence and workflow polish

Design and acceptance for the v0.21 candidate ([#410](https://github.com/raiseCatError/notMyShell/issues/410)). It
reconciles the candidate issues against the code on `dev` at `6af5cbab` (identical to `master`, after v0.20.0 at
`65e4de55`), names what each slice reuses and owns, and lists the tests that prove it. Progress, commits and open risks
are recorded in the [v0.21 ledger](../development/v021-ledger.md); this document changes only when a decision does.

v0.21 makes the existing terminal better. NMSh stays a frontend over a real shell and PTY: the shell parses and runs
commands, programs own their bytes, and NMSh owns the composer and its own presentation. Nothing here is a shell
course, an IDE, a multiplexer or an agent harness. Learn Mode (#398) is deferred and unscheduled.

## Invariants every slice keeps

- **One input owner at a time.** A panel, viewer or editor owns keys only while it is open; a running program's
  foreground read, passthrough and the queue keep their current rules. Nothing new types into the shell.
- **Raw output is authoritative.** Derived views (overviews, track snapshots, viewer rendering) are presentation and
  are never written into the stored transcript lines, the journal's raw events, `/copy`'s raw payload or the shell.
- **One geometry plan.** New chrome is planned by `src/app/screenPlan.ts` or drawn as a full panel through the existing
  panel slot; no subsystem computes its own rows.
- **Hostile text is inert.** File contents, command output and provider results are data: control and format
  characters are escaped or removed before display (`displaySafe`, `stripTerminalControls`), links are only the
  existing allowed forms, and nothing is executed because it was opened or recognized.
- **Bounded.** Every new read, buffer, cache, timer and process has a stated limit sized for an 8 GB Mac.
- **Honest degradation.** Unsupported input says so and keeps the existing behavior; nothing is guessed.

## Slices

Order follows dependencies: reliability first (later slices run more tests over the same paths), then the viewer
(the editor and Semantic Output reuse its document model), then `/track`, modules, themes and controls.

### 1. Reliability gates

**#403 Fish teardown race.** Cause confirmed: an interactive Fish whose generated-completions directory is missing
starts `fish_update_completions` detached (Fish 4.x checks `$__fish_cache_dir/generated_completions`, Fish 3.x
`$__fish_user_data_dir/generated_completions`); the orphaned Python process keeps writing about 1,400 files into the
test home after the shell exits, racing `rmSync`. Production is unaffected: NMSh runs Fish with the person's own
directories, where this one-time generation is Fish's normal behavior. The harness, however, did not isolate
`XDG_DATA_HOME`/`XDG_CACHE_HOME`, so test shells also wrote into ambient caches (observed under `t7run`).
Fix: every test home is hermetic for data, cache and state, and Fish's "already generated" directories exist in it
(`tests/helpers/shellHome.ts`), applied by the canonical runner, `LiveSandbox` and the adapter fixtures. Test: a Fish
started in a prepared home spawns no generator; the lifecycle tests remove their homes without retries.

**#408 queued highlight.** Cause confirmed in production code, not only the test: every prompt marker's shell
knowledge clears `SemanticService`'s cache and resolves in-flight classifications as `unknown`, so a stored command
whose lookup was in flight when the next prompt arrived (a fast queue) keeps the unclassified color permanently.
Fix: a lookup superseded by newer knowledge is asked again against that knowledge (bounded), and a stale answer is
still never cached. The test waits for the shell's startup knowledge and for the classification promises it started
instead of one `setImmediate`. Tests: superseded lookup resolves from the new knowledge; queued and composer paths end
with the same colors; repeated runs are stable.

**#388 multi-line progress redraws.** `AnsiOutputParser` implements `\r`, `CSI K/G/C/D` and full clears, but ignores
row movement, so every frame of a multi-row progress display (`CSI A` + `CSI 2K` + text + `\n`) becomes new permanent
lines. Fix: a bounded **live region**: the cursor may move up and down only within the running program's own rows,
never above the most recent NMSh-authored line or the command's start, and never more than the PTY's screen height
(a terminal cannot address scrollback either). Supported: `CSI A/B/E/F` (cursor up/down/next/previous line),
`ESC M`, `ESC D`, `ESC E`, save/restore (`ESC 7/8`, `CSI s/u`), `CSI J` 0/1 within the region, `CSI K` 0/1/2.
Absolute row addressing (`CSI H/f/d` with a row) is not mapped: inline programs cannot know where their rows are, so
it keeps today's behavior (appends), documented. Copy and search see what the terminal would show at the end; the
intermediate frames are not kept, as a terminal's scrollback does not keep them. Raw events in the session spool are
unchanged and replay through the same parser. Tests: single and multi-row redraws, interleaved stdout, split
sequences, clamping at the fence, NMSh lines inserted mid-redraw, metadata never edited, a real-PTY run of the
fixture from #388, and a bounded-time run of 10k frames.

### 2. Native `/view` (#397, viewer phase of #402)

A read-only full-height panel over one **document**: lines of text plus where they came from.

- Sources: `/view <path>`, `/view N` (completed output N, numbered as `/copy` numbers them), and **View output** in
  block Actions. Output documents read the record's stored text; no second capture, no shell involvement.
- Files: `lstat` then `open(O_RDONLY | O_NONBLOCK)` and `fstat` on the descriptor; only regular files are read
  (FIFOs, devices and directories are refused with the reason). At most 8 MiB is read; longer files show the first
  part with an explicit truncation line. NUL bytes or a high control-character ratio in the first 8 KiB mean binary
  and are refused. Invalid UTF-8 is shown with replacement characters and a note. Symlinks are followed (as `less`
  does) and the header names the target. Reading is asynchronous and cancellable; nothing is written.
- Modes: **Text** (line numbers, wrap or horizontal scroll), **Markdown** (the existing `src/markdown` renderer for
  `.md`/`.markdown` files only; output is never implicitly Markdown; `m` toggles Rendered/Source), **Diff** (unified
  diff roles for `.diff`/`.patch` and output whose command is `git diff`/`git show`/`diff -u`), and syntax roles for
  source files through the existing `highlightCode` when the extension is known.
- Navigation: arrows, PageUp/PageDown, Home/End, `g`/`G`, `:` go to line, `/` search with `n`/`N`, `w` wrap,
  `l` line numbers, `c` copy the whole document's text (raw source), `Esc`/`q` close. Mouse wheel scrolls.
- Safety: every displayed line goes through `displaySafe`; Markdown links stay text unless the target passes
  `authoredTargetAllowed`; nothing is executed, fetched or followed. Large files keep only the decoded lines in
  memory (bounded by the read cap).

The existing **Open in pager** action stays for people who prefer `less`; `/view` does not replace `less`, `bat` or
Glow, and running those commands is unchanged.

### 3. Small native editor (`/edit`, editor phase of #402)

Opt-in convenience for small text files, built on the viewer's document model and file checks.

- Opens regular UTF-8 text files up to 1 MiB that the person owns, with one hard link; others open read-only in
  `/view` with the reason. Line endings (LF/CRLF), a BOM and the final newline are preserved.
- Editing: insert/delete, multi-line, caret movement by character/word/line/page, Shift selection, cut/copy/paste
  through NMSh's clipboard, undo/redo (bounded history), search, and a dirty marker.
- Save (`Ctrl+S`): write a temporary file in the same directory (exclusive create, original mode), `fsync`, then
  check the original is still the file loaded (device, inode, size, mtime and content hash) and `rename` over the
  resolved real path. A changed or replaced original is a conflict: **Overwrite**, **Keep editing** or **Discard
  mine**, nothing silent. Errors (permission, full disk, read-only filesystem) are reported in the editor and the
  buffer is kept. Extended attributes and ACLs are not carried over by the rename; documented.
- `Esc` with unsaved changes asks; the composer draft and shell are untouched throughout. Not an IDE: no LSP,
  multi-cursor, project tree, plugins or Vim emulation. `vim`, `nano` and other editors run unchanged.

### 4. Semantic Output (#386, first phase)

Deterministic, post-completion, optional. One recognizer table, each entry a pure function from
`(command, stored output, exit code)` to a typed result with a role (`overview` or `detail`), the facts it read and a
completeness flag. First recognizers, chosen for usefulness and testability:

- **Test runs**: Node's test runner/TAP (`# pass`/`# fail`), Jest/Vitest summaries, pytest's final line, `cargo test`
  `test result:` lines, Go's `ok`/`FAIL` package lines. Overview: counts as the runner printed them.
- **Compiler and type-checker diagnostics**: `tsc`, GCC/Clang, `rustc`/`cargo`, Go: overview counts plus a detail list
  of `file:line` locations and messages taken verbatim from the output.

Presentation is derived rows in `TranscriptPresenter` (like fold hints), placed after the command header and before
output; they never enter stored lines. The overview appears only when it adds information (long output, or failures
whose locations are listed), never for short readable output. Raw output keeps its existing fold policy; a failure is
never folded away by a semantic view. A late result never moves rows above the reader: it is computed synchronously at
completion from bounded input (first 2 MiB), so it exists before the block is drawn.
`/copy` gains `--raw` (default and current behavior), `--semantic` (the overview and details as text, raw with a note
when there are none) and `--both` (labeled raw then semantic), mutually exclusive, combinable with existing selectors.
Settings → Transcript → Semantic Output: On (default) / Off. External providers (`jc`, `delta`) are not part of
this phase.

### 5. `/track` (#393, reconciling draft PR #394)

`/track` is the `/watch` scheduler (`src/tasks/WatchTasks.ts`) with PR #394's hardening carried over by hand (strict
cadence parsing, refusing substitutions, background operators and heredocs, bounded UTF-8 capture, timeouts, a stop
grace period, at most eight active trackers, copy of the latest snapshot), plus one **live transcript block**: a
header line stored once, and the latest completed snapshot drawn as derived rows that are replaced in place on every
completed sample. One current and one previous result are kept; nothing accumulates per refresh.

- Samples run as `<shell> -c <text>` in their own process group with the starting directory captured at creation,
  pipes and `NO_COLOR`; they do not see the live shell's aliases, functions or unexported variables, and the block
  says so. No overlap: a refresh while a sample runs is refused with the reason.
- States shown truthfully: first run pending, running, last completed time, exit status, timed out, spawn error,
  stale (no completed sample in two intervals), paused, stopped.
- Ownership: trackers belong to the window, as `/watch` always has. Detaching or closing the window stops them and
  their processes; the block then reads *stopped with this window*. They are not silently restored by reattach. The
  service-owned supervisor (#382) is not duplicated; moving scheduling into the session service is a later step.
- Copy and search: the stored header plus, while live, the derived snapshot rows are searchable; `/copy` of a track
  block and **C** in the panel copy the latest completed snapshot as plain text, never earlier samples. Stopping a
  track writes its final snapshot into the transcript once, so history keeps the last result.
- `/watch` keeps its syntax and safety gate; `/track` and `/watch` manage the same trackers.

### 6. Native modules and diagnostics (#364, #365)

Add the matrix's remaining safe candidates with the existing declarative-file pattern: **Bun** (requested version from
`package.json` `packageManager`/`engines.bun`, `.bun-version`, `.tool-versions`/`mise.toml`; active from the install
path), **Nix shell** (`IN_NIX_SHELL` and `name` from the allowlisted live environment) and **container** (`/.dockerenv`,
`/run/.containerenv`, `container` in the environment). Each gets hostile-workspace fixtures; none runs a tool. Update
the coverage matrix with the date and decisions. For #365, close the remaining diagnostic gaps the issue lists after
auditing what v0.20 shipped: per-module cache lifetime and key scope, a slowest-collectors list, and a plain-text
explain export, reading snapshots only (opening diagnostics never starts collection).

### 7. Theme families (#401) and action controls (#336)

Add Tier 1 families from their canonical upstream palettes with source, revision and license recorded in
`theme-families.md`: Ayu, Kanagawa, Everforest, Flexoki, Night Owl, GitHub Primer, Oxocarbon, and Material
Palenight and a classic Monokai where licensing is verified. Existing ids and stored preferences are unchanged;
Lavender stays the default. Picker grouping and dark/light filtering are added only if the catalog makes the current
list hard to use. Contrast is checked against each variant's own background with the existing contrast helpers.
Confirmations added in this release (editor save conflicts, `/track` confirmation) use the existing
`src/ui/actionControls.ts` renderer; no new widget layer.

## Deferred (not in v0.21)

#398 Learn Mode; #339/#340 managed Codex/OpenCode and remote control; #337/#338 broad worktree and GitHub writes;
#330–#332 workspace expansion; #333 tmux Studio; #334 Setup Cat profiles; #335 keymap remapping; #399 host terminal
configuration; #304 Theme Bridge expansion; #341 executable mods; #296 hosted demo; #389 (no reproduction); #356
(separate Fish typeahead race); #366 external editor provider registry. Semantic Output providers (`jc`, `delta`),
service-owned `/track` scheduling, viewer follow/tail mode and Markdown editing preview are later phases.

## Verification

Focused tests per slice; `npm run verify` before each PR; exact-head CI (macOS and Ubuntu, Node 22 and 26, Fedora)
before merge; `verify:release` and the timing smoke at the integration checkpoint. Physical Ghostty and Terminal.app
checks are listed per slice in the ledger and are not claimed from automated runs.
