# Verification record

Initial source HEAD: c690de055daeb7b33ed8b5e302ef01133b3e55b4. No source modifications or test results yet.

- rtk t7run --check (sandbox): FAILED exit75, pinned T7 identity refusal; diskutil info in sandbox: DiskManagement framework unavailable.
- rtk t7run --check (elevated): PASSED, physical/external APFS identity/backing independently inspected with diskutil info and hdiutil info. Last free space6452040KiB.
- rtk git ls-remote origin refs/heads/dev: PASSED c690de055daeb7b33ed8b5e302ef01133b3e55b4.
- rtk t7run git fetch origin dev; rtk t7run git worktree add /Volumes/T7Tmp/ai-dev/worktrees/notMyShell/appearance-welcome-20261028 -b feature/appearance-welcome-20261028 origin/dev: PASSED outside sandbox.
- git status --short --branch and rev-list HEAD...origin/dev: clean source,0/0 before checkpoint docs. No primary checkout/stash mutation.
- gh pr view513/514: both OPEN,514 draft, expected heads unchanged. gh run view40521955602 and40630147755: both conclusion failure at those heads. No rerun/merge/modification.
- kitty --version:0.49.2. /Applications/Ghostty.app/Contents/MacOS/ghostty --version:1.3.1 (one sandbox invocation also logged SentryInitFailed). fastfetch --version:2.68.1. fastfetch --help logo-animation-frame: no specific help; does NOT establish animation support in this binary.
- brew update (user then authorized host updates): metadata/runtime updated7.0.10->7.0.11; cached metadata had1.3.1, authoritative cask API1.4.0. No other applications upgraded. Latest user instruction now forbids more Homebrew work.
- brew upgrade --cask ghostty under t7run with T7 HOMEBREW_CACHE/HOMEBREW_TEMP: FAILED exit1, hdiutil read-only attach Permission denied. Existing app remains1.3.1.
- shasum -a256 downloaded Ghostty.dmg: matches cask3a02075dbd24318d778426af41dee5507d53ecc4578ede96912ec9ce6d18d3e8.
- diskutil image attach --readOnly --nobrowse --mountPoint taskT7path verifiedDMG: PASSED. ditto to taskT7downloads app then codesign --verify --deep --strict: PASSED. Staged app --version:1.4.0. hdiutil detach /dev/disk17: PASSED, disk17 ejected. No GUI host rendering performed.

NOT RUN: dependency setup, baseline tests, canonical build/typecheck/tests, feature tests, performance, shader compilation/rendering, independent product review, feature exact-head CI, physical Kitty/Ghostty/Zed QA. No passing claim applies to these.

Implementation validation on dirty a7bbfb33: npm ci passed; focused node --import=tsx --test tests/hostAppearance.test.ts tests/appearanceHub.test.ts tests/hostIntegration.test.ts passed16/16 before additional review regressions; npm run typecheck passed. Independent reviewer identified seven concrete issues; source verified for queue behavior, new regression run failed6 cases as expected, then23/24 passed (compact Esc label clipped). Fix applied; revalidation pending. First canonical verify still running and overlapped edits, NOT exact-baseline proof. All tests use private T7 homes; no production config mutation.

First canonical attempt completed exit1 in928206ms: configuredCompletion.test.ts real configured candidate capture bounded to4096 reported0 instead of4096; Arcade disposed-game lifecycle is an existing TODO, not the suite failure. Thirteen skips/one TODO were reported. This run overlapped source edits and is NOT exact-source baseline/final proof. Baseline log retained. Focused retained slice1-focused.log31/31 passed. Staged Ghostty1.4 CLI attempt with generic config flags exited1 with no selected fields; +show-config --help accepts only default/changes-only/docs/no-pager, so this did NOT validate host parsing or GPU output. Failure retained ghostty-config-cli.json.

Final focused retained log slice1-focused-final.log32/32 passed in2020ms; npm run typecheck and git diff --check exit0. Final independent review no material blocker, source review only. Project item-list failed for missing read:project, best-effort access only. Stable canonical verification remains active; no passing claim.

