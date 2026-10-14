# Managed providers: Codex, OpenCode and Claude Remote Control

Issues: [#339](https://github.com/raiseCatError/notMyShell/issues/339) (provider adapters and capability evidence),
[#340](https://github.com/raiseCatError/notMyShell/issues/340) (Claude Remote Control compatibility). Research date:
2026-10-11. Versions examined locally: codex-cli 0.162.1, opencode 2.0.18. Claude Code was not run (see QA).

Boundary (unchanged from #329): the provider owns the model, the agent loop, reasoning, context and compaction,
native tools, sandbox and approval policy. NMSh owns presentation, navigation, input ownership, target switching and
the person's approval answers through a supported channel. NMSh never scrapes a TUI, never calls a model API and
never approves on the person's behalf. Unknown or unprobed support stays unknown.

## Evidence matrix

`available` = documented by the provider **and** implemented and tested in NMSh against the documented shapes;
`documented` = the provider documents it, NMSh does not implement it; `unknown` = not documented or not probed;
`no` = documented as unsupported.

| Capability (`TARGET_CAPABILITIES`) | Claude Code (`--print`, stream-json) | Codex (`app-server`) | OpenCode (`serve`) |
| --- | --- | --- | --- |
| message.send | available (#329) | available in adapter, not wired | documented (`POST /session/:id/prompt_async`) |
| conversation.read | available | available in adapter (`item/completed` agentMessage) | documented (`GET /event` SSE) |
| tool.observe | available | available in adapter (`commandExecution`, `fileChange`, `mcpToolCall` items) | documented (event stream; event types not documented on the server page) |
| tool.approve | available (host permission prompts) | available in adapter (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`; answers `accept` or `decline` only) | documented (`POST /session/:id/permissions/:permissionID`) |
| task.cancel | request + acknowledgement by result | request (`turn/interrupt`); acknowledged only by `turn/completed` with `interrupted` | documented (`POST /session/:id/abort`) |
| session.status | NMSh lifecycle | NMSh lifecycle | NMSh lifecycle |
| context.status | Claude status line (#305 agent context) | documented (`thread/tokenUsage/updated`), not implemented | unknown |
| plan / tasks (#332) | provider TodoWrite in transcript | documented (`turn/plan/updated`, `item/plan/delta`), not implemented | unknown (no todo endpoint on the server page) |
| stability | documented CLI flags | **experimental** (the CLI labels `app-server` `[experimental]`) | the v1 server page shows a banner for a newer v2; 2.0.18's `serve` says "Start the v2 API"; no stability statement |

## Codex (`codex app-server`)

Source: the CLI's own `codex app-server --help` and `generate-json-schema` output (0.162.1), and the published App
Server documentation (developers.openai.com/codex/app-server, now served from learn.chatgpt.com/docs/app-server).

- Transport: JSON-RPC 2.0 messages without the `"jsonrpc"` member, newline-delimited on stdio (the default; a
  WebSocket transport is documented as experimental and unsupported).
- Handshake: `initialize` with `clientInfo {name, title, version}`, then the `initialized` notification.
- Threads and turns: `thread/start {cwd}` (or `thread/resume {threadId}`) returns `{thread: {id}, model, …}`;
  `turn/start {threadId, input: [{type: "text", text, text_elements: []}]}` returns `{turn: {id}}`;
  `turn/interrupt {threadId, turnId}`.
- Events: `turn/started`, `item/started`, `item/completed` (item types include `agentMessage`, `commandExecution`,
  `fileChange`, `mcpToolCall`, `reasoning`, `plan`), `turn/completed {turn: {status: completed | interrupted |
  failed, error?: {message}}}`, plus deltas, token usage and plan updates.
- Server requests needing an answer: `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`
  (decisions include `accept`, `acceptForSession`, `decline`, `cancel` and policy amendments), and others
  (`item/tool/requestUserInput`, `mcpServer/elicitation/request`, `item/permissions/requestApproval`, …).

### What this PR implements (`src/agents/sessions/codexAdapter.ts`)

A `CodexSession` with the same contract as `ClaudeSession` (`TargetAdapter`: start, send, answer, cancel, close):

- spawns `codex app-server` with the person's own configuration: NMSh does **not** override Codex's approval
  policy, sandbox or model;
- queues messages sent before the thread exists; reports the thread once whether `thread/started` or the
  `thread/start` response arrives first;
- answers approvals only with the person's explicit choice, as `accept` (this one) or `decline`, never
  `acceptForSession` or a policy amendment;
- refuses every server request it does not implement with a JSON-RPC error, so Codex never waits on NMSh;
- reports cancellation only when the turn completes as `interrupted`; an unanswered interrupt is reported as
  unconfirmed after 5 s;
- reports a failed turn with Codex's own `turn.error.message` (first line) and never invents a reason;
- bounds frames to 8 MiB and ignores unknown or malformed messages.

`codexCapabilities` reads `codex app-server --help` and keeps the `experimental` label so the UI can show it.

Tests (`tests/codexAdapter.test.ts`) drive the adapter against a fixture server speaking the documented shapes
(`tests/fixtures/fake-codex-app-server.mjs`): handshake, queued first message, approve, decline, a refused unsupported
request, interrupt acknowledgement, a provider failure reason, refused initialization, garbage and an oversized frame.

### Not done here (integration)

- Wiring: `src/agents/harnesses.ts` keeps Codex's truthful `controlNote` and `src/agents/sessions/manager.ts` still
  only drives `claude-stream-json`. Both files are changed by the managed-agent workspace PR (#347); adding a
  `codex-app-server` control there belongs after #347 lands, so this PR adds only the adapter.
- Plans (`turn/plan/updated`) and token usage are documented but not normalized yet: they need the provider-owned
  task model in #332/#339 rather than a Codex-only shape.
- Physical QA with a signed-in Codex account (see below).

## OpenCode (`opencode serve`)

Source: opencode.ai/docs/server and `opencode serve --help` (2.0.18). The server is a local HTTP API (default
`127.0.0.1:4096`, optional basic auth via `OPENCODE_SERVER_PASSWORD`) publishing an OpenAPI 3.1 document at `/doc`,
with sessions, messages, `prompt_async`, `abort`, permission responses and an SSE stream at `/event`. 2.0.18's
`serve` describes itself as "the v2 API" and adds `--stdio` and `--service`, while the server documentation page
still describes the v1 endpoints and points to "a newer OpenCode v2" without saying how the API changed.

Decision: **no adapter yet.** The documented endpoints are enough for a design, but the event payloads are not on
the server page and the v1/v2 relationship is unclear. The next step is to read the running server's `/doc` for an
installed version (a local probe the person starts) and pin an adapter to that schema the way the Codex adapter is
pinned to its generated schema. Until then OpenCode stays "shown, not controlled", as `harnesses.ts` says.

## Claude Remote Control (#340)

Source: code.claude.com/docs/en/remote-control (read 2026-10-11).

Documented facts:

- Started explicitly with `claude remote-control` (server mode), `claude --remote-control`/`--rc` (an interactive
  session) or `/remote-control` (`/rc`) inside one; optionally automatic for every **interactive** session
  (`remoteControlAtStartup`, or `/config`).
- Requires claude.ai subscription authentication (Pro, Max, Team, Enterprise; an Owner must enable it on Team and
  Enterprise). Not available with API keys, `CLAUDE_CODE_OAUTH_TOKEN`/`setup-token` tokens, Bedrock, Agent Platform,
  Foundry, a non-Anthropic `ANTHROPIC_BASE_URL` or a Claude apps gateway; affected by
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`/`DISABLE_GROWTHBOOK`.
- The local process makes outbound HTTPS only (no inbound ports), registers with the Anthropic API and polls; traffic
  is TLS with short-lived, single-purpose credentials. Organizations can require Trusted Devices; devices are listed
  and revocable in account settings. `disableRemoteControl` turns it off; ZDR and HIPAA configurations disable it.
- One remote session per interactive process outside server mode.

Not documented: whether a `--print` stream-json session (NMSh's Managed transport) can register for Remote
Control, or how a remote message would interleave with a host-driven stream-json conversation.

Go/no-go:

- **Managed targets: no-go.** The transport NMSh drives is not documented as Remote Control capable, so NMSh offers
  no Remote Control option for Managed targets and does not add `--remote-control` to their arguments.
- **Raw (native) Claude: supported by Claude itself.** Running `claude --remote-control` in the shell, or `/rc`
  inside Claude's own TUI, is Claude's feature under Claude's authentication, consent and device controls. NMSh
  passes it through untouched and adds nothing.
- **Per-profile Never / Ask / Always (#334):** not enabled. It may be revisited only after a probe on a real account
  shows documented Remote Control for the Managed transport, or Claude documents it.
- NMSh never inspects Claude credentials, never enables remote access because Claude is detected, and never relays
  sessions itself.

## Physical QA still required (not performed)

- Codex: signed-in `codex app-server` with the adapter: a message, a command approval accepted and declined, a file
  change approval, an interrupt mid-command, a failure (for example a usage limit), Safe/NO_COLOR presentation once
  wired.
- OpenCode: `opencode serve` on a scratch project, fetch `/doc`, record the event types for the installed version.
- Claude: confirm whether `claude --print --input-format stream-json --output-format stream-json --remote-control`
  is accepted, rejected, or ignored on a subscription account, without enabling auto-connect.
