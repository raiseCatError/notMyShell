# Appearance and Welcome UI redesign

The reference surfaces use a strong selected-row band, quiet group labels, a compact
tab strip, generous spacing when available, and a stable key footer. Theme Studio
separates browsing from preview; Settings uses `groupLines`/`groupedWindow` to keep
selection visible. BatchReview and ReportReview separate the proposed result from
the deliberate confirmation. Menus remain terminal text.

## Design and component map

- Extend the shared UI with `StudioLayout`: `framePanel` + `renderTabStrip`,
  `groupLines`/`groupedWindow`, `selectedRowBand`, and `renderControlRows`. It owns
  responsive list/detail geometry and reserves the footer before allocating content.
- Appearance: grouped editor launchers and host controls, selected editor summary
  in a detail column; Motion and routing use the same shell.
- Both shader hosts: shared preset browser with category tabs (Tab jumps categories),
  explicit exclusive groups, enabled/pass-order/written status, parameter controls,
  details and framed approximate preview. Existing host descriptions and gates remain
  authoritative. Written is never evidence of loaded GPU output.
- Shared configuration review: exact plan lines wrapped in a framed document area,
  with guidance and a fixed Enter-write/Esc-cancel footer. No plan text is discarded.
- Welcome: section tabs jump to existing fields without changing their identities;
  grouped settings, live composition alongside when wide, focused text-edit and file
  picker views, preset gallery, and contextual help. P retains the startup renderer
  and draft; its exit hint is outside the production card.

## Responsive rules

120×40: list | detail/preview columns. 80×24: stacked list and optional preview.
60×20 and 40×14: selected row neighbourhood, short status and wrapped key footer.
Drop preview first, then explanatory copy; never sacrifice selection or actions.
Tiny windows show a resize hint and the essential keys. Scroll headings with their
items and retain a visible pointer in NO_COLOR; use the shared palette and glyphs.
Hidden previews never request animation frames. No new timers or dependencies.

## Execution and checks

1. Capture baseline ANSI/plain snapshots before edits (done).
2. Add responsive assertions; implement shared layout, hub, shaders and review;
   run affected tests and commit those implementation files.
3. Implement Welcome sections, pickers and preview entry/exit; verify and commit.
4. Finish render/routing/NO_COLOR coverage and after snapshots; commit tests.
5. Run only the brief's focused runner, source TypeScript and diff checks; report
   logs, local commits and physical-terminal gaps in the evidence folder. No push.
