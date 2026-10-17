---
title: Everyday usage
description: A practical route through commands, output, settings and familiar tools.
group: Daily work
order: 3
sources: [README.md, docs/design/session-interaction-ux.md]
---

## Work normally

Run the commands you already use. Your real shell handles quoting, pipes,
redirection and expansion. NMSh's command feedback adds elapsed time and exit
status; those are observations, not a judgment about whether the output is useful.

```sh
git status --short
```

Use the transcript to revisit earlier output. `/find` searches it; `/filter`
narrows what is shown; `/copy` copies plain text without NMSh presentation chrome.
See [Transcript and history](/docs/transcript/) for the distinction between output
history and recallable command history.

When several commands belong together, use the [serial queue](/docs/execution/).
For a dev server or log stream that should run alongside the shell, start a separate
background task. These are different execution paths, not interchangeable labels.

## Keep something useful for later

`/pins` keeps commands and recipes. A pin stages text for editing; a recipe is
reviewed before it can enter the queue. Neither runs merely because you open it.
`/clips` holds deliberately kept text in this frontend's memory, not a permanent
cross-machine clipboard. `/ps` reads the system clipboard only when you request
it and presents the paste for review before insertion.

For a result you want to share, open `/actions` and choose an operation for that
completed output. Reports include a review step with best-effort redaction. Plain
copy does not redact secrets; always inspect what you share.

## Keep input and output comfortable

`/layout` chooses Bottom, Top or Flow composer placement. Bottom and Top dock the
editor. Flow puts it after the latest output while keeping NMSh's editor and
structured transcript; it does not switch to the host's native scrollback.

Shift+Enter inserts a newline when the host reports that combination. Ctrl+J is
the fallback. Multiline commands are native editor input, not separate submissions.

## Explore without enabling everything

`/tools` explains detected and optional tools. `/providers` selects providers for
features such as picking, history and navigation. Detection is not an instruction
to install or run something. Review any install plan before accepting it.

`/zoomies` opens Keep Awake without starting it. `/zoomies system 2h` requests a
two-hour system-sleep assertion; `/zoomies stop` ends an assertion NMSh owns.
Display-sleep prevention is unavailable through the Linux systemd inhibitor.

## When you want less decoration

Start with `/appearance`, `/motion` and `/glyphs`. You can keep the composer and
transcript without animated decoration or a busy prompt. See
[Accessibility](/docs/accessibility/) for reduced-motion, safe-glyph and color controls.
