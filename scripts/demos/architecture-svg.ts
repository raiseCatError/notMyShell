/** Stack diagrams based on the original vertical NMSh artwork. */
import {writeFileSync} from 'node:fs';
import {CAT_BODY, CAT_EYE, catPixels} from '../../src/idle/catSprite.js';

const INK = '#F2F0EC';
const QUIET = '#B0B8C2';
const ACCENT = '#C5B9E8';
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
function text(x: number, y: number, value: string, size = 16, color = QUIET, centered = false, bold = false): string {
  return `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${centered ? ' text-anchor="middle"' : ''}${bold ? ' font-weight="600"' : ''}>${escape(value)}</text>`;
}
function cat(x: number, y: number, scale = 3): string {
  return catPixels('idle').flatMap((row, ry) => [...row].flatMap((pixel, rx) => pixel === '.' ? [] : [
    `<rect x="${x + rx * scale}" y="${y + ry * scale}" width="${scale}" height="${scale}" fill="#${(pixel === 'E' ? CAT_EYE : CAT_BODY).toString(16)}"/>`,
  ])).join('');
}
function frame(x: number, y: number, width: number, height: number, accent = false): string {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${accent ? '#1E1B2E' : '#0B0B0F'}" stroke="${accent ? ACCENT : '#3D444D'}" stroke-width="2"/>`;
}
function arrow(path: string, dashed = false): string {
  return `<path d="${path}" fill="none" stroke="#7D8590" stroke-width="2"${dashed ? ' stroke-dasharray="5 5"' : ''} marker-end="url(#arrow)"/>`;
}
function svg(width: number, height: number, title: string, description: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
<title id="title">${escape(title)}</title><desc id="description">${escape(description)}</desc>
<defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6" fill="#7D8590"/></marker></defs>
<rect width="${width}" height="${height}" fill="#0B0B0F"/>
<g font-family="ui-sans-serif, system-ui, sans-serif">${body}</g>
</svg>\n`;
}

// The original three-layer composition: NMSh is wider, accented and central.
const simple = frame(170, 28, 300, 94)
  + text(320, 63, 'Terminal host', 22, INK, true, true)
  + text(320, 91, 'Ghostty / Zed / Terminal.app', 16, QUIET, true)
  + arrow('M320 122 L320 184')
  + text(340, 159, 'Input / display', 14)
  + frame(100, 190, 440, 146, true)
  + cat(222, 215)
  + text(283, 247, 'notMyShell', 27, ACCENT, false, true)
  + text(320, 282, 'Composer · prompt · highlighting', 17, ACCENT, true)
  + text(320, 308, 'Transcript · themes · live feedback', 16, QUIET, true)
  + arrow('M320 336 L320 398')
  + text(340, 374, 'Persistent PTY', 14)
  + frame(170, 404, 300, 110)
  + text(320, 439, 'Real shell', 22, INK, true, true)
  + text(320, 467, 'zsh / Bash 4.4+ / Fish', 17, QUIET, true)
  + text(320, 493, 'Execution · aliases · state', 16, QUIET, true)
  + text(320, 546, 'Fullscreen apps use passthrough to the host.', 14, QUIET, true);
writeFileSync(new URL('../../assets/readme/architecture.svg', import.meta.url), svg(640, 568,
  'NMSh: terminal host, frontend, real shell',
  'The terminal host sends input to NMSh. NMSh owns editing and presentation over a persistent zsh, Bash or Fish PTY. Fullscreen applications pass through to the host.', simple));

// Keep the same vertical spine. Supporting services sit outside the frontend.
const detailed = text(24, 32, 'NMSh / runtime flow', 18, INK, false, true)
  + frame(360, 62, 280, 94)
  + text(500, 96, 'Terminal host', 21, INK, true, true)
  + text(500, 124, 'Keys · mouse · resize · display', 15, QUIET, true)
  + arrow('M500 156 L500 204')
  + frame(268, 210, 464, 342, true)
  + cat(407, 227)
  + text(468, 259, 'notMyShell', 26, ACCENT, false, true)
  + text(500, 286, 'Owns editing and presentation', 15, QUIET, true)
  + frame(292, 312, 416, 80)
  + text(316, 342, 'Composer & command routing', 19, INK, false, true)
  + text(316, 370, 'Lexical Highlighter · slash actions · shell input', 15)
  + arrow('M500 392 L500 438')
  + frame(292, 444, 416, 84)
  + text(316, 474, 'ScreenPlan & presentation', 19, INK, false, true)
  + text(316, 499, 'Shared geometry · OutputBuffer · motion clock', 15)
  + text(500, 544, 'Prompt · Chroma · activity · FOLLOW / DETACHED', 14, ACCENT, true)
  + arrow('M268 486 L244 486 L244 109 L354 109')
  + text(86, 186, 'Rendered frame', 14)
  + frame(768, 312, 208, 128)
  + text(786, 342, 'Isolated helpers', 18, INK, false, true)
  + text(786, 370, 'SemanticService', 15)
  + text(786, 394, 'Completion / local AI', 15)
  + text(786, 418, 'Never the host TTY', 14)
  + arrow('M708 352 L762 352')
  + arrow('M708 378 L746 378 L746 654 L694 654')
  + text(753, 577, 'Submit', 14)
  + frame(312, 608, 376, 96)
  + text(500, 643, 'SessionClient', 21, INK, true, true)
  + text(500, 671, 'Service or in-process transport', 15, QUIET, true)
  + arrow('M312 652 L250 652 L250 486 L286 486')
  + text(76, 574, 'Output + markers', 14)
  + frame(24, 608, 208, 96)
  + text(42, 638, 'Persistence', 18, INK, false, true)
  + text(42, 663, 'Journal / archives', 15)
  + text(42, 687, 'History / config / themes', 14)
  + arrow('M312 680 L238 680')
  + arrow('M500 704 L500 760')
  + text(519, 738, 'Input / output', 14)
  + frame(312, 766, 376, 112)
  + text(500, 799, 'ShellSession + ShellAdapter', 21, INK, true, true)
  + text(500, 828, 'Persistent PTY · zsh / Bash / Fish', 16, QUIET, true)
  + text(500, 855, 'CLI commands / interactive programs', 15, QUIET, true)
  + arrow('M688 820 L988 820 L988 50 L654 50 L654 109 L646 109', true)
  + text(772, 782, 'Raw passthrough', 15)
  + text(500, 915, 'Raw output keeps its colors. Semantic colors belong to NMSh input and submitted commands.', 14, QUIET, true);
writeFileSync(new URL('../../assets/readme/architecture-detailed.svg', import.meta.url), svg(1000, 940,
  'NMSh detailed runtime flow',
  'A vertical host, frontend, session transport and shell stack. Isolated helpers support the composer. Output and lifecycle markers return to the frontend. Interactive programs bypass frontend presentation through raw passthrough.', detailed));
