#!/usr/bin/env bash
# Fixtures for the final v0.22 physical QA additions: images, text sizing, the document workspace, the browser and the arcade
# (docs/testing/v022-physical-qa.md, "Final additions").
#
#   scripts/qa/v022-final-fixtures.sh <q22-folder> <qa-build-worktree>
#
# Adds work/final/ and a launcher, nmsh3, for the build under test: your QA configuration folders (settings carry over), its own
# session service, its own arcade scores (the QA configuration folder, never your real ones). Nothing already in the folder is
# changed or removed, nothing is downloaded or installed, and nothing runs as root. Needs a built tree (npm run build).
set -euo pipefail

root=${1:-}
build=${2:-}
if [ -z "$root" ] || [ -z "$build" ]; then echo 'usage: scripts/qa/v022-final-fixtures.sh <q22-folder> <qa-build-worktree>' >&2; exit 2; fi
root=$(cd "$root" && pwd -P)
build=$(cd "$build" && pwd -P)
if [ ! -d "$root/work" ] || [ ! -x "$root/nmsh" ]; then echo "$root is not a v0.22 QA folder (run scripts/qa/v022-fixtures.sh first)" >&2; exit 2; fi
if [ ! -f "$build/dist/index.js" ] || [ ! -f "$build/dist/graphics/pngEncode.js" ]; then echo "$build has no build: run npm run build there first" >&2; exit 2; fi
final="$root/work/final"
mkdir -p "$final/images" "$final/docs/img" "$final/outside"
add() { if [ -e "$1" ]; then echo "kept $1"; else cat > "$1"; fi; }

add "$root/nmsh3" <<EOF2
#!/usr/bin/env bash
# The build under test ($build) with this folder's configuration and its own session service: ./nmsh3 [zsh|bash|fish]
profile=\${1:-zsh}
case \$profile in zsh|bash|fish) ;; *) echo 'usage: ./nmsh3 [zsh|bash|fish]' >&2; exit 2 ;; esac
mkdir -p "$root/run3-\$profile" && chmod 700 "$root/run3-\$profile"
cd "$root/work" || exit 1
exec env XDG_CONFIG_HOME="$root/config-\$profile" NMSH_RUNTIME_DIR="$root/run3-\$profile" NMSH_DISABLE_UPDATES=1 node "$build/dist/index.js"
EOF2
chmod +x "$root/nmsh3"

