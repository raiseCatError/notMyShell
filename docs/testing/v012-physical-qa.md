# v0.12 additive physical QA

Status: deferred, not performed. This checklist adds only v0.12 checks to prior milestone QA. No v0.12 release or merge is authorized. Package version is 0.7.0.

Use Ghostty as the primary host and Terminal.app as fallback. Another already available capable host is optional; installing a new terminal is unnecessary. Build the final cumulative branch with `npm run build`, then launch `npm run nmsh` from a normal shell, outside a managed NMSh session.

## Treatments

- [ ] In `/settings`, select Lavender, Aurora and Theme. Use `/prompt` to choose Native Minimal/Outline; identity modules get the treatment, while Git/error states keep their semantic colors. Filled prompt styles retain their existing contrast rules.
- [ ] Check live separator, historical divider and Settings frame. Saved command source and `/copy` text stay unchanged.
- [ ] In Advanced settings, try Linear, Center outward and Outside inward geometry, Static/Travel/Breathe motion and intensity levels. Only the live rule animates; Native modules, history and panels remain static.
- [ ] Reduced Motion holds decorative presentation still and suppresses `/effects` previews; task progress still reports factual elapsed time. Effects Off suppresses decorative movement/transients while static treatment remains.
- [ ] Repeat with `NO_COLOR=1 npm run nmsh`, and with `NMSH_COLOR=256 npm run nmsh`. Explicit NMSH_COLOR has its existing precedence over NO_COLOR. Safe glyph mode remains legible and usable without Nerd Fonts.
- [ ] With NMSh stopped, optionally set `presentation.customStops` to 2–8 `#RRGGBB` colors and preset `custom` in the existing config JSON. Invalid or oversized custom lists normalize to Off; existing prompt/theme settings remain intact. The GUI does not edit color stops.
- [ ] Starship/Powerlevel10k prompts and captured external welcome output retain their own colors. Focus, selection, warnings and errors remain clear.

## Layout matrix

- [ ] Bottom + Normal
- [ ] Bottom + Chat
- [ ] Top + Normal
- [ ] Top + Chat
- [ ] Flow + Normal
- [ ] Flow + Chat

For each combination, try a narrow terminal, resize, multiline input, keyboard selection, scroll back and return to FOLLOW. Treatment changes must preserve geometry and input behavior.

## Transient effects

- [ ] Run `/effects sparkles top`, `/effects sparkles bottom`, `/effects rain top` and `/effects rain bottom`. Only available NMSh-owned gaps or rules are used; these are relative to eligible chrome, not arbitrary terminal edges.
- [ ] Let the effect finish (three seconds). The current underlying screen returns without an archived effect row or altered shell output.
- [ ] Cancel with Escape and `/effects stop`; resize mid-effect. Trigger repeatedly: the new effect replaces the old one without accumulating activity.
- [ ] Immediately submit `sleep 10` after a preview, then press Ctrl+C. The command receives the interrupt.
- [ ] Start an existing fullscreen application (`less` or `vim` where available). Effects stop and the app owns the terminal. Exit normally; NMSh restores its current projection.
- [ ] With a service-backed session, detach/reattach and suspend/resume. Effects do not resume across ownership loss; allowed welcome motion resumes normally.
- [ ] With a long-running existing optional install task, Reduced Motion/Effects Off freezes task decoration while measured time and completion/error remain factual. Do not install a tool solely to perform this optional check.
- [ ] Close the terminal during a preview. No helper, task or presentation timer should remain because of the frontend.

Do not use physical QA results to merge this stack without separate merge authorization. Record host, layout, settings, exact actions and observed PASS/FAIL; automated tests do not establish animation quality, contrast or physical host behavior.
