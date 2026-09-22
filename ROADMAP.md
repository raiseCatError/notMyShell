# NMSh Roadmap

NMSh is currently zsh-first. We built deep integration with zsh to prove the architecture of a rich, non-blocking terminal frontend wrapping a persistent shell process. 

The longer-term vision is to make the frontend adaptable, allowing different underlying shells to be used interchangeably beneath the NMSh UI.

## Near term

- **Mouse behavior:** Improve native mouse and text selection behavior, including refining Shift-drag and native terminal selection interoperability.
- **Semantic highlighting:** Refine semantic syntax classification and improve edge cases around completions.
- **Unicode:** Improve multiline editing and highlighting Unicode handling.
- **Testing:** Broader terminal-host testing across different environments.
- **Setup:** Improve the installation and setup experience.
- **Assets:** Add more screenshots and demo assets.
- **Performance:** Further performance profiling and rendering optimizations.

## zsh compatibility

We will continue to deepen our integration with zsh as our primary backend:

- **Deeper compatibility:** Support more shell options where safe.
- **Aliases & functions:** Handle more complex alias and function edge cases.
- **Completions:** Richer zsh completion support and greater coverage for `zsh-completions`.
- **History:** Enhanced `Atuin` integration and improved history search.
- **Interoperability:** Better compatibility with tools like `fzf` and `fzf-tab`.
- **Plugins:** Explore extension and plugin bridge possibilities for the zsh ecosystem.
- **ZLE equivalents:** Support additional ZLE-originated functionality through NMSh-native equivalents (Note: NMSh owns the editor, so arbitrary ZLE UI plugins cannot run directly, but their functional value can be bridged).

## Multi-shell architecture

**Long-term goal:** Make shells interchangeable beneath the NMSh frontend.

We plan to introduce a `ShellAdapter` abstraction. Zsh will remain the first and deepest supported backend, but this architecture will pave the way for others.

### Conceptual architecture (Future)

```
NMSh
  ↓
ShellAdapter
  ├─ ZshAdapter
  ├─ BashAdapter
  ├─ FishAdapter
  ├─ NuAdapter
  └─ PowerShellAdapter
```

### Potential future interfaces

*CLI direction:*
`nmsh --shell bash` or `nmsh --shell fish`

*Frontend interface:*
`/shell` (to switch adapters at runtime)

*Note: These are future ideas, not currently implemented API.*

Each adapter would expose capability levels for:
- Command execution and CWD tracking
- Exit status and history
- Semantic classification
- Completions
- Aliases/functions equivalents
- Shell-specific bootstrap

## Extensibility

Future exploration into extensibility:

- Plugin and extension API
- Custom syntax classifiers
- Custom completion providers
- Slash command extensions
- Appearance and theme extensions
- Configurable activity vocabulary

## Platforms / terminals

Future compatibility investigation:

- Ghostty remains the primary target
- macOS Terminal (currently supported)
- VS Code integrated terminal (currently supported)
- iTerm2
- WezTerm
- Kitty
- Linux terminal environments

## Longer-term ideas

- First-class themes
- Richer history and search views
- Session restoration
- Optional configuration file
- Easier installer / package distribution (e.g., Homebrew formula)
- Better diagnostics and benchmark/performance tooling
