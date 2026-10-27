# Performance integration physical QA

Trackers: [#505](https://github.com/raiseCatError/notMyShell/issues/505), [#507](https://github.com/raiseCatError/notMyShell/issues/507), [#509](https://github.com/raiseCatError/notMyShell/issues/509). Automated PTY and CI results are recorded in the [integration report](../performance/2026-10-26-integration.md).

| Required host | Physical status |
|---|---|
| Ghostty | **NOT RUN** |
| Zed terminal | **NOT RUN** |

Record the exact tested commit/build, OS, terminal version, shell/version, pane dimensions and result for each case. Automated tests, native programs in test PTYs and screenshots from a harness do not fill this table.

## Setup

Use a clean checkout of the tested dev build and a disposable working directory on T7. Record `node dist/index.js --version`; use that same built entry for every launch, session listing and attach. Use an isolated NMSh configuration/runtime and carry the same runtime environment into each attachment terminal. Keep provider/account files and shell configuration unchanged. Existing sessions must remain alive; create separate QA sessions instead of ending them to load new service code.

## Cases

Repeat in Ghostty and Zed, with zsh and the relevant Bash 4.4+/Fish backends, narrow/wide panes, Safe glyphs/NO_COLOR where relevant and tmux when used. All cases below remain **NOT RUN**.

1. **Output and draft:** emit a long numbered stream containing cafe accents, CJK and combining characters. Type and edit a long Unicode draft while output continues. The draft stays intact, output bytes/order stay complete, and submitting the draft executes it once.
2. **Scroll, selection and copy:** Page Up while output continues, drag/select visible Unicode rows, release and inspect the clipboard in a plain text editor. Copied content must match the displayed selection without NMSh ANSI chrome. Return to FOLLOW and resize; viewport and pointer targets must agree with what is displayed.
3. **Wrapped editing:** use long wrapped and multiline commands with CJK, combining accents, emoji and paste atoms. Check Up/Down navigation, paired edits, Shift+Enter/Ctrl+J, Option+Backspace and resizing. Source characters and selection/caret boundaries remain correct.
4. **Fullscreen reattach:** start `seq 1 200 | less`, `seq 1 200 | less -X` and `vim -u NONE -N` in separate QA sessions. Close only the NMSh frontend window, leaving its service/session alive. From another terminal with the same isolated runtime, use `node dist/index.js --sessions`, then `node dist/index.js --attach <session-id>`. Repeat with changed and identical pane sizes. The actual program must repaint to the final pane geometry after handoff; no pager key should be needed merely to repair the screen.
5. **Rapid resizing and return:** resize smaller/larger repeatedly in less/vim. Verify final rows/columns (vim `:set lines? columns?` is useful), continue using the application, then quit normally. The composer returns cleanly and the next command runs in the same persistent shell state. Repeat cancellation/Ctrl+C and, where relevant, Ctrl+Z/job resume; input must belong to the current reader.
6. **Restoration:** restore a long saved transcript, scroll/search/select/copy, type a draft and resize. Archive record order/content remains intact, input stays responsive, and old transcript output never becomes a shell submission.

## Recording results

For each case, record PASS/FAIL, host/shell/build, exact action sequence, expected versus observed behavior and captures where useful. Do not mark an issue Done or close it based on automated checks. Leave failures reproducible on current dev; do not rewrite history or kill unrelated sessions. Existing same-size repaint fallback and older service lifetime remain relevant limitations.
