# Context Rail — physical Ghostty QA

**Latest user report: physical QA PASSED after the transcript/shell UX refinement.**
The later Hidden/Side correction is covered by automated regression tests; no
post-fix physical test is claimed. Earlier pending notes below record historical
handoffs and are superseded by this user report for the tested refinement.

**Status: refinement RETEST PENDING.** The user physically confirmed the
original live Bottom Rail now renders correctly. The new spacing, direction,
frame and Right-of-Prompt composition have not been physically verified.
Automated/PTY checks are not physical QA. Desktop permission troubleshooting
has stopped. No media is regenerated.

## Isolated launcher

Use a fresh Ghostty terminal, leaving the showreel terminal alone:

```sh
/bin/zsh -f /private/tmp/nmsh-context-ghostty-qa/launch-terminal.zsh
```

Dedicated state: `/private/tmp/nmsh-context-ghostty-qa`, private HOME/config/runtime
and workspace `workspace/NMSh-Context-Rail-QA`. Git branch `rail-qa` has a dirty
README and package.json, pyproject.toml, Dockerfile markers. Git/toolchain modules
are explicitly routed to Rail; project stays Main, shell stays Right Context.
Synthetic command contexts are QA-KUBE / QA-DOCKER. Initial preset is Bottom,
Auto, one row, Outside, Gap; saved theme/style are retained. These fixture
choices do not change product defaults or personal config.

Ctrl+D on an empty NMSh input returns to the **QA host**. Run each preset there,
not inside NMSh. Each starts a fresh transcript:

```sh
qa-visual POSITION ROWS RELATION SPACING INTEGRATION ANCHOR DIRECTION [LAYOUT] [SHELL]
# POSITION bottom|top|flow; ROWS 1|2; RELATION vertical|right
# SPACING attached|gap|spacious; INTEGRATION outside|inside|auto
# ANCHOR prompt|rail|above; DIRECTION forward|mirrored|followMain
# LAYOUT twoLine (default)|oneLine; SHELL zsh (default)|bash|fish
```

Visual presets explicitly choose Main's composer-level divider layout in this
owned fixture so horizontal Inside integration can be tested. Changing Rail settings in the
product never mutates Main configuration. `/prompt` can inspect/save individual
controls; compare Current with live, and Showcase with the same visual settings.

## Corrected no-box visual matrix

Fresh launch selects `qa-default`: Auto / one content row / Vertical / Gap /
Outside / Follow Main direction. Existing theme/style choices in this isolated
fixture are retained. With Git context visible, Auto shows the Rail immediately.

Run these commands at the QA host after Ctrl+D. All cases remain physical
RETEST PENDING; automated tests do not establish a visual pass.

| QA-host preset | Expected |
|---|---|
| `qa-default` | Rail above Main with one blank gap, outside normal Main horizontal rules |
| `qa-visual bottom 1 vertical gap inside prompt forward` | Rail inside shared horizontal boundaries; Main owns its inline divider |
| `qa-visual bottom 1 vertical gap inside rail forward` | Rail owns the aligned horizontal boundary/fill |
| `qa-visual bottom 1 vertical gap inside above forward` | Standalone upper horizontal line above Rail + gap + Main/input |
| `qa-visual bottom 1 right gap outside prompt forward` | Rail separate to right; Main boundary stops before Rail; shell remains far right |
| `qa-visual bottom 2 right gap inside above mirrored` | Two stacked Rail rows inside full-width horizontal rules; readable mirrored segments; separate shell |
| `qa-conversion` | Starts Main in two-line Header and Rail Outside; use conversion steps below |

**No case should show left/right vertical borders, box corners or frame gutters.**
Right spacing reserves minimum 0/1/4-cell separation; remaining slack preserves
Right Context. Forced Right never moves vertical. At very narrow width the input
wins, then priority context; nothing overlaps or obscures the cursor.

Conversion check: in `qa-conversion`, open `/prompt`, choose Context Rail,
Integration → Inside. Expect `Requires Main Prompt: Inside` and a proposed
horizontal-only Current preview. Main/live configuration stays unchanged while
arrowing. Enter to Save opens Change & Save / Cancel / Keep Current, initially
Cancel. Cancel/Esc must keep saved Main Header and Rail Outside. Return and
confirm Change & Save: Main becomes two-line Inside with composer dividers On,
Rail Inside saves too. Reopen `/prompt` and compare Current with live.
Already-Inside Main should save Rail Inside without this extra confirmation.

