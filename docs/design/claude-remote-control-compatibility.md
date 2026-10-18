# Claude Remote Control: compatibility findings

Issue [#340](https://github.com/raiseCatError/notMyShell/issues/340) (research). Primary source: Anthropic's Claude Code
documentation page *Continue local sessions from any device with Remote Control*
(`https://code.claude.com/docs/en/remote-control`), read on 2026-10-10. Findings are what the page states or does not
state; **nothing here was probed against a live account**, which needs an eligible claude.ai login and a human to
approve it. Re-verify before any implementation: the feature is new and its flags change.

## What the documentation says

| Topic | Documented fact |
| --- | --- |
| Where it runs | The session keeps running on the person's machine; the remote surface (claude.ai/code, mobile apps) drives it |
| Invocation modes | `claude remote-control` (server mode, creates sessions on demand), `claude --remote-control` / `--rc` (a normal interactive session that is also reachable remotely), `/remote-control` or `/rc` inside an existing session; the Desktop app and VS Code extension use `/remote-control` |
| Eligibility | Pro, Max, Team and Enterprise; **API keys are not supported**; Team and Enterprise need an Owner to enable the toggle in admin settings; a claude.ai login is required |
| One session per process | Each interactive process registers one remote session; several instances give several sessions. Server mode runs several sessions in one process (`--capacity`, default 32; `--spawn same-dir` or `worktree`) |
| Flags | Global `claude` flags placed before `remote-control` (or added by a wrapper) are **not** carried into the sessions the server creates; `--permission-mode` and sandboxing are set explicitly |
| Trust | In an untrusted directory `claude remote-control` asks `Trust <directory>? [y/N]` before starting |
| Terminal indicator | An interactive session shows an `/rc active` indicator (hidden in terminals that are too narrow) and a failure reason when the connection drops |
| Security model | Outbound HTTPS only, no inbound ports; traffic through the Anthropic API over TLS; optional Trusted Devices enrolment, enforced per organization |
| Resume | `claude remote-control --continue` / `--session-id` for about four hours after the server stops; interactive sessions resume with `claude --continue` / `--resume` |
| Not documented | Any support for `--print` / stream-json (headless or SDK-style) sessions, for a third-party UI driving the session, or for exposing the remote channel to such a UI |

## What this means for NMSh

NMSh has two relationships with Claude Code:

1. **Raw (native TUI)**: Claude runs in NMSh's shell as any program. `claude --remote-control` and `/remote-control` are
   Claude's own features, work exactly as documented, and need nothing from NMSh. NMSh only has to keep passthrough
   correct (it does).
2. **Managed**: NMSh drives Claude through `--print --input-format stream-json --output-format stream-json` (see
   `src/agents/sessions/claudeAdapter.ts`). **The documentation does not describe Remote Control for that mode.** The
   modes it does describe are interactive sessions and its own server.

| Question | Finding |
| --- | --- |
| Remote Control for a Raw session | **Supported by Claude itself**; NMSh must not interfere or claim it |
| Remote Control for a Managed (stream-json) session | **Unknown / undocumented.** Do not advertise it |
| NMSh starting `claude remote-control` as a managed target | **Unsupported**: server mode creates its own sessions with its own permission handling; NMSh could not own the approval path or the transcript |
| Flag inheritance for per-profile launch policy | **Documented limitation**: flags are not inherited by server-created sessions, so a per-profile `--permission-mode` would have to be passed to the server itself |
| Account/device boundaries | Remote Control needs the person's claude.ai login (no API keys) and may be gated by an organization toggle and Trusted Devices; NMSh must never read, store or forward those credentials, and must show the organization's refusal as Claude reports it |
| Privacy | A remote session sends the conversation through Anthropic's API to the person's other devices; that is a data-sharing choice the person makes inside Claude, not an NMSh feature |

## Go / no-go

**No-go for a Never / Ask / Always Remote Control setting in NMSh at this time.** The only supported combination (Raw +
Claude's own commands) needs no NMSh feature, and the Managed combination is undocumented. A setting would imply support
NMSh cannot demonstrate and would blur who owns approvals.

Revisit when: (a) Anthropic documents Remote Control for headless or SDK-driven sessions, or (b) a human-run probe
shows a supported way to attach the remote channel to a stream-json session.

## Probe plan (not run; needs a person with an eligible login)

1. With an eligible account on a test machine, run Claude in Raw mode under NMSh, enable `/remote-control`, and confirm
   the `/rc active` indicator survives NMSh's passthrough, resize and detach/reattach. Record the Claude Code version.
2. Start a Managed target and check whether any documented flag attaches Remote Control to a stream-json session. Record
   the exact help text and error output; treat silence as "unsupported".
3. Confirm that environment variables and arguments NMSh sets for a managed target do not change the login Claude uses.
4. Record each result with the Claude Code version and date in this file.

Any implementation is a separate reviewed scope with physical validation, as the issue requires.
