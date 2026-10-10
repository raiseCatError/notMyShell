# Native module coverage: Starship and Oh My Posh

Issue [#364](https://github.com/raiseCatError/notMyShell/issues/364), under [#305](https://github.com/raiseCatError/notMyShell/issues/305).
The goal is useful coverage, not a module count: NMSh had **10 built-in modules and 25 bundled Context Pack modules** (27 now that Ruby and PHP are added)
(`nmsh.agents`, `cloud`, `environment`, `infrastructure`, `project`, `system`, `vcs`). Anything below that is missing is
either already covered by a generic mechanism, available through the external prompt providers NMSh already supports
(Starship, Oh My Posh, Powerlevel10k), deliberately skipped, or a candidate.

Catalogs read on 2026-10-10: Starship's configuration reference (`starship.rs/config`) and Oh My Posh's
`website/docs/segments` tree (agents, cli, cloud, health, languages, music, scm, system, web). Nothing here claims a
module behaves identically to its upstream namesake.

## Rules a native module must meet

- Facts come from declarative files or the executable's install location, through the Context Engine's capabilities
  (scoped cache, timeout, cancellation, provenance, privacy). **No module runs repository-controlled code** or a tool
  from the workspace to learn a version; this is why several Starship modules that shell out are not ported as is.
- Demand-driven: collected only while a surface that shows it is visible.
- One module per question a person asks about a directory, not one per file extension.

## Matrix

| Upstream area | Examples (Starship / Oh My Posh) | NMSh today | Decision |
| --- | --- | --- | --- |
| Directory, shell, OS, user, time, status, duration, jobs, battery, memory | `directory`, `os`, `username`, `time`, `status`, `cmd_duration`, `jobs`, `battery`, `memory_usage` / `path`, `os`, `session`, `time`, `executiontime`, `battery`, `sysinfo` | Native: built-ins `cwd`, `shell`, `exitStatus`; pack `nmsh.system` (`os`, `user`, `jobs`, `duration`, `time`, `battery`, `memory`) | Covered |
| Git | `git_branch`, `git_status`, `git_commit`, `git_state`, `git_metrics` / `git` | Native: `gitBranch`, `gitStatus`; pack `nmsh.vcs` (`stash`, `upstream`) | Covered; commit/state/metrics are candidates only if requested |
| Other VCS | `hg_branch`, `fossil_*`, `pijul_channel`, `vcsh` / `mercurial`, `fossil`, `jujutsu`, `sapling`, `svn`, `plastic`, `dvc` | None | **Candidate: Jujutsu and Mercurial** (declarative `.jj` / `.hg` metadata); the rest defer to a provider |
| Core runtimes | `nodejs`, `python`, `golang`, `rust`, `java`, `package` / `node`, `python`, `golang`, `rust`, `java`, `project` | Native: pack `nmsh.project` (`package`, `node`, `python`, `go`, `rust`, `java`) with requested vs. active versions | Covered |
| More language runtimes | `ruby`, `php`, `dotnet`, `swift`, `kotlin`, `zig`, `elixir`, `lua`, `haskell`, `dart`, `deno`, `bun`, `scala`, `perl`, `ocaml`, `nim`, `julia`, `r`, `crystal` | Only generic: built-in `toolchain` and `discoveredTools` show that a project uses a tool, not its version | **Done: Ruby, PHP (this branch). Next: .NET, Swift, Deno/Bun, Zig, Elixir, Dart/Flutter.** Same pattern as `runtimes.ts`: requested version from the project's own file, active version from the install path or the runtime's metadata, never by running it |
| Build systems | `cmake`, `meson`, `gradle`, `maven`, `buf`, `xmake`, `bazel` / `cmake`, `gradle`, `mvn`, `bazel`, `nx` | Gradle/Maven appear as the `java` module's build tool; others only as discovered tools | Covered for Java; **candidate: a single `build` module** (CMake/Meson/Bazel/Make detection) rather than one module each |
| Environment managers | `conda`, `direnv`, `mise`, `nix_shell`, `pixi`, `guix_shell`, `spack`, `singularity`, `container` / `nix-shell` | Native: `direnv` and `tools` (pack `nmsh.environment`); Python environments including conda/venv inside `python` | Covered for direnv/conda/venv; **candidates: mise, Nix shell, devcontainer/container** |
| Cloud and infrastructure | `aws`, `gcloud`, `azure`, `kubernetes`, `terraform`, `helm`, `pulumi`, `docker_context`, `openstack`, `nats`, `opa` / `aws`, `az`, `gcp`, `kubectl`, `terraform`, `helm`, `pulumi`, `docker`, `argocd`, `cf`, `firebase` | Native: built-ins `kubeContext`, `dockerContext`; packs `nmsh.cloud` (`aws`, `gcp`, `azure`), `nmsh.infrastructure` (`terraform`, `helm`, `pulumi`) | Covered for the common set; ArgoCD, Firebase, Cloud Foundry, OpenStack, NATS, OPA: provider |
| Frameworks and app tooling | `angular`, `react`, `svelte`, `tauri`, `flutter`, `unity`, `umbraco` (Oh My Posh) | None | **Do not duplicate.** These are project-type labels derived from the same files the runtimes read; they add chrome, not information |
| Package managers | `npm`, `pnpm`, `yarn`, `bun` (OMP) | `package` module reports the package and its manager | Covered |
| Agents | `claude`, `copilot`, `antigravity` (OMP) | Native: pack `nmsh.agents` (`claude`, `claude-limits`) through Claude Code's status-line interface | Covered for Claude; other agents only when they publish a comparable official interface |
| Prompt structure | `character`, `line_break`, `fill`, `shell`, `shlvl`, `sudo`, `text`, `vimode` | NMSh owns prompt layout and its own composer | Not applicable |
| Network and web | `localip`, `ipify`, `http`, `owm`, `todoist`, `wakatime`, `lastfm`, `spotify`, `strava` | None | **Unsafe or impractical by design**: they need network calls or credentials in a prompt. Available through an external provider if a person wants them |
| Health, music, misc. | `nightscout`, `ramadan`, `withings`, `nba`, `taskwarrior` | None | Out of scope |
| Custom commands | `custom` / `command`-style segments | None, on purpose | **Not supported natively**: it runs arbitrary commands. A person who needs it uses a provider (they own that trust decision) or a data-only Context Pack |

## Recommended order of work

1. **~~Ruby, PHP~~ (done), .NET, Swift**: highest daily-use gap, all have declarative version files (`.ruby-version`/`Gemfile`,
   `composer.json`, `global.json`/`*.csproj`, `Package.swift`/`.swift-version`).
2. **Deno/Bun, Zig, Elixir, Dart**: same pattern.
3. **`build` and `env` summary modules** (CMake/Meson/Bazel; mise/Nix/devcontainer) instead of one module per tool.
4. **Jujutsu / Mercurial** state in `nmsh.vcs`.

Each addition ships with: the capability, its pack module, provenance and privacy metadata, tests against fixture
directories (including hostile and symlinked files), and the explain/timings view from
[#365](https://github.com/raiseCatError/notMyShell/issues/365).

## Compatibility

Starship, Oh My Posh and Powerlevel10k keep working as external prompt providers; nothing here replaces them. Importing
their *visual* configuration into NMSh themes is a separate problem owned by
[#304](https://github.com/raiseCatError/notMyShell/issues/304); translating their segment *logic* is not attempted.
