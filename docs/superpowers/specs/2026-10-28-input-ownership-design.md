# Ambiguous Enter ownership

Approved by the maintainer in this session, including explicit confirmation for ambiguous Enter.

Echo-visible evidence permits draft editing, not reader delivery. If a look resolves visible with no reader and the held keys include Enter, capture the entire draft and keys in the existing ownership hold, clear the composer, and require a user choice. Later visible/likely evidence never forwards it. Ctrl+S sends once only while the same command is live; Ctrl+Q explicitly queues after reviewable echo evidence; Tab reveals editing keys without final Enter; Esc/Ctrl+C discard. No approval-queue entry is recovered automatically. Unknown/hidden input remains private.

Completion/done retains the capture in the existing prompt hold for Tab/Esc review, with delivery invalidated. A different command, terminal ownership changes and shutdown invalidate pending delivery; stale asynchronous decisions do nothing. Native passthrough cancels the ambiguous capture before handing over rather than delaying the terminal UI or delivering old bytes. This is a conservative builder decision under the approved owner-change requirement. Existing non-ambiguous reader routing remains unchanged. No wire protocol/detector changes or new dependencies.

Alternatives: automatic late recovery from likely evidence is rejected because echo and likely reads are not proof of ownership. Sending service-owned approval entries would need a separate guarded removal/send transaction, so is deferred.

Validation: deterministic old-source red/corrected-source green with real key routing, controlled real-PTY immediate/delayed line and password reads, non-reader/false-positive/unknown/completion/order/queue/cancellation coverage, independent review, canonical verification and exact-head hosted CI. Physical Ghostty/Zed remains NOT RUN.

## State transitions

| Current state | Evidence or action | Result |
|---|---|---|
| First-key lookup hold | Echo visible, no Enter | Real composer edits may replay; echo is presentation evidence only |
| First-key hold including Enter | Real editor parses a known NMSh slash action | Existing NMSh action path; no program answer |
| Replayed program Enter / separate Enter lookup | No reader or merely likely reader | Capture entire draft into confirmation quarantine; no approval entry |
| Ordinary lookup hold | Merely likely hidden reader | Confirmation quarantine, including unfinished typing; nothing drawn or delivered |
| Ordinary lookup hold | Confirmed reader / authenticated native owner | Existing same-command routing; keys remain ordered |
| Confirmation quarantine | Any later lookup/request | Retain capture; no automatic delivery |
| Confirmation quarantine | Ctrl+S, same command live | Send captured bytes once, in typed order; clear capture |
| Confirmation quarantine | Tab / Ctrl+Q | Queue-composer review; final Enter is removed; new Enter is explicit queue intent |
| Confirmation quarantine | Done / prompt return | Existing prompt hold, hidden and review-only; sending permanently invalidated |
| Pending confirmation | New exec / native terminal handover / shutdown / detach | Discard pending capture before new owner receives typing |
| Prompt hold | Tab / Esc / Ctrl+C | Review without submission / discard; no later program receives it |
| Existing approval entry | New reader evidence | Existing quarantine semantics; never recovered automatically |

The submission guard runs after the real editor and NMSh action parser; no duplicate editor or slash parser was introduced. Queue-review drafts are excluded from later reader auto-transfer. The detector and wire protocol remain unchanged. Source review identified and tests reproduced the submitted-command passthrough callback bypass, stale queue-review draft transfer, and combined slash-action interception; the final boundaries cover each.
