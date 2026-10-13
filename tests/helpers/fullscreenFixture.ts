/** Shared real fullscreen fixture; an optional loop counter is a test synchronization seam. */
export function fullscreenFixture(stop: string, progressPath?: string): string {
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  return [
    `printf '\\e[?1049h'`,
    // Query outside the trap: a WINCH during stty must request another repaint.
    `redraw=0`,
    `trap 'redraw=1' WINCH`,
    `printf 'TRAP-READY\\n'`,
    `loops=0`,
    `while [ ! -f ${quote(stop)} ]; do`,
    `  if [ "$redraw" = 1 ]; then`,
    // Clear before sampling so a later WINCH is not erased by this repaint.
    `    redraw=0`,
    `    printf "\\e[H\\e[2JREDRAW %s\\n" "$(stty size)"`,
    `  fi`,
    ...(progressPath ? [`  loops=$((loops+1))`, `  printf '%s' "$loops" > ${quote(progressPath)}`] : []),
    `  sleep 0.05`,
    `done`,
    `printf '\\e[?1049l'`,
  ].join('\n');
}
