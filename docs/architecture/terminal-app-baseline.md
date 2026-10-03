# Terminal.app baseline (unreleased v0.10)

Terminal.app and unknown hosts use ordinary cursor/alternate-screen rendering,
owned editing, history, completion, inspector, keyboard block actions, folding,
LIVE and passthrough. Ctrl+J inserts a newline; Ctrl+W deletes a word; Ctrl+R
opens history; F1 opens the palette. Mouse hover is optional. Safe glyphs,
reduced motion and no-color remain independent user choices.

Chroma is the only NMSh-owned color authority. Host capability evidence informs
defaults: truecolor when evidenced, 256 colors with `TERM=*-256color`, otherwise
16 colors. `NMSH_COLOR=none|16|256|truecolor` overrides these defaults, including
NO_COLOR according to existing precedence. Program SGR is untouched. Existing
presentation snapshots explicitly use truecolor; baseline tests use isolated
environment fixtures. Stored historical program colors remain program-owned.

Apple supports profiles containing background, opacity, font and ANSI palette
settings, plus profile export/import. That establishes a feasible manual path,
not permission to mutate preferences. Automatic profile management is deferred.
A future implementation must preview a dedicated profile, export/backup state,
ask explicit confirmation and offer restoration. Baseline operation needs none
of that. See [Apple profile documentation](https://support.apple.com/guide/terminal/trml107/mac).

Automated checks cover mode emissions, portable decoder keys, Chroma fallback and
the existing editor/layout/history/passthrough suites. GUI appearance, selection
and host shortcuts remain [physical QA](../testing/v010-physical-qa.md).
