# Document source-position map

The Markdown/HTML document workspace has one authoritative text, the editor's `TextBuffer`, and one Markdown parser, `parseBlocks` (`src/markdown/blocks.ts`). Features that need to move between *where the text is*, *what was parsed* and *what is on screen* — heading navigation (#462), diagnostics (#466), the source/preview split (#461) and hybrid editing (#460) — use the small layer below instead of keeping their own bookkeeping. Implemented in `src/markdown/sourceMap.ts`.

```
TextBuffer position (line, UTF-16 column)  ⇄  Block.from / Block.to (source lines)  ⇄  MarkdownRow.line  ⇄  viewer row / unit
```

## Invariants
- **One text.** Positions are the buffer's logical lines (line endings and BOM already removed by `fileEdit`; they are the file encoder's concern) and columns on grapheme boundaries. Nothing counts bytes.
- **One parser.** `parseBlocks` stamps every block it makes with the source lines it consumed (`from` inclusive, `to` exclusive, blank lines swallowed at the end excluded), including blocks nested in quotes and list items (their lines map one to one onto the source) and every block an HTML block produces (they share the HTML block's span). A block without a span (the depth-limit fallback) simply has none, and every lookup falls back to its neighbours.
- **No reconstruction.** Rendered rows carry `MarkdownRow.line`, the first source line of their block; going from a row to the source or from a source line to a row (`lineForRow`, `rowForLine`) is a lookup. Markdown is never rebuilt from rendered text. Gap rows have no line and take the nearest mapped row above.
- **Stability.** Parsed structure is cached per buffer version in `DocumentIndex` (invalidated by `TextBuffer.observe`, which hears every edit, undo and redo) and recomputed on demand; parsing is bounded by `parseBlocks` (50,000 lines, reported as `truncated`). Positions that must survive edits are `SourceAnchor`s, which follow the text through every change; a position whose text was removed collapses to where it was.
- **Mode switches.** A mode that shows the same document (source, edit, preview, later split and hybrid) keeps its place by remembering a source line or an anchor, never a row number: rows change with width and mode, lines do not.

## What is built on it now
- Heading index (`headingsOf`, `DocumentIndex.headings`): level, plain text, source line, depth (nearest shallower heading) and GitHub-style slug.
- `/view file.md#heading`, the viewer's `#` heading prompt with Backspace to go back, and the editor's *Go to heading…* / *Back* (jumps are `SourceAnchor`s).

## Heading anchors: GitHub-style, and how Jekyll/Kramdown differs
Implemented: GitHub's behavior (`github-slugger`). The text a reader sees (links, images, code spans, emphasis, HTML tags and escapes reduced to their words) is lower-cased; everything except letters, marks, numbers, underscores, hyphens and spaces is removed; each space becomes a hyphen (not collapsed); a repeated slug gets `-1`, `-2`, … in document order, skipping suffixes that already exist. Headings written as raw HTML (`<h2>`) are listed in the outline but get no anchor, as on GitHub. Fragments are compared percent-decoded and case-insensitively.

Not implemented (so not promised): Kramdown's `auto_ids`, which Jekyll uses — it drops leading non-letters (`1. Intro` → `intro`, GitHub: `1-intro`), collapses punctuation and whitespace differently, falls back to `section` for a heading with no letters, and numbers duplicates as `-1`; explicit ids (`{#custom-id}`) and Jekyll's `toc` are also not read. A site built with Jekyll can therefore have anchors that differ from the ones NMSh resolves.

## Not built yet (and why)
The row↔line map is block granular. Exact column mapping inside a rendered paragraph (needed for hybrid editing's caret, #460) and per-row source ranges inside code blocks are added there when #460 needs them, from the same spans, not before. Scroll synchronisation for the split (#461) uses `rowForLine` / `lineForRow` with the heading index as landmarks.
