# Ask as an offline conversation

Status: draft PR to `dev`. Physical terminal validation pending.

`/btw` (alias `/ask`) resolved plain requests into NMSh's own typed capabilities. The optional local model only chose among those capabilities (intent), hinted folds, and, when turned on, suggested one shell command. A question Ask could not place ended in "I'm not sure what you mean yet" and a menu of categories. Worse, in Auto mode the intent model (Qwen3 0.6B) read such a question into the nearest capability. Recorded against the real model: "I have 3 apples and eat one. How many are left?" and "Correct the grammar: he go to school yesterday" answered *This session runs Fish*; "What is in my clipboard right now?" listed a folder; "Why would I use git stash?" showed Git status; "show me my api keys" tried to open a file named "api keys".

This change keeps every deterministic path and adds one: a general answer from the same local model.

## Routing

The planner (`TerminalApp.planAsk`) decides in this order. Each step is deterministic; the model is only asked to answer, never to route.

1. **Fail closed.** A request that seems to contain a secret (the same patterns `redact` masks) is not sent. A request to show the environment, keys, passwords or other credentials is refused.
2. **Terminal context, only when asked.** "Explain the last error", "why did that fail", "summarise the last output" take one finished block: the one chosen with Explain (the existing output selection), else the newest failed block for an error, else the newest block. NMSh's own diagnosis (`failure.ts`) is shown first as its own turn, with its own next steps; the model then gets the redacted command and at most the last 40 lines (each at most 160 characters, 2,000 characters in all, ANSI removed, each line redacted) and is asked to say what the output shows, then what it thinks, and how sure it is. The answer shows which context was sent. No other request sends output.
3. **Ask's own resolver** runs as before. NMSh actions keep their proposals and confirmations, refusals stand (a refusal is never routed around), and shell tasks keep the Copy/Insert-only command suggestion path (#432), labelled by NMSh's classifier. A question never goes to the intent model: a small model maps "what is the capital of France" to a capability.
4. **A question the resolver cannot place** goes to the model: question-shaped or a writing/rewriting request, when the resolver's outcome is unclear, unsupported, a weak guess, or only matched a command word the question merely contains ("What does HTTP status 404 mean" is not about `http`; "What does chmod 755 mean" is about `chmod` and keeps NMSh's exact answer). A knowledge question that only names a risky operation ("the difference between merge and rebase") is answered; a request to perform it is not.
5. **A follow-up** to a model answer continues the conversation unless the resolver places it firmly.
6. **Unclear or ambiguous** requests get a clarifying question. "Fix it" offers what actually happened here (explain the last error, summarise the last output), answering it as a question, or opening a file; a guess among capabilities adds "Answer it as a question (local model)".

Without a model (local understanding Off, Ask not in scope, or no model chosen) a question gets one line saying so and Open /llm.

Known routing gap, kept in the evaluation set: "In a shell, what is the difference between > and >>?" is claimed by NMSh's guide entry for shells.

## The `answer` task

One more task in the existing user-global model service; no second model or backend.