Extra private-file newline-boundary diagnostic FAILED as expected: actual background-opacity0.8font-size17 joined; expected separate lines. Current canonical source unchanged; fix pending.

## Claude continuation (2026-10-28)

- `t7run --check`: PASSED (/Volumes/T7Tmp/ai-dev on /dev/disk10s1). No Codex test/build process alive at resume.
- Codex canonical log `slice1-canonical-verify.log` ends mid-suite (last write 10:54, no summary): run incomplete, exit status unknown. Not a pass or a baseline.
- New regression `removal keeps a line break between a no-final-newline original and later user lines (LF and CRLF)`: FAILED before the fix (`background-opacity = 0.8font-size = 17\n`), PASSED after.
- New regression `Kitty gets the appearance adapter but no Ghostty keyboard installer`: added with the fix.
- Focused (hostAppearance, appearanceHub, hostIntegration, hostProfiles): 36/36 PASSED. `npm run typecheck`: PASSED. `git diff --check`: PASSED.
- Canonical `npm run verify` on source manifest e894b2b5 (after the newline and Kitty /keyboard fixes), 11:00:57–11:23:04, log `slice1-canonical-verify-claude.log`: exit 1; 4608 tests, 4592 pass, 2 fail, 13 skipped, 1 todo (existing Arcade dispose TODO). Build and typecheck inside verify passed.
  - Failures: `absolutePathLive` (live fish) and `ansiLiveRegion` (live 40-column frontend). Both: frontend wrote 0 bytes in 20 s (startup timeout); load averages 12–14 during the run. Neither touches appearance code. Codex's three earlier failures (executionTimelineLive zsh/bash, flowComposer fullscreen) PASSED in this run.
  - Each failing file rerun alone once (`slice1-live-reruns-claude.log`): absolutePathLive 3/3 pass, ansiLiveRegion 16/16 pass. Classified as load-induced startup timeouts; no comparison against dev needed since both pass alone. Not a clean canonical pass.
- After verify, review fixes (Kitty first-existing config dir incl. macOS Library/Preferences; removal when the hook is already absent) added with regressions that failed first. Focused hostAppearance, appearanceHub, hostIntegration, hostProfiles, ghosttyKeyboard: 39/39 pass (`slice1-focused-claude.log`); typecheck 0 errors; diff --check pass. These three files are imported only by host appearance code, so the canonical run covers the rest of the tree. CI on the pushed head is the next independent check.

## Slice 2 — Kitty native shaders (fresh Claude session, 2026-10-28)

Source: branch feature/kitty-native-shaders-20261028 from 4abd014d. All Kitty runs were headless (`kitty +runpy`) with private HOME, KITTY_CONFIG_DIRECTORY and KITTY_CACHE_DIRECTORY under the T7 evidence folder or test temp dirs; no Kitty window, installed app, real config or running instance was touched.

