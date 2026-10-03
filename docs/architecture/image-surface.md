# Image surface

`src/presentation/ImageSurface.ts` is NMSh's one raster path. The terminal
emulator owns image support; NMSh can only use a protocol the host implements
and never prompts anyone to "install" image support or switch hosts.

## Protocol selection

1. **Kitty graphics protocol** when proven: the host answered the graphics
   query (`a=q`) with `OK`, or the host is Kitty itself (long-standing record).
   The query is sent only to hosts whose profile suggests support — Kitty,
   Ghostty (its README lists the Kitty graphics protocol) and WezTerm — so
   other hosts never receive an APC sequence. Replies are consumed by the
   probe and never reach the composer.
2. **iTerm2 inline images** (OSC 1337 `File=`) from the known-host record:
   iTerm2 and WezTerm (WezTerm documents iTerm2 protocol support).
3. **None**: the caller's terminal-native fallback. Multiplexers (tmux,
   screen, Zellij), `TERM=dumb` and `NMSH_IMAGES=0` always get none.

Zed and VS Code are not claimed to support inline graphics.

## Lifecycle

The renderer owns at most one overlay. Kitty data is uploaded once
(`a=t`, chunked at 4096 base64 bytes, `q=2` so no reply reaches stdin), placed
with `a=p` only when its rows repaint, and deleted with `a=d,d=I` when the
panel closes, when a foreground program takes the terminal (passthrough), and
on exit. iTerm2 images are cell content: repainting the rows removes them.

## Uses

Only `/about` (build identity and the project logo). Core UI never depends on
images; with no protocol `/about` shows a text logo and says inline images are
not available in this terminal. The logo is the repository's own
`assets/brand/nmsh-logo.png` (opaque background; a transparent raster is a
possible later refinement).