- **Request** (`AnswerRequest`): the question (≤ 1,200 characters), the history, the shell, the OS family, and the optional context. Validated again by the service; any other field rejects it.
- **History** is per Ask in one window, in memory only, never persisted and never sent anywhere else. At most six turns (three exchanges), each clipped to 900 characters, 2,400 in all (less when output context is attached); the oldest whole exchanges are dropped first and it always starts with a question. No summarisation calls. A new `/ask` starts empty; an Ask parked by Insert keeps its own. The service is stateless and the runtime's prompt cache is off, so one window's conversation never reaches another's.
- **Prompt:** a short system prompt for a small model: who it is, the user's shell and OS, be brief, code in Markdown blocks, no internet or current events, it sees only what is quoted and cannot act, say when unsure, give only the new text when rewriting, and say it cannot see the user's files. The last two were added after an A/B run on the real model (22 of 30 loose checks against 18 of 30): without them it answered "No, there is no typo on line 12 of your zshrc" and invented today's date. A rewrite request ("Rewrite this more politely: …") quotes the text apart from the instruction, which turned replies like "Sure! Let me know when you're ready" into rewrites; corrections are sent as typed (they measured slightly better that way).
- **Qwen3:** non-thinking by default (the empty think block prefilled, as the official template does), with the model card's settings: temperature 0.7, top-p 0.8, top-k 20, min-p 0, presence penalty 1.5 against repetition. *Think it through* repeats the question with thinking (0.6 / 0.95 / 20 / 0) and replaces the quick answer; reasoning text is never shown, streamed or kept in history. llama.cpp uses NMSh's ChatML; Ollama and LM Studio get the `/no_think` / `/think` soft switch (plus Ollama's `think` flag); LM Studio stays non-thinking.
- **Bounds:** 512 output tokens (900 with thinking) inside the 2,048-token context; the largest request the character limits allow was measured to fit with room for the answer. 45 s generation limit (67 s thinking) in the service, a longer client limit that covers a first load.
- **Streaming:** llama.cpp `/completion` and LM Studio's chat endpoint as server-sent events, Ollama as NDJSON. The service sends sanitized partial text at most every 50 ms to the asking client only.
- **Cancellation:** Esc sends `cancel` for that request only: dropped if queued, aborted if running (the runtime stops when its connection closes). Closing Ask, or the window disconnecting, stops it too. A cancellation is not a model error.
- **Older service:** a service started by an older NMSh lacks the `answer` feature and is never sent the task; Ask says so.

## Untrusted output

The model's text is data. `sanitizeModelText` removes reasoning blocks, every escape sequence (CSI, OSC including hyperlinks and clipboard writes, DCS, C1), control and invisible format characters (bidi overrides, zero-width); `validateAnswer` accepts exactly `{text, truncated}` and bounds it. NMSh renders it with its own colors only: Markdown code blocks indented and hard-wrapped, lists with hanging indents, emphasis markers removed, every row within the terminal width; NO_COLOR gives plain text. Each shell code block gets NMSh's own risk label (the classifier command suggestions use). Options after an answer are Copy answer, Copy code and Think it through: none is an action, and "run it" has nothing to run. A typed reply after an answer picks an option only by its number or exact label, so a new question is never fuzzy-matched to an option.

Recording follows the existing setting: with "Record Ask in transcript" off nothing is persisted; on, the visible turns are recorded as plain text and a model answer is marked `Local model (…)`.

## Measurements

Apple M2, 8 GB, llama.cpp `llama-server` b11146 (Metal), Qwen3-0.6B-Q8_0, context 2,048, produced by `scripts/local-model/askEval.ts`. Other work on the machine moves these numbers; they are one machine's runs, not a benchmark.

| | measured |
|---|---|
| Cold start (load + first answer) | first text 3.6–4.7 s, done 4.1–5.5 s |
| Warm, first text | 0.25–0.9 s for ordinary questions (prompt ≈ 165 tokens) |
| Generation | 30–50 tokens/s when the machine is otherwise quiet; answers are 8–60 tokens, done in 0.4–2 s |
| History | with the largest history (≈ 500 prompt tokens) first text 0.6–0.8 s vs 0.27–0.34 s without |
| Largest request the limits allow | 1,430–1,473 prompt tokens, leaving 575–618 for the answer (budget 512) |
| Thinking pass | 2–17 s (92–284 tokens of reasoning before the answer) |
| Memory (llama-server RSS) | ≈ 840 MB steady after load, 1.08–1.14 GB peak; 902 MB with a 2,048 context vs 1,128 MB with 4,096, so the context stays 2,048 |
| Cancel | resolved in ≈ 1 ms; the next answer's first text 0.4–0.7 s, service ready |
| Unload | 0.4–0.5 s, the process exits (no memory left); the next answer reloads, first text ≈ 3 s |

A thinking pass on the very largest request can run out of context before it answers; the answer is then marked as cut off.

## Evaluation

`scripts/local-model/askEvalSet.ts` holds the set: general knowledge, programming, shell and Git, reasoning, rewriting, follow-ups, ambiguous requests, current events, things it cannot know, command-like requests and security cases. `tests/askConversationApp.test.ts` asserts every route deterministically; `askEval.ts` runs the real model, records the previous `/ask` outcome next to the new one, and keeps every answer verbatim. Its checks are loose signals for a reader, not a grade.

## Not in scope

A second or larger model (never downloaded automatically), web access, tools, file reading, automatic execution, summarisation of history, remote providers.
