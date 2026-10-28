# Deferred resource investigation

Execute separately after the input-ownership correction has completed review and validation. This is an investigation plan, not authorization for a broad memory optimization or a claim that the input gate has passed.

## Evidence to preserve

The actual original be3f6abe versus merged c690de05 benchmark raw data remains at `/Volumes/T7Tmp/ai-dev/nmsh-stabilization-followup-20261027/`, with provenance, samples, harnesses and measurements.json. The ownership checkpoint records their hashes; nothing is pooled or overwritten.

Warm median output/history results are substantial: 10k Unicode output 42503.28 to 269.84 ms, archive restore 684.59 to 251.93 ms, PageUp 872.55 to 40.11 ms, history typing 448.71 to 31.47 ms. Warm first-command output improves 1510.81 to 753.13 ms and durable completion 1643.01 to 858.59 ms. These are warm observations, not true-cold startup gains.

Costs remain visible: idle CPU 3.35% to 3.75% of one core; idle frontend RSS 129.28 to 152.78 MiB; idle service RSS 49.86 to 60.53 MiB; output-finish service RSS 20.38 to 70.62 MiB. Point-in-time RSS is not retained heap, peak memory or leak evidence. The output-finish snapshots differ in elapsed process lifetime: baseline 38–49 s, merged 0.27–0.30 s. Frontend after short typing is a different observation (155.17 to 153.95 MiB), not a reason to erase the idle increase.

Runtime/idle n=3 warm sessions; history n=4; long editing n=7 with correlated key samples. Small-n nearest-rank p95 is the observed maximum for runtime/history. Five-second CPU windows cover frontend/service/shell, omit other descendants, and are quantized by ps. No OS-cache purge, physical pixel latency, energy or sustained retention claim. Prior +6.7% history-typing p95 and +2.3% deletion p95 remain separate experiments without causal attribution.

## Investigation sequence

1. Reconstruct the matched benchmark environment with locked dependencies, built CLI, private HOME/service, fixed geometry/provider/shell and independently recorded exact heads. Keep original/raw results immutable. Alternate run order in a predefined bounded matrix, record all samples and external host activity, and separate source-loader costs from built runtime.
2. Idle CPU/memory: record all owned roles and descendants at common elapsed times and command lifecycle points over longer predefined windows. Collect CPU deltas, RSS, heap/GC/allocation evidence and timer/probe/render counts separately. Account for service backlog limits and sampler overhead. Do not attribute RSS differences to a leak without retained-object evidence.
3. Startup loading: measure authenticated shell readiness, first composer frame, first output and durable completion separately; record import/initialization paths and time spent starting shell/service/providers. Keep first-observed and warm samples separate. Define a reproducible cold-cache protocol before claiming any cold result; do not purge user caches or alter existing sessions.
4. Long sessions: use a bounded repeated output/history/edit workload with exact record/order checks, fixed idle checkpoints, detach/reattach and session closure. Measure retained heap and RSS across cycles, journals/backlogs, listener/process counts and reclamation after owned sessions close. Separate bounded caches from monotonic retention.
5. Form one evidence-backed hypothesis and a focused follow-up issue per cost. Agree acceptance budgets from the current milestone before code changes; validate any improvement against input safety and output/history performance. No broad cleanup or dependency churn.

All scratch and artifacts use verified T7 storage. Physical Ghostty/Zed QA remains a separate manual gate.
