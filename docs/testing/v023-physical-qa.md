# v0.23.0 physical QA record

Build: `19def3be` (the tip of PR #484, merged into `dev` as `ecdbc659`). Tester: the maintainer, in their own terminal, over
several rounds on this and earlier candidates. Results were not recorded per terminal (Ghostty or Zed separately).

| Area | Result |
|---|---|
| Arcade over a running command with Ctrl+T | Flickering reported on `f0999bad`'s predecessor; root cause fixed (the shell's animation clocks painted between Arcade frames), re-tested: **works** |
| Typing `/games` over a running command: the inline offer, Enter opens, Esc cancels | First candidate opened without a visible offer; fixed (the offer must be seen before Enter accepts it); re-tested: **works** |
| Persistent notification banner (accent bar, stays until replaced) | **Works** |
| Activity list (foreground command, queue, `/bg`, `/track`, settled work) | **Works** |
| Exit slide over the live shell | **Works** |
| Color Orbit | Too high a jump, then (after an over-correction) no jump; the classic hop was re-tested: **works** |
| The other 32 games | Played in earlier rounds with the maintainer's feedback fixed (Pinball, Rover, Kitten Parade, squares, Leap, Treat Match, Hex Minefield). Not every game was played to its end in every size or mode. |
| NO_COLOR, Safe Glyphs, Reduced Motion, narrow terminals | Automated captures and tests only. **Not physically verified.** |
| Fedora and timing smoke | Dispatched CI on the release head (see the release PR). |

Release decision: ship v0.23.0. Remaining limits are listed in the changelog and in
[the status ledger](../development/arcade-expansion-status.md).
