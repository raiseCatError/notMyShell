# Workflow physical QA

Tracker: [#359](https://github.com/raiseCatError/notMyShell/issues/359). Automated PTY fixtures do not establish
physical terminal validation. Record the exact branch/commit, OS, shell version and terminal host with each result.
Use an isolated NMSh configuration and a temporary working directory; keep provider/account configs unchanged.

## Input and queue

Use Ghostty and Terminal.app where available, with zsh, Bash 4.4+ and Fish 3.7 or later.

1. Ask for a demo hidden answer using the active shell's command below. Type `FAKE_ONLY`, then Enter. Only
   `ANSWER-ACCEPTED` should appear; the answer must not echo or execute as a shell command.
   - zsh: `read -s 'reply?Demo password: '; [[ $reply == FAKE_ONLY ]] && print ANSWER-ACCEPTED`
   - Bash: `read -rs -p 'Demo password: ' reply; test "$reply" = FAKE_ONLY && echo ANSWER-ACCEPTED`
   - Fish: `read --silent --prompt-str 'Demo password: ' reply; test "$reply" = FAKE_ONLY; and echo ANSWER-ACCEPTED`
2. Repeat after detaching the window while the question is open and explicitly reattaching from `/resume`.
   Input must remain hidden, answer the original reader and return to the composer after completion.
3. Run `sleep 3`, prepare `echo QUEUED` with Ctrl+Q, and inspect `/queue`. The entry runs once, after the original
   command. Repeat with failure and Ctrl+C: the default pauses remaining entries. Ctrl+Z must return control without
   sending a prepared response into a new shell command. Answer a real `read` while another command is queued;
   the response belongs to the reader.
4. Paste native multiline blocks (including a Bash/zsh heredoc and a Fish `begin`/`end` block). Review splitting,
   quoting, substitutions and strings. Pasting, opening review and choosing a recipe must execute nothing. Explicit
   queue confirmation submits the reviewed text in order; variables and cwd remain in the same shell.
5. Set an entry to “asks first”, approve it, then edit it before dispatch. The edit withdraws approval. “Runs even
   after a failure” permits the reviewed follow-up after failure, but does not bypass an interrupt.
6. Open `less` or another alternate-screen program; keys and terminal selection belong to it. Exit and immediately
   type a command. Repeat after Ctrl+C, Ctrl+Z and resize.

## Clipboard, output and reuse

1. `/ps` explicitly reads the clipboard. Review, keep with C, cancel and open `/clips`. Selecting a clip reviews it
   again; insertion and queue approval are separate actions. Closing the frontend discards its clips. On macOS,
   `/clips suggestions on` offers a neutral change hint while idle; `/ps` remains the content read. Disable with
   `/clips suggestions off`. Unsupported platforms should explain that metadata suggestions are unavailable.
2. Pin a selected history command from the palette. Check its recorded cwd, command text and recipe review. A
   stale history selection must not pin a different command. Placeholder values must stay shell-quoted data.
3. Run a failure between successful commands. F8/Shift+F8 navigate actual failed records while idle, preserving
   the draft. Program input and passthrough must retain their keys. Check files, URLs, commits and device references
   through Actions; output-derived choices must not execute automatically.
4. Produce long output, fold it and copy it through the picker, Actions and selection. Copied bytes stay complete
   unless a selection was explicitly chosen; folding alone does not change copy content.
5. Copy as Report: inspect long lines, Markdown fences, backticks, demo tokens/private paths and edited text. Cancel
   must leave the clipboard unchanged. Explicit copy must match the reviewed sanitized text. Scan detection is
   best-effort. Verify a clipboard backend failure is reported without claiming a successful copy.
6. Compare two outputs. `c` copies a sanitized plain diff without redaction; sensitive findings disclose that.
   `r` opens report review with redaction. Check actual clipboard bytes in a plain text editor, including combining
   characters, Unicode separators and bidi/zero-width content.

## Appearance and diagnostics

Repeat relevant steps at 40, 50, 80 and 120 columns, Safe glyphs and `NO_COLOR=1`, and inside tmux.

- Expressive is the default; successes pair active/completed wording. Failed, interrupted and waiting states keep
  factual status and timing. Classic persists through restart. Copies/reports and archived records stay factual.
  Reattach a running command and check its phrase stays paired when its live journal is available.
- Import a local Starship/Oh My Posh theme in `/theme`. Preview must disclose unsupported/lossy mappings before
  saving. Cancel stores nothing. Saving changes only the NMSh theme library; provider source files remain unchanged.
- `/modules` details explain reads, routing, collection state and measured time. In a short window,
  use Up/Down and PageUp/PageDown to reach Source, Cache, Timing and Why; resize and confirm the view stays bounded. Opening details or `/doctor` must
  not trigger unrelated expensive collection. Unknown/uncollected states must not claim available data or proven
  visibility.

Keep issues open until required physical results are recorded. Report failures with the exact action sequence,
capture and commit; do not substitute automated passage for these results.
