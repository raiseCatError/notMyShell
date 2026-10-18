---
title: Configuration and settings
description: Use supported settings, transfer preferences and preserve ownership.
group: Understand the system
order: 13
sources: [README.md, docs/privacy.md, docs/design/session-interaction-ux.md]
---

## Prefer the supported interface

`/settings` (alias `/config`) is the main settings surface. `/startup` revisits
starting points and `/setup` opens the guided wizard;
focused studios such as `/theme`, `/prompt`, `/layout` and `/strip` expose related
choices without making you memorize every JSON property.

NMSh uses its own config directory, normally `~/.config/nmsh`, or an absolute
`$XDG_CONFIG_HOME/nmsh` where configured. `config.json` stores preferences; separate
files hold sessions, presets and integration ownership records.

Fresh installs receive the Recommended configuration. An existing saved object with
omitted fields retains historical defaults rather than silently receiving every new
visual or retention preference. Explicit choices are preserved. See
[Setup and first run](/docs/setup/) before applying a different starting point.

Updates are Automatic, Notify only or Off. With Notify, a newer stable release shows
one short amber notice in the transcript, once per version, with the update steps for
this installation: Homebrew commands, `/update` for a verified source checkout, or the
release page. Off checks nothing.

## Move settings, not the whole history

```sh
nmsh config export --output nmsh-settings.json
nmsh config import nmsh-settings.json
```

Import previews changes before confirmation. Category selection is available via
`--categories`. Exports are settings transfers, not session or secret backups;
host paths and local theme provenance are deliberately treated differently.

Review the exported text before sharing it. Do not copy runtime sockets or assume
a running process can be moved between machines with a JSON file.

## Keep other configuration yours

NMSh's bootstraps are private session files, not replacement shell rc files.
Explicit integrations can offer a narrowly scoped include line or supported config
change. Those are reviewed diffs, not permission to rewrite unrelated settings.

Theme Bridge removes only content still matching its ownership ledger. Editing
a generated file yourself can intentionally prevent automatic replacement/removal.
Keep that distinction in mind when moving settings to another machine.

## Diagnose before editing internals

```sh
nmsh doctor
```

Use diagnostics and the relevant studio first. Historical design documents can
contain older schema examples; they are not a reason to paste an entire old config
over a working installation.
