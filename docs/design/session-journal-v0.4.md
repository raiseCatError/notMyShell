# v0.4 Presentation Session Journal

NMSh writes local presentation checkpoints under the same private sessions directory used by v0.3 archives. The journal does not restore a zsh process, jobs, environment, or shell state. `/resume` restores only saved transcript presentation.

## Boundaries and recovery

- Launch starts a new session and persists its welcome snapshot.
- Command submission and completion trigger immediate asynchronous checkpoints. Ongoing PTY output is checkpointed at most once per second. Keystrokes do not write to disk.
- Normal exit writes a final checkpoint and `endedAt`. A crash or interrupted process leaves the last durable checkpoint without `endedAt`; the browser labels that journaled session as interrupted.
- `/clear` finishes the current presentation session before clearing the view, then starts another while keeping the same live zsh.
- `/resume` loads the selected checkpoint, finishes the current presentation, restores the selected transcript, then starts a new journal session for the restored view. It never rewinds the shell.

Each checkpoint is written to a private temporary file, synced, then atomically renamed under a stable session ID. The small listing index is written afterward. If the process stops between those steps, the next listing can reconstruct metadata from the complete checkpoint. An interrupted session may lose presentation changes since its most recent checkpoint; a partial write never replaces the previous durable checkpoint.

## Retention and search

The default `sessionRetention` is 1000 unpinned sessions. Supported configuration values are 100, 500, 1000, 5000, and `null` (Unlimited). A new session is rotated into the set only after its first checkpoint succeeds. Pinned sessions are exempt; the pinned field is stored now for a future bookmark control. Older v0.3 archives remain readable.

`/resume` reads small local metadata records to list sessions, then indexes command text from retained transcripts in memory while the UI remains responsive. Search covers all retained dates, project, cwd, timestamp, and command text. The metadata index does not duplicate command text. Week and month navigation skips empty periods. No cloud sync, telemetry, or AI summaries are involved.
