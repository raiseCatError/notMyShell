---
title: Composer and input
description: Multiline editing, placement, keyboard forwarding and shell-aware presentation.
group: Daily work
order: 4
sources: [README.md, docs/design/session-interaction-ux.md, docs/architecture/shell-adapter.md]
---

## An editor that belongs to the frontend

NMSh owns its input editor. Your shell still owns execution, but its ordinary ZLE
or Readline editing UI does not sit on top of the composer. Avoid trying to restore
shell prompt widgets inside NMSh; they compete for the same screen and input.

| Input | Behavior |
| --- | --- |
| Enter | Submit the composed command |
| Shift+Enter | Insert a newline, if forwarded by the terminal |
| Ctrl+J | Fallback newline |
| Tab | Request completion through NMSh |
| Option+Backspace | Standard word deletion with correct host forwarding |

Terminal shortcuts may intercept a key before NMSh receives it. Check your host's
key configuration when a combination works differently in an integrated terminal.
Kitty enhanced keyboard reporting improves the combinations NMSh can distinguish.

## Position and shape

Open `/layout` to choose Bottom, Top or Flow, and a one-line or two-line composer.
Use `/prompt` for prompt content: layout and prompt are related but separate choices.

In Flow, scrolling back can move the composer off screen. Editing, pasting or
submitting returns to the newest output and still applies the action. Scrolling
alone does not snap back. Docked layouts keep their own historical-scroll behavior.

## Semantic highlighting

The lexical highlighter recognizes common command structure. An asynchronous
semantic service classifies executable names, builtins and aliases against shell
knowledge. **Partial input is not executed to find out what it means.**

Submitted command lines retain NMSh's semantic presentation in history. Arbitrary
PTY stdout/stderr does not receive semantic recoloring. Highlighting is useful
feedback, not a proof that the full grammar or command is valid or safe.