Also try `qa-visual bottom 2 vertical spacious inside above mirrored`,
`qa-visual top 2 vertical spacious inside above forward`, and
`qa-visual flow 2 vertical spacious inside above forward` for two-row gaps,
Top placement and empty/short/growing Flow. Boundaries are horizontal only.

## Behavior, resize and compatibility

- On each relevant row, resize to roughly 40 then 20 cells and widen. Lower
  priority Rail content compacts/drops; no editor/shell overlap, stale border,
  stale Rail cell or arbitrary extra wrap. With Inside enabled, type a long command and
  Shift+Enter: wrapped text, cursor and vertical movement stay within their measured editor budget.
- Flow preset: observe empty input, then submit `printf 'QA-line\n'`, then
  `seq 1 80 | sed 's/^/QA-row-/'`. Spacing/outer edge count toward the bounded
  empty/short shift; once enough transcript space exists, Rail consumes view
  space above the normal composer anchor. Resize in each stage. Rail stays above.
- Scroll into detached history with Rail visible, resize, return to newest
  output. Historical position stays coherent. Rail/dividers/gaps are absent from
  transcript and `/copy`. No shell PTY resizing merely because input scrolls offscreen.
- To test command-only Auto, restart `qa bottom 1 auto zsh`, then type
  `kubectl get pods` or `docker ps` without submitting; context appears. Ctrl+U
  removes it and all associated spacing. Repeat `qa flow 2 auto zsh` and
  `qa top 1 auto zsh`. Always reserves configured content rows even empty;
  Off reserves nothing. Use `/prompt` to repeat Auto with new visual controls.
- With context visible, run `seq 1 200 | /usr/bin/less`, then `q`, or
  `/usr/bin/vim -Nu NONE -n` and `:q!`. Fullscreen/raw owns the screen and returns
  to correct chrome/cursor without stale borders.
- Try `/btw what shell am i using` and `/ask what shell am i using`: both open
  the same Ask NMSh surface. Completion/help/guide advertise `/btw`; `/ask`
  remains compatible. Existing conversation layout/actions should be unchanged.
- In `/prompt`, change Main theme: Follow Main follows; Choose theme preserves
  Rail's chosen palette. Try Soft/Minimal/Compact and compare Current/live.
  Main and Right placements stay independent.
- If installed, append `twoLine bash` / `twoLine fish` to visual presets.
  `qa bottom 1 auto zsh safe no-color` tests safe glyphs/NO_COLOR; use `/prompt`
  Inside + Above Group to check horizontal safe dividers too. Raw command output
  keeps its own presentation.

Report actual PASS/FAIL with preset, width, action and unexpected result; mark
skipped cases explicitly. Wider physical QA and the new visual matrix remain
PENDING until observations arrive.


## Transcript and shell UX refinement — fresh physical retest

Status: **PASSED**, reported by the user. The steps below remain the reproducible
checklist. Keep the showreel window/worktree untouched. Start a new
Ghostty terminal at roughly 100 columns × 30 rows with the same isolated launcher:

```sh
/bin/zsh -f /private/tmp/nmsh-context-ghostty-qa/launch-terminal.zsh
```

The launcher already runs this checkout's source; no launcher change is needed.
It initializes current/default zsh, shell indicator Always/Right, and project
Rail routing. It retains the fixture's saved theme/style and transcript choice.
Set Normal explicitly at the beginning if an earlier run saved Chat. The QA host
presets reset the fixture's default shell and indicator to zsh and Always/Right;
check default changes **within NMSh before returning to the host**.

1. Submit `printf 'UX transcript line\n'`. Open `/transcript`: first section
   **Live presentation**, first selected row **Presentation**. Use ←/→ to
   choose Normal, Enter to save if needed. Reopen, choose Chat and Enter. Earlier
   submitted commands should align right at this width; output stays readable.
   Reopen, choose Normal and Enter: commands return to Normal. Historical prompt,
   colors, dividers and folding remain separately editable under **History**.
   Also draft Chat and press Esc: Normal must remain saved.
