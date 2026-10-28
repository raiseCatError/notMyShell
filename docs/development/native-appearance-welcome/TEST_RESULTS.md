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
