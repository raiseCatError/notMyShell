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
| `/copy` | Copy plain-text output, without NMSh chrome |
| `/history` | Browse command history |
| `/clear` | Clear through NMSh's own action |

Use `/help` for the arguments supported by your installed version rather than
assuming another terminal's shortcut or slash-command syntax applies.

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
in the transcript. In v0.18.0 a lone `ESC[3J` without `ESC[2J` clears the whole
transcript; the release notes distinguish this from ordinary `clear` behavior.
