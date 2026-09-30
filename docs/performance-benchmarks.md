# Performance benchmark harness

Run `npm run bench` to generate the deterministic histories and report all supported benchmarks. Pass a name fragment to select work, for example `npm run bench -- suggestions/query-100k`. Set `NMSH_BENCH_SAMPLES` and `NMSH_BENCH_WARMUP` to adjust the defaults. Use `npm run bench -- --memory` to print informational process RSS and heap usage after the run; for garbage-collected heap data, run with `node --expose-gc --import=tsx scripts/benchmarks.ts --memory`.

The harness uses generated, repeatable command histories (10k and 100k unique entries), ANSI-heavy Unicode output, and wide-character text. It measures native suggestion query batches, isolated editor insertion/layout/highlighting, ANSI parsing, transcript wrapping/presentation, and transcript snapshot JSON serialization. Fixture setup is outside the timed samples. Transcript tests represent adding generated history lines and rendering the full view; they do not drive the terminal UI. ScreenPlan placement now covers Bottom, Top and Flow. History measurements include the current text-search scan and zsh import at 10k and 100k entries. Session measurements cover chunked decoding of 400 output frames from the current protocol. These measure CPU work, not Unix socket round trips or process startup; live service startup and first prompt remain separate integration measurements.

Each benchmark reports its sample and warmup counts, p50/p95, min/max/mean, and throughput where applicable, together with Node version, platform, architecture, and host memory. These are investigation measurements, not CI thresholds. Compare before and after results on the same machine, OS, Node version, power mode, and otherwise idle system. For an optimization baseline, check out the parent revision, run the selected benchmark command, save the complete output with the revision and environment, then repeat the identical command on the candidate revision. Use multiple runs to distinguish repeatable changes from noise.

## SQLite decision note for #143 / #138

The current repository has no SQLite package dependency or application persistence decision. The Deja provider's comment describes Deja's own per-query SQLite fallback; it does not establish an NMSh native-binding requirement. #143 calls for a local metadata store, import, deletion, privacy rules, and responsive large-history search; #138 expects suggestion ranking to consume that metadata when available. Those requirements warrant measuring store startup, bulk import/write, indexed filtered search, and update/query latency on representative histories before choosing a binding.

Built-in `node:sqlite` avoids an npm native addon and its per-platform prebuild/install surface, and it fits the current Node >=22 engine floor (it was added in Node 22.5). Its API is still experimental on Node 22 (active development, as of the current Node 22 docs), so compatibility and API stability need evaluation against the minimum supported Node release. A native binding such as `better-sqlite3` would be a separate dependency with native distribution/build implications, but its API maturity and measured performance should be checked at the time of the decision. No backend is selected here. Compare both options using the same #143 schema and workloads once that storage feature is designed; include install size/platform coverage and maintenance cost alongside speed.

References: [Node.js SQLite API](https://nodejs.org/api/sqlite.html), [#143 Rich history search and metadata](https://github.com/raiseCatError/notMyShell/issues/143), [#138 NMSh Native Suggestions v2](https://github.com/raiseCatError/notMyShell/issues/138).

## Investigation budgets

Aim for under 16ms of synchronous work per editor frame and under 50ms for a bounded completion/history query, with asynchronous provider work never blocking input. Measure cold and warm paths separately; these are investigation targets, not CI assertions. Startup and first prompt need end-to-end measurements before setting a trustworthy budget.

The Node >=22 engine declaration includes releases before `node:sqlite` existed and before its flag was removed (22.13). A mandatory built-in SQLite import would therefore silently raise the supported floor. Prefer a derived journal index plus bounded TypeScript queries first; benchmark a worker-owned SQLite implementation if measured scans cannot meet the query budget. SQLite APIs are synchronous, so adopting them on the editor thread would not itself solve responsiveness. No additional binding or native helper is justified by this harness alone.

## v0.8 baseline

Measured on macOS arm64, Node 26.8.1, 8GiB RAM; informational single-machine results (p50 / p95 milliseconds):

| Workload | p50 | p95 |
|---|---:|---:|
| Current text scan, 10k / 100k | 0.62 / 4.77 | 1.22 / 5.76 |
| zsh import, 10k / 100k | 1.49 / 23.58 | 2.53 / 28.47 |
| Editor insertion/layout/highlighting | 8.11 | 9.13 |
| Session decode, 400 frames | 0.48 | 0.68 |
| Suggestions, 10k / 100k | 0.60 / 4.76 | 1.02 / 13.32 |
| Full transcript wrapping, 100k | 216.46 | 373.79 |
| Transcript JSON snapshot, 100k | 459.95 | 878.17 |

Full transcript wrapping and snapshot serialization exceed the editor-frame target. They are whole-transcript workloads, not evidence that bounded history search needs a native helper. Avoid performing them as part of completion/history queries. Startup/socket latency is not measured here.

Structured completion filtering (500 candidates) measured p50 0.06ms / p95 0.13ms. A direct native-source probe measured cold Git parent-context capture at 226.64ms and command capture at 84.10ms. These cold operations are asynchronous and exceed the 50ms investigation target; warm parent-context results are cached for two seconds (32 contexts maximum) and locally filtered. Results are invalidated by buffer/cwd generation before rendering. Capture execution remains bounded to 1.5 seconds and 1MiB output.

Structured history queries with combined cwd/exit/duration/text filters and no matches (full scan) measured p50/p95 1.39/4.25ms at 10k and 11.38/11.70ms at 100k. Queries yield every 2,048 entries and stop after at most 100 results in the composer. Journal JSON loading/projection runs in a worker to keep whole-transcript parsing off the editor thread; zsh import yields between batches. Index setup and sorting are distinct from these warm-query measurements.

### Directory ranking (v0.8 navigation)

Same macOS arm64 / Node 26.8.1 host, 20 samples after 3 warmups. Native aggregation yields every 2,048 history records, caches by the immutable history snapshot, and decays visit contributions over seven days.

| Workload | p50 | p95 |
| --- | --- | --- |
| Rank 10k records | 0.65 ms | 1.61 ms |
| Rank 100k records | 6.56 ms | 9.26 ms |
| Cached fuzzy query from 10k history | 0.04 ms | 0.05 ms |
| Cached fuzzy query from 100k history | 0.02 ms | 0.03 ms |

These fixtures contain 80 unique directories. They measure native work, not private zoxide database latency or external picker rendering. zoxide queries use a bounded temporary database copy because upstream query sorts and saves its database.
