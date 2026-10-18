---
title: Sessions and resume
description: Understand live-shell continuity, explicit attachment and saved transcripts.
group: Daily work
order: 7
sources: [README.md, ARCHITECTURE.md, docs/architecture/session-presets.md]
---

## A window is not the shell

Normally a separate local session service owns the shell PTY. Closing a frontend
window detaches instead of killing that shell, so running work can continue.
An in-process fallback exists; do not assume service-backed continuity if the
environment cannot start the service.

This is local process continuity, not cloud execution. Rebooting, terminating the
service or killing the shell is different from closing a terminal window.

## Return to a live session

Inside NMSh, open `/resume` or `/sessions`. Outside it, list sessions and explicitly
attach using the ID from the list:

```sh
nmsh --sessions
nmsh --attach <session-id>
```

`<session-id>` is a placeholder to replace, not literal text to paste unchanged.
A saved transcript is still useful after a process ends, but reading it does not
recreate shell jobs or replay commands.

## Starting configurations

Session presets describe explicitly chosen starting directories and commands.
`nmsh --presets` lists them without executing. Launching a preset creates a new
session; it is not attachment to an old process. Treat preset commands as real
commands with real effects and review what you save.

## Before removing NMSh

Finish or deliberately stop live work first. Source uninstall refuses while live
sessions are running. Closing a window is not sufficient evidence that its jobs
have ended. See [Installation](/install/#uninstall) for ownership-preserving removal.
