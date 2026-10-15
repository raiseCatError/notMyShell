# Executable Portable Mods: security gate

Issue: [#341](https://github.com/raiseCatError/notMyShell/issues/341). Decision recorded here: **executable Portable
Mods stay disabled.** No platform NMSh supports has an isolation design that has been built, reviewed and attacked;
until one has, a Portable Mod is an inert, declarative descriptor bound to a read-only, deny-by-default broker.

This document states the threat model, what exists today, why the obvious shortcuts are not sandboxes, what an
acceptable design must demonstrate per platform, and the exact block. `tests/portableModGate.test.ts` keeps the block
in place: adding a loader fails it.

## Three classes, three trust boundaries

| Class | What runs | Under whose security |
| --- | --- | --- |
| Context Pack | nothing: declarative module data over core capabilities | NMSh core (#305, #318) |
| NMSh Portable Mod | **nothing today**: an inert descriptor and a read-only broker | would be NMSh's, and that is what this gate is about |
| Provider-native mod (a Claude Code plugin, …) | the provider's code | the provider's and the user's; NMSh's wrapping does not sandbox it |

Provider-native permissions never imply Portable Mod authority, and a Portable Mod's approval is never the provider's
`tool.approve`.

## What exists (audited on `release/v0.18.0`)

- `src/agents/mods/broker.ts`: `PortableDescriptor.execution` is the literal type `'inert'`. `ModBroker.bind` returns
  a frozen API with only `identity` and `request(permission)`; grants are intersected with the descriptor's requested
  permissions and with a fixed read-only set (`context.status`, `session.status`, `targets.list`,
  `targets.aggregate`); everything else answers "Capability not granted (deny by default)". No provider handle,
  filesystem, process or network object crosses it. `PortableInstance` holds at most 64 KiB of plain JSON state and
  runs only host-supplied projection functions.
- `src/agents/mods/model.ts`: the only built-in descriptor (Context Meter) is listed as `sandbox: 'Not executable'`,
  `executesInside: 'none (inert)'`, not enabled.
- `src/agents/mods/claudeDiscovery.ts` runs `claude plugin list --json` (the provider's own CLI, bounded by time and
  bytes) to inventory provider-native plugins. That lists provider code; it does not load or run any of it in NMSh.
- There is no loader, no dynamic `import()`, `vm`, worker, WebAssembly instantiation or `eval` anywhere under
  `src/agents/mods/`.

## Threat model

An executable mod is untrusted code, possibly written to attack the person using it. It must not be able to:

1. read or write files, spawn processes, open sockets or resolve names, except through capabilities the person
   granted for that mod and that target;
2. read secrets: environment variables, credentials, NMSh's configuration, other targets' transcripts;
3. act as the person: send input to a shell or agent, approve a tool call, or answer a question, unless that exact
   action is a granted, mediated capability with its own approval;
4. forge presentation: write raw ANSI, overdraw NMSh chrome, spoof approval prompts or provider facts;
5. exhaust the machine: CPU, memory, output, file descriptors, or time;
6. persist or escalate: survive removal, modify NMSh or other mods, or load more code;
7. cross targets: see or affect a target it was not granted, or aggregate across targets without an explicit grant.

Integrity (what was installed is what runs), provenance (who published it), update and revocation are part of the
same gate.

## Why the shortcuts are not sandboxes

- **A worker thread or child process alone** shares the user's identity, filesystem and network. Process separation
  limits crashes, not authority.
- **Node's permission model** (`--permission`): the Node.js documentation says it "does not protect against
  malicious code" and is a "seat belt" for trusted code; it lists bypasses (existing file descriptors, symlinks,
  `node:sqlite`). It is useful defense in depth, not the boundary.
- **`node:vm`** contexts share the process and are not a security mechanism.
- **Inert broker types** (what exists) prove nothing about code that is not bound by them.

## What an acceptable design must demonstrate

One isolation layer must be **enforced by something the mod's code cannot reach**, per supported platform:

| Platform | Candidate | Open questions before it could pass |
| --- | --- | --- |
| Linux | a separate process in new user/mount/network/PID namespaces (as bubblewrap does) with a seccomp-bpf filter and Landlock rules; cgroup or `setrlimit` limits | unprivileged user namespaces are disabled on some distributions; Landlock ABI varies by kernel; must fail closed |
| macOS | a separate process under a Seatbelt profile (`sandbox-exec`/`sandbox_init`) | the interface is deprecated and undocumented for third parties; profile semantics change between releases; App Sandbox needs a signed app with entitlements, which a CLI installed by npm or Homebrew is not |
| Any | WebAssembly modules with **no WASI** and only host-defined imports (the broker), run in a separate process with OS limits; memory bounded by the module's declared maximum, CPU by an external deadline and termination | still needs the process-level limits above; side channels; the host imports become the whole attack surface and need adversarial review |

Whatever is chosen must show, with adversarial tests that run in CI on each supported platform:

- default deny for filesystem, network, process creation and environment, verified by mods that try each;
- resource limits (CPU time, memory, output bytes, open files, wall time) that terminate and clean up;
- cancellation and cleanup on target close, NMSh exit and crash;
- per-target separation and explicit, revocable cross-target grants;
- a mod approval owner separate from provider approvals, with keyboard-first, Safe/NO_COLOR-clear prompts;
- contributions only as bounded typed data rendered by NMSh (status items, sidebar items, panel content, actions,
  annotations): no ANSI, no renderer ownership, no focus stealing, no approval decoration that changes the decision;
- integrity (pinned hashes), provenance display, update and revocation;
- honest unsupported-platform behavior: where isolation cannot be enforced, execution is unavailable and says why.

## The block

- `PortableDescriptor.execution` stays the literal `'inert'`; any other value is a type error.
- No dynamic code loading under `src/agents/mods/`: no `import()`, `require()`, `new Function`, `eval`, `node:vm`,
  `node:worker_threads`, `WebAssembly.instantiate`/`compile`. The single `child_process` use is the provider-native
  inventory listing (`claude plugin list --json`).
- The broker grants only the fixed read-only permission set, and only what the descriptor requested.
- Built-in inventory entries for Portable Mods are `Not executable`.

`tests/portableModGate.test.ts` asserts each of these. Lifting the block means changing those tests in the same
change that delivers the isolation, its threat-model review and its adversarial suite; it is not a setting.

## Related

- #332 and #336 consume typed contributions (panel content, actions) only after this gate.
- #339 owns provider task/event truth; #340 Remote Control; #334 must not offer executable mods during onboarding.
