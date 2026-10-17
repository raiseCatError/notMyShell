---
title: Transcript and history
description: Read command blocks, search output and keep copying plain.
group: Daily work
order: 6
sources: [README.md, ARCHITECTURE.md, docs/privacy.md]
---

## Output organized around commands

The transcript keeps submitted commands with status, timing and their output.
Folding helps manage long output without changing what the underlying program
wrote. `/transcript` controls transcript presentation.

| Action | Purpose |
| --- | --- |
| `/find` | Search the transcript |
| `/filter` | Filter the displayed transcript |
| `/copy` | Navigate completed outputs, then Enter to copy |
| `/copy latest` | Copy the latest output immediately |
| `/copy ui` | Search and select multiple outputs |
| `/actions` | Navigate completed output and open its contextual actions |
| `/compare` | Compare the latest output with its previous run |
| `/history` | Browse command history |
| `/clear` | Clear through NMSh's own action |

Use `/help` for the arguments supported by your installed version rather than
assuming another terminal's shortcut or slash-command syntax applies.

## Select output, then choose what to do

New configurations use output navigation for bare `/copy`: Up and Down move between
completed shell outputs, Enter copies and Esc restores your view. An explicitly saved
Quick Copy or Interactive Picker preference is preserved. `/copy latest` always takes
the direct path, regardless of that preference. `/copy settings` changes the behavior.

`/actions` uses the same navigation, with Enter opening the selected output's Actions
menu. `/actions N` targets a numbered previous output directly. Actions are checked
again against the live record, so a cleared or replaced record cannot silently
redirect an operation to neighboring output.

The separate `/copy ui` picker supports search, preview and multiple selection.
Space selects, `a` selects all, `/` searches, `p` previews and Enter copies. Plain
copy includes stored folded lines and no NMSh styling. Status text and automatic
expansion start Off; choosing a smaller display is not choosing a smaller clipboard.

## Reports and comparisons

Reports offer exact-text review and best-effort redaction before sharing. That is
different from plain copy, which is deliberately **not redacted**. Inspect both the
command and output for secrets. Compare's clipboard diff is also not redacted.

`/compare`, `/compare N` and `/compare N M` select outputs using the same numbering
as `/copy`. Background task output and queue summaries are not ordinary shell output
candidates. See [Queue and background tasks](/docs/execution/) for their separate paths.

## Use a result as the next step

A block's Actions can recognize references such as files, links, commits and device
names. Choose to open, copy or stage one explicitly; recognizing it does not execute
anything. Review the destination or staged command, especially for untrusted output.

F8 and Shift+F8 move between failed commands using their exit status, not guesses
from error-looking text, and preserve your draft. The command palette offers the
same Previous/Next failed command actions if your terminal intercepts those keys.

## Follow versus inspect

While a command runs, FOLLOW keeps the viewport near the newest output. Scrolling
into history enters DETACHED inspection instead of constantly pulling the view
away from what you are reading. Flow composer return behavior is documented under
[Composer and input](/docs/composer/).

The terminal host still owns ordinary terminal text selection. Mouse support
depends on host reporting; PageUp/PageDown is the fallback for transcript scrolling.

## History is not the same as a transcript

Command history supports recalling input. A transcript records command text and
output for later reading. A live session includes the still-running shell. These
surfaces have different retention and lifecycle behavior.

Transcripts can contain secrets printed by your commands. Local-first does not
mean automatically redacted. Review text before copying or sharing it, and read
[Privacy and local data](/docs/reference/privacy/) before moving session files.

## Known output limits

Interactive applications can switch to passthrough rather than remain embedded
in the transcript. Erase sequences and inline redraws remain compatibility-sensitive;
check the [candidate changelog](/docs/reference/changelog/) and
[QA checklist](/docs/reference/physical-qa/) for the exact source checkpoint.