2. Repeat Chat from `/transcript`, then open `/layout`. Its Transcript row must
   read Chat. Select that row with ↓, choose Normal with ←/→, Enter to save.
   Reopen `/transcript`: Normal. `/layout` still previews Composer position ×
   Transcript presentation; it retains its richer combined preview.
3. Open `/settings`, choose **Layout**. Its Transcript control must match.
   Choose Chat there and save with Enter; reopen `/transcript` and `/layout`:
   both show Chat. Return to Normal from `/transcript`. Compare the preview with
   live history at 100 columns, then shrink to 40: Chat falls back to stacked
   Normal rows at narrow widths. Save/cancel help remains visible at 30 rows.
4. Open `/shell`. zsh must show exactly one ✓, a restrained background band,
   `[current]`, and bold `[default]`. The selection arrow is independent.
5. Press ↓ to select Fish, then Bash. zsh's ✓ and band must persist. Return to
   zsh: selection weight/arrow and current band compose cleanly. Esc closes.
6. Reopen `/shell`. From the selected zsh row, press ↓ three times to reach
   **Visibility**. Use ←/→ until **Hidden**. Changes save immediately. Esc:
   no prompt shell label. Reopen: Hidden is retained.
7. Choose **When not default** in the same row. With current/default zsh, Esc:
   no shell label. `/shell bash` switches the current session: bash appears.
   `/shell zsh`: label disappears. Missing/unavailable backends are SKIPPED;
   this checklist does not require installing them.
8. In `/shell`, choose **Always**. Esc: zsh appears even when it is default.
9. In `/shell`, move from Visibility down once to **Side** and choose **Left**.
   Esc: shell joins Main Prompt. Open `/prompt`, Main Prompt → Modules: Current
   shell must be Left. Save a side change there using P and Save; reopen `/shell`
   and verify it reflects that side. Merely previewing/canceling `/prompt` must
   not change the saved Shell control.
10. Set Side **Right** in `/shell`. Esc: shell returns to the independent right
    anchor. `/prompt` → Modules must reflect Right. The Rail has its own Relation
    and must not be used as the indicator's side control.
11. With Always, run `/shell bash`, `/shell fish`, `/shell zsh` in order. Each
    switch gets a fresh view and the new shell label; inspect `/shell` each time
    for the tick/current row. Existing cwd, `/resume` archival, and shell-local
    state boundaries should behave as before. Do not expect aliases/variables
    from the old shell to carry over.
12. Set Visibility **When not default** and run `/shell fish`. In `/shell`, select
    Fish and press D: default becomes Fish, current stays Fish, indicator hides
    after Esc. Select zsh and press D: default becomes zsh, current stays Fish,
    indicator shows fish. `/shell zsh`: indicator hides. `[current]` and
    `[default]` move independently when current differs from default.
13. Ctrl+D on empty input returns to **QA host**. Run:
    `qa-visual bottom 2 right gap inside above mirrored twoLine zsh`.
    The fixture starts Always/Right. Right Rail and shell must coexist, with
    shell at the far right; horizontal dividers only, no vertical borders or
    box corners. Resize through 100/60/40/20 columns and widen: Rail compacts or
    drops before painting over shell/editor. Repeat Side Left then Right in
    `/shell`, comparing `/prompt` Current preview with live.
14. Ctrl+D to the QA host, then run:
    `qa bottom 1 always zsh safe no-color project right gap inside above followMain twoLine composer`.
    In `/shell`, move selection away from current: ✓, reverse-video current band,
    `[current]`, bold `[default]` and the selection pointer remain understandable
    without color. Repeat Hidden / When not default / Always and Left / Right.
    Return to host with Ctrl+D and use `qa-default` to restore color.

Finally type `/btw` and inspect completion/help/Guide; `/btw` is advertised.
Try `/btw what shell am i using` and `/ask what shell am i using`: both open
**Ask NMSh** over the same state. Report PASS/FAIL with preset, width, action and
observed result; explicitly mark unavailable shells or untested steps SKIPPED.
