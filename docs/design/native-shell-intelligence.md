# Native shell intelligence

The managed zsh remains authoritative. Its existing precmd hook snapshots bounded
alias/function names into its private ZDOTDIR, before the normal prompt marker.
ShellSession reads that snapshot as optional prompt metadata; SessionService
retains it through backlog/spool and SocketSessionClient delivers it on replay.
No definitions, environment values or completion body execution enter this data.
The raw PTY data stream and journal output remain unchanged.

Each metadata update advances the frontend semantic generation, cancels pending
classification and primes alias/function types. Names absent from a live snapshot
are not reintroduced as aliases/functions by the isolated configured classifier.
Names also supplement command-position completion and the existing inspector.
This does not replicate live-only function bodies or compdef definitions into the
configured completion helper. Shell environment/PATH replication remains deferred.
Older session services without metadata retain configured helper classification.

The lexical layer keeps existing token/presentation roles. It recognizes compound
reserved-word command boundaries, leading redirection targets, background
operators, common balanced parameter/command/arithmetic expansions, backticks,
conditional delimiters, quoting, escapes and glob arguments. Expansion scanning
is capped at 4096 graphemes and depth 16; unsupported/incomplete forms degrade to
the existing lexical path. It is not a replacement zsh parser. Complex wrappers,
heredoc bodies and every shell grammar production are outside this pragmatic layer.

Failure presentation relabels the existing lifecycle row only when status and
matching zsh diagnostic establish command-not-found or syntax-error evidence.
Exit 127 alone is insufficient. Raw diagnostics, copy, journal and correction
suggestions stay in their current paths; no second error panel is introduced.

Verification plan: live definitions/removal and name-only privacy fixtures,
service protocol/backlog replay, semantic stale generations, completion/inspector
integration, syntax corpus/fallbacks, diagnostic evidence and copy/journal fidelity.
Use canonical build/typecheck/full suite/diff check and additive deferred QA.
