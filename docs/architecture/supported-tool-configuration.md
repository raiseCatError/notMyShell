# Supported tool configuration

Research #83 defines the boundary; #252 implements it. A supported adapter
declares fields, reads supported values, prepares a private proposal, returns a
safe supported-value preview, and applies only after the shared confirmation.
Detection or provider selection never grants configuration write authority.
Preference: official/native CLI/API, then a structured parser, then a narrow
per-tool adapter. No arbitrary file editor or terminal appearance controls.

The first consumer is Starship's seven existing boolean module controls. The
shared Settings destination and later Tools Configure use the same native CLI
adapter as the prompt panel. Staging does not touch the user's file. Runtime
module/value validation, a prepared-proposal identity check, an intervening-edit
recheck, exclusive backup, same-directory atomic rename and directory fsync guard
application. Symlinks, nonregular/oversized files, multiline TOML strings and
native rewrites outside the selected field are refused rather than guessed.
Unknown setting lines/comments remain unchanged; blank-line normalization by
the native CLI is allowed. Original mode is retained. Proposals are not persisted.

Only supported field changes reach previews. Native CLI errors use generic
messages because stderr can include unrelated config or secrets. No config
contents are added to transcripts, logs, command history or session metadata.
The new shared review starts on No; cancel does not write. Other tools have no
config controls until an explicit reviewed adapter exists. This implementation
adds no public persistent schema or dependency.

Concurrent uncooperative edits in the final recheck/rename window cannot be
locked out universally; the adapter detects edits made before application and
backs up current bytes. A directory-fsync failure after rename can report a
failure despite a valid installed change; the next read shows actual state.