# Images: a gradient, a logo-like picture, a tall and a wide one, a JPEG, and a transparent PNG, made with the build's own encoders.
node --input-type=module - "$build" "$final" <<'EOF2'
import {writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [build, final] = process.argv.slice(2);
const {encodePng} = await import(pathToFileURL(join(build, 'dist/graphics/pngEncode.js')).href);
const {default: jpeg} = await import(pathToFileURL(join(build, 'node_modules/jpeg-js/index.js')).href);
const make = (width, height, paint) => { const data = new Uint8ClampedArray(width * height * 4); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data.set(paint(x, y, width, height), (y * width + x) * 4); return {width, height, data}; };
const gradient = (x, y, w, h) => [Math.round(255 * x / w), Math.round(255 * y / h), 180, 255];
const logo = (x, y, w, h) => { const dx = x - w / 2, dy = y - h / 2; const r = Math.hypot(dx, dy); return r < h * 0.42 ? [172, 150, 230, 255] : r < h * 0.5 ? [90, 80, 140, 255] : [0, 0, 0, 0]; };
const write = (name, bytes) => { const path = join(final, name); if (!existsSync(path)) writeFileSync(path, bytes); };
write('images/gradient.png', encodePng(make(480, 270, gradient)));
write('images/logo.png', encodePng(make(256, 256, logo)));
write('images/tall.png', encodePng(make(120, 480, gradient)));
write('images/wide.png', encodePng(make(900, 120, gradient)));
write('images/photo.jpg', jpeg.encode({width: 320, height: 200, data: Buffer.from(make(320, 200, gradient).data)}, 85).data);
write('docs/img/logo.png', encodePng(make(256, 256, logo)));
write('outside/secret.png', encodePng(make(64, 64, gradient)));
EOF2
# A tiny GIF (two frames) and a WebP (lossy, 8x8).
[ -e "$final/images/small.gif" ] || printf 'R0lGODlhCAAIAPAAAP8AAAAAACH5BAAKAAAALAAAAAAIAAgAAAIMhI+py+0Po5y02ouzPgUAOw==' | base64 -d > "$final/images/small.gif"
[ -e "$final/images/small.webp" ] || printf 'UklGRmYAAABXRUJQVlA4IFoAAACwAgCdASoIAAgAAMASJbACdHIAq//cAN4AA/P3/oAA/v58L7yT2/8MSpz/9/v6n+xRs2P8+xRv+xkjr/40Sj85j/hZmWOCH//vhR/+FU3BD//2oj5vzOrzuAA=' | base64 -d > "$final/images/small.webp"
[ -e "$final/docs/link" ] || [ -L "$final/docs/link" ] || ln -s ../outside "$final/docs/link"
add "$final/images/icon.svg" <<'EOF2'
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert('QA-SVG-RAN')</script><circle cx="32" cy="32" r="30" fill="#ac96e6"/></svg>
EOF2
add "$final/images/not-an-image.png" <<'EOF2'
this is text pretending to be a picture
EOF2

add "$final/docs/README-images.md" <<'EOF2'
# Image fixtures

A local picture alone in its paragraph:

![The logo](img/logo.png)

A picture inside a link:

[![Linked logo](img/logo.png)](https://example.com/project)

Text with an ![inline logo](img/logo.png) in the middle of a sentence stays a placeholder.

A remote badge, never fetched: ![Build badge](https://example.com/badge.png)

A path out of this folder: ![Outside](../outside/secret.png)

A symlink out of this folder: ![Link](link/secret.png)

A missing file: ![Gone](img/missing.png)

An SVG, never drawn: ![Icon](../images/icon.svg)

<p align="center"><img src="img/logo.png" alt="HTML logo" width="120"></p>
EOF2

add "$final/docs/typography.md" <<'EOF2'
# Heading one

Body text under the first heading, with **bold**, _italic_, `code` and a [link](https://example.com).

## Heading two

> A quotation under the second heading.

### Heading three

- [x] a finished task
- [ ] an open task

#### Heading four

| Name | Value |
|---|---|
| alpha | 1 |
| beta | 2 |

##### Heading five

```sh
echo "code stays ordinary size"
```

###### Heading six

## 日本語 heading stays ordinary text
EOF2

add "$final/docs/page.html" <<'EOF2'
<!doctype html>
<html><head><meta charset="utf-8"><title>QA page</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: Georgia, serif; margin: 2rem; line-height: 1.5; }
  h1 { font-family: Helvetica, Arial, sans-serif; letter-spacing: .04em; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .card { padding: 12px; border-radius: 12px; background: linear-gradient(135deg, #ac96e6, #5a508c); color: white; transition: transform .6s; }
  .card:hover { transform: scale(1.05) rotate(1deg); }
  .pulse { width: 16px; height: 16px; border-radius: 50%; background: #ac96e6; animation: pulse 1.2s ease-in-out infinite alternate; }
  @keyframes pulse { from { transform: scale(.6); opacity: .4; } to { transform: scale(1.4); opacity: 1; } }
  .marquee { overflow: hidden; white-space: nowrap; border: 1px solid #888; }
  .marquee span { display: inline-block; padding-left: 100%; animation: slide 8s linear infinite; }
  @keyframes slide { to { transform: translateX(-100%); } }
  @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
</style></head>
<body>
<h1>QA page: real CSS</h1>
<p>Flexbox, grid, gradients, transitions, keyframe animations, SVG and an image beside this file.</p>
<div class="pulse" title="pulses with CSS only"></div>
<div class="grid"><div class="card">One</div><div class="card">Two</div><div class="card">Three</div></div>
<p class="marquee"><span>A CSS-only marquee: it moves with scripts off. A CSS-only marquee: it moves with scripts off.</span></p>
<svg width="120" height="40" viewBox="0 0 120 40"><rect width="120" height="40" rx="8" fill="#5a508c"/><text x="12" y="26" fill="#fff" font-size="16">SVG text</text></svg>
<p><img src="img/logo.png" alt="local logo" width="96"> <a href="https://example.com">An external link</a></p>
<p id="js-note">Scripts are off: this line stays as written.</p>
<script>document.getElementById('js-note').textContent = 'QA-SCRIPT-RAN: scripts are on.'; document.title = 'QA-SCRIPT-TITLE';</script>
</body></html>
EOF2

add "$final/docs/app.html" <<'EOF2'
<!doctype html>
<html><head><meta charset="utf-8"><title>QA app</title></head>
<body style="font-family: sans-serif">
<h1>QA app (needs scripts)</h1>
<canvas id="c" width="240" height="80" style="border:1px solid #888"></canvas>
<p><label>Type here: <input id="field" placeholder="plain h, e and r are text here"></label> <span id="echo"></span></p>
<script>
  const c = document.getElementById('c').getContext('2d'); let t = 0;
  setInterval(() => { c.clearRect(0, 0, 240, 80); c.fillStyle = '#ac96e6'; c.fillRect(10 + (t++ % 200), 20, 30, 30); }, 50);
  document.getElementById('field').addEventListener('input', event => { document.getElementById('echo').textContent = 'echo: ' + event.target.value; });
</script>
</body></html>
EOF2

printf '\xef\xbb\xbf<h1>BOM and CRLF</h1>\r\n<p>kept exactly on save</p>\r\n' > "$final/docs/crlf-bom.html.tmp" && { [ -e "$final/docs/crlf-bom.html" ] || mv "$final/docs/crlf-bom.html.tmp" "$final/docs/crlf-bom.html"; rm -f "$final/docs/crlf-bom.html.tmp"; }

add "$final/paste-multi.txt" <<'EOF2'
echo FIRST-OK
cd docs
/view README-images.md
pwd
EOF2
add "$final/paste-block.txt" <<'EOF2'
for n in 1 2 3
do
  echo "block $n"
done
EOF2
echo "Final-addition fixtures ready in $final. Start the build under test with: $root/nmsh3   (or: $root/nmsh3 fish, $root/nmsh3 bash)"
