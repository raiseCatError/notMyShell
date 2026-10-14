# Expressive activity wording

Tracked by [#362](https://github.com/raiseCatError/notMyShell/issues/362) and
[#367](https://github.com/raiseCatError/notMyShell/pull/367).

Expressive is the default. Classic remains available in Activity settings and Setup;
both persist and transfer with the existing `idle` settings category.

The dictionary contains paired active/completed phrases. Quality checks reject technical
outcome claims, NMSh feature names, repeated phrases, incorrect conjugation and excessive
width. The phrases describe decoration; shell exit codes, interruption and measured
timing decide the actual lifecycle. Waiting-input and failure displays remain factual.
Stored lifecycle text, reports and clipboard copies use factual wording.

A command selects its pair before rendering. Selection uses its text and start time,
avoiding the preceding pair. The live journal stores dictionary indices for the running
and preceding choices, so redraws and reattachment with that journal retain the choice.
These indices have no effect on execution or status. Invalid indices are ignored. An old
or missing journal falls back to deterministic selection; it cannot reconstruct a
previously displaced choice. Archived completed transcripts display factual wording.

Automated coverage includes forced adjacent-choice collisions, settings persistence and
transfer, live detach/reattach, factual clipboard bytes, failures, interruption, dictionary
quality and narrow widths. Physical terminal appearance still requires human QA.
