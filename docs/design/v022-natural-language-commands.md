# Natural-language command suggestions (proposal)

**Status: proposal, not approved, not implemented.** Part of the [v0.22 design](v022-daily-use.md) as decision D2; discussed in
[#432](https://github.com/raiseCatError/notMyShell/issues/432).
Nothing here ships without the maintainer's scope decision on the questions at the end.

## The need

Some terminals let a person switch fluidly between typing commands and describing what they want ("find files over
100 MB changed this week"), then go straight back to commands. NMSh already has most of the pieces: Ask (`/btw`,
`/ask`, and `/btw <request>` straight from the composer), a deterministic resolver for NMSh's own capabilities, an
optional local model that may only choose among those capabilities, and command classifiers used by paste review and
`/track`. What it cannot do is propose an arbitrary shell command for an arbitrary terminal task. Ask's model contract
deliberately forbids that today ("a model cannot introduce a file, session, worktree or command").

## Principles

1. **Nothing runs by itself.** A suggestion is text shown for review. The only way it runs is the person inserting it
   into the composer and pressing Enter, exactly like a command they typed (visible, highlighted, history rules apply).
2. **A request is never shell syntax.** It is entered through an NMSh surface (`/btw`, or an explicit Ask mode in the
   composer with its own marker), so it can never reach the shell by accident, even with the feature off.
3. **Send the minimum.** By default only the request text, the shell (zsh, Bash, Fish) and the OS family. No files,
   environment, history, transcript, working directory or hostname. Anything more is attached per request, shown first.
4. **One Ask.** This is a new outcome inside the existing Ask, after its deterministic resolver, not a second assistant.
5. **Off by default; useful offline.** With no provider, Ask works as today and says how to enable suggestions.
6. **NMSh's own safety check wins.** The command is classified by NMSh's existing classifier, whatever the model says.

## Flow

```
› /btw find files over 100 MB changed this week
  (or: Ask mode in the composer, marked and hinted "Ask NMSh · Enter asks · Esc returns to commands")

Ask NMSh
  1. Deterministic resolver (unchanged). An NMSh action or answer wins.
  2. Unsupported or unclear, and command suggestions are on → CommandSuggester.

  Suggested command · zsh · Claude Haiku 5.5 with your API key
    find . -type f -size +100M -mtime -7
    Lists regular files under this directory over 100 MB, modified in the last 7 days.
    Read-only (NMSh check)
  Enter Insert into the composer · c Copy · r Refine · Esc Back

› find . -type f -size +100M -mtime -7          ← the composer, back in command mode; Enter runs it
```

Refine sends one follow-up with the previous suggestion (no longer conversation). A suggestion NMSh classifies as
destructive, privileged or writing over the network is shown with that label and needs an explicit second key to
insert; it is never offered as a one-key action.

## Architecture

- `src/ask/commandSuggest.ts`: the `CommandSuggester` interface, the fixed prompt, the result schema and validation.

  ```ts
  interface SuggestRequest { request: string; shell: 'zsh' | 'bash' | 'fish'; os: 'macos' | 'linux'; attachments?: Attachment[] }
  interface CommandSuggestion { command: string; explanation: string }
  type SuggestResult = {kind: 'suggestion'; suggestion: CommandSuggestion; usage?: {input: number; output: number}}
    | {kind: 'none'; reason: string} | {kind: 'unavailable'; reason: string};
  interface CommandSuggester { id: string; label: string; suggest(request: SuggestRequest, signal: AbortSignal): Promise<SuggestResult> }
  ```

- Providers, each optional and lazily loaded:
  - **Local**: the existing user-global model service (`src/understanding/ModelService.ts`) gains a `command` task type
    next to intent and folding, so every window shares one runtime (llama.cpp, or an already-running Ollama or LM
    Studio). The recommended 0.6B model is fit for choosing NMSh actions, not for writing shell commands: suggestions
    need a larger model the person chose. NMSh never downloads a model for this feature.
  - **Anthropic** (bring your own key): the Messages API through the official `@anthropic-ai/sdk`, default model
    `claude-haiku-5-5`, low effort, the result constrained by a JSON schema (`output_config.format`) and validated again
    locally.
  - **OpenAI-compatible endpoint** (optional third): a URL plus an optional key, which covers other hosted services
    without per-vendor code.
- Ask gains a typed `suggestion` outcome; `AskPanel` renders it with the existing action controls.
- Settings → Ask → Command suggestions: provider (Off, Local, Anthropic, OpenAI-compatible), model, endpoint, and the
  **name** of the environment variable that holds the key (NMSh stores the name, never the key).
- Validation before display: one line unless the person asked for a multi-line script, at most 1 KiB, no control
  characters or escape sequences (rendered as visible marks if present, then refused), explanation at most 300
  characters. Anything else is a "could not suggest" result, never a partial command.
- Classification: the same classifier paste review and `/track` use (`src/tasks/repeatSafety.ts` and the shared command
  classifier). The model returns no risk field: risk is NMSh's judgment only.

## Security and privacy

- **Credentials.** API keys from a provider's developer platform only, read from an environment variable the person
  names, at request time, from NMSh's own process (not the managed shell). Never written to configuration,
  transcripts, journals, logs or errors. NMSh does not read browser cookies, consumer app sessions or chat
  subscriptions, and does not assume a consumer subscription includes API access.
- **What leaves the machine.** Request text, shell and OS family. Attachments (the last command and its exit status, or
  one selected output block, bounded and passed through the existing report redaction) are opt-in per request and shown
  before sending. The first use of a remote provider shows exactly what will be sent and to which host.
- **Prompt injection.** The request is the person's own text; an attached output block is untrusted. Because nothing is
  executed and NMSh classifies the result itself, an injected instruction can at worst produce a suggestion the person
  sees, with NMSh's label.
- **Recording.** Ask's existing "Record Ask in transcript" setting applies to the visible request and suggestion. The
  prompt sent to the provider and raw responses are never stored. Ask text never enters shell history.
- **Network.** HTTPS to the configured host only; a 15 s timeout; Esc cancels; no background or speculative requests;
  no telemetry.

## Cost and tokens

A request is a fixed instruction of roughly 300–400 tokens plus the request (20–60 tokens); the answer is 50–150
tokens. On `claude-haiku-5-5` at $0.10 per million input and $0.50 per million output tokens (current list price for
prompts up to 100K tokens), that is about $0.0001–0.0003 per suggestion, or $0.10–0.30 per thousand, including some
thinking at low effort. Prompt caching does not apply (the fixed prefix is below the minimum cacheable size) and is not
needed. Ask can show a suggestion's token use. Local providers cost nothing beyond the machine's own resources; on an 8
GB Mac a model large enough to write commands competes with everything else, which is a reason the local path is never
started implicitly.

## Not in scope

No agent loop, tool use, file reading, multi-step plans or automatic execution; no conversation memory beyond one
refinement; no new assistant surface; no replacement of the deterministic resolver; no change to how commands run.

## Tests (if approved)

Fake providers only (no network in tests): schema validation; adversarial outputs (escape sequences, control
characters, multi-line, oversize, `rm -rf ~`, `curl … | sh`, a command hidden after a newline); NMSh's label overriding
any model wording; insert puts the exact text in the composer and runs nothing; Esc and timeout cancel; missing key,
unreachable endpoint and model refusal each produce a clear message and the deterministic result; nothing secret in
transcripts, journals or settings; narrow width, `NO_COLOR` and Safe glyphs.

## Questions for the maintainer

1. **Remote providers at all?** The ROADMAP's design principles keep the core experience free of cloud inference. An
   off-by-default, bring-your-own-key provider outside the core would be a new boundary. Yes, no, or local only?
2. **Which provider first?** Recommendation: local (the existing model service) first, Anthropic second, generic
   OpenAI-compatible third.
3. **Entry point.** `/btw` only (exists today), or also an Ask mode toggled from the composer? Which key, after the
   keymap conflict review (#335)?
4. **Key storage.** Environment variable name only (recommended for a first slice), or also macOS Keychain / Secret
   Service?
5. **Dependency.** The official Anthropic SDK (one dependency, loaded only when that provider is chosen) for the
   Anthropic provider, if it is approved.

A bounded first slice, once approved: the `suggestion` outcome, the local provider, insert/copy/refine, NMSh's
classification and the validation rules. The remote providers follow as a second slice after the credential review.