- `t7run --check`: PASSED. `npm ci` in the new worktree: PASSED (slice2-npm-ci.log).
- PR #515 at 4abd014d: OPEN draft; CI run 40640910786 completed success on 4abd014d (all Quality/Tests/Verify jobs; timing smoke and Fedora skipped by design). Not re-run. Slice 1's local canonical run had 2 load-induced live startup timeouts (absolutePathLive fish, ansiLiveRegion) that passed alone; that remains a non-clean local run, not proof they are harmless.
- Probes (evidence `slice2-probe/`): packaged catalog listed/extracted; option docs dumped; `custom_shaders` shlex parsing and later-line replacement confirmed with Kitty's own parser; headless `build_custom_shader_pipeline_glsl` compile of a generated pipeline: OK.
- Red→green: `cursor: a Portable renderer turns Kitty’s own trail off…` FAILED on the old src/cursor/native.ts ("Portable draws the trail itself"), PASSED after the fix.
- Live installed-Kitty test (tests/kittyShadersLive.test.ts): PASSED — Kitty 0.49.2's load_config sees exactly [crt-blue, "my glow", NMSh pipeline path with a space] through an include, and slangc compiled the 7 merged groups. Compilation only; GPU output NOT verified.
- Focused (kittyShaders, kittyShaderPanel, kittyShadersLive, cursorCapabilities, cursorEffects, hostAppearance, appearanceHub, hostIntegration, hostProfiles): all passed at the time of writing; `tsc --noEmit` clean; `git diff --check` clean.
- Independent review (INDEPENDENT_REVIEW.md, Slice 2): no blocker; four should-fix items fixed with regressions (lenient removal, strip-sync always allowed, written-trail requires cursor_trail > 0 and the hook, failed catalog not cached, unpinnable leaked vars refuse, ~user refuse, R on unsupported, re-plan at confirm, sync on studio open). Kitty files after fixes: kittyShaders + kittyShaderPanel + kittyShadersLive 26/26 pass; tsc clean.
- Canonical `npm run verify` on source manifest a658e970… (log `slice2-canonical-verify.log`, 13:33–13:44): build and typecheck passed; tests 4636, pass 4621, fail 1, skipped 13, todo 1 (existing Arcade TODO); npm exit 1, so `git diff --check` did not run inside verify (run separately: pass). NOT a clean canonical pass.
  - Failure: `outputSelectionLive` "live fish: new Copy navigation…" — `timed out waiting for completed journal for echo READY` (fish frontend startup under suite load; no appearance code involved). Rerun of that file alone through the runner's private environment (`slice2-live-rerun.log`): 3/3 pass, code 0, no leftover processes. Classified as a load-induced live startup timeout like Slice 1's two; not proven harmless.
- Source manifest unchanged after verify (only docs edited since).

NOT RUN: physical Kitty/Ghostty/Zed QA, GPU rendering, performance measurement, Ghostty shader work.

## Slice 3 — Ghostty native shaders (Claude, 2026-10-28)

Source: branch feature/ghostty-native-shaders-20261028 from de2afd02. Every automated run used private HOME/XDG/NMSH config dirs; no real Ghostty config, window or installed app was touched. Evidence: `/Volumes/T7Tmp/ai-dev/nmsh-native-appearance-welcome-20261028/` (slice3-probe/, logs below).

- `t7run --check`: PASSED (after clearing regenerable caches on T7 at the user's request: node-compile, pycache, clang-module).
- Probes: shader prefixes of Ghostty v1.2.0/v1.3.0/v1.3.1/v1.4.0 compared (1.3.0–1.4.0 identical); path.zig / validate_config.zig / Config.zig read; installed 1.3.1 and staged signature-verified 1.4.0 used headlessly (`+validate-config --config-file`) only.
- Live (tests/ghosttyShadersLive.test.ts, both binaries via NMSH_TEST_GHOSTTY_BINARIES): uniform table equals each binary's compiled-in prefix; `+validate-config` accepts NMSh's composed config; slangc (Kitty-bundled) compiles every preset against its prefix and rejects a 1.3-only preset against the 1.2 prefix. PROXY compile only: Ghostty's own glslang/SPIRV-Cross/Metal path and GPU output NOT verified.
- Independent Codex review: no blocker; 7 items fixed with regressions (INDEPENDENT_REVIEW.md).
- Focused after fixes: ghosttyShaders, ghosttyShaderPanel, ghosttyShadersLive, kittyShader*, cursor*, appearanceHub, hostAppearance*, hostIntegration — 132/132 (slice3-fixes-2.log); live on 1.3.1 + 1.4.0 with hostProfiles 12/12 (slice3-fixes-live.log); tsc clean; diff --check pass.
- Canonical `npm run verify` on source manifest 4f0f9e10… (slice3-canonical-verify.log): build and typecheck passed; tests 4662, pass 4648, fail 0, skipped 13, todo 1 (existing Arcade TODO); diff --check passed; exit 0. Manifest unchanged afterwards. A clean local canonical pass.
- Mermaid (#516 run 40656373289, browserConsoleChrome.test.ts:106): not rerun in CI; local controlled runs 3/3 pass at dev+diagnostic and at #516 (mermaid-diag/REPORT.md). Unexplained in CI; deadline-under-load hypothesis, not proven.

NOT RUN: physical Ghostty/Kitty/Zed QA, GPU rendering, performance measurement.
