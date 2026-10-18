# Live command tracking (`/track`)

`/track` (#393) keeps **one live result** of a finite command in the transcript, refreshed in place, while the shell
stays free for other commands. It runs on the existing `/watch` scheduler (`src/tasks/WatchTasks.ts`), whose hardening
was first written in draft PR #394 and carried into v0.21; `/watch` keeps its own behavior (its manager panel and
what-changed view) and both names manage the same trackers.

## Usage

```sh
/track df -h /Volumes/T7Projects
/track --every 5s -- docker system df
/track                  # the manager (same as /watch)
/track refresh [N]      # one refresh now (never a second, overlapping one)
/track pause [N] · /track resume [N]
/track copy [N]         # copy the latest completed result, as plain text
/track stop [N] · /track stop all
```

`N` is the tracker's position in the manager (the newest when omitted). The `--` after the cadence is optional but
keeps a command's own flags from reading as NMSh's.

## What the transcript shows

- The command line and one note, stored once like any NMSh block: what is tracked, where, and how it runs.
- Under them, drawn live and **never stored**: a status row and the latest completed result. The status says only what
  is known: first run pending, `live · every 5s · updated 13:49:25 · exit 0 · 12 runs`, a failing exit code, a timeout,
  a spawn error, `paused`, `no new result for 1m 20s` (stale), `refreshing…` while a sample runs.
- The result keeps a stable height (the largest seen, at most 12 rows) so a shorter refresh never moves what is below;
  a longer one says how many lines are not shown. `/track copy` copies all of it.
- Live rows are presentation: find, selection and `/copy` never include them, and nothing accumulates per refresh.
- Stopping a tracker (`/track stop`, or S in the manager) writes its **last result once** into the transcript, so
  history keeps it. A tracker whose window closes leaves only its stored lines.

## Execution and safety

- Every sample is `sh -c <command>` in its own process group, from the directory the tracker started in, with NMSh's
  environment and the live shell's PATH. It does not see the shell's aliases, functions, unexported variables or
  options, and it does not follow later `cd`s; the note in the block says so.
- Default interval 5 s; at least 2 s locally and 15 s for remote network targets; at most 60 minutes. Invalid
  intervals fail before anything runs. At most 8 active trackers. A sample never overlaps another of the same tracker;
  a refresh while one runs is refused with the reason.
- Repeated commands can repeat side effects. Read-only commands (and the exact `docker system df`) start at once;
  unknown ones need an explicit Yes; installing, modifying, destroying, privileged, downloaded-code, `cd`, substitution,
  background (`&`) and heredoc commands are refused.
- Each sample keeps at most 200 kB of stdout and stderr (decoded as UTF-8 across chunk boundaries), says when it was
  cut, and has its terminal control sequences removed. A sample is stopped after the lesser of 60 s or three
  intervals and shown as timed out. Stopping signals the owned process group (TERM, then KILL after a grace period);
  processes that deliberately leave the group are not followed.

## Ownership and limits

Trackers belong to the window that started them, as `/watch` always has: detaching or closing the window stops them
and their processes. They are not restarted on reattach; the stored lines remain. Service-owned tracking that survives
detach would reuse the session's background-task supervisor (#382) and is not part of v0.21.

Physical terminal checks are listed in `docs/testing/v021-physical-qa.md`.
