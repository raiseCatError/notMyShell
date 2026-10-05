/** Reproducible stack diagrams; Vespyr comes from the production sprite. */
import {writeFileSync} from 'node:fs';
import {CAT_BODY, CAT_EYE, catPixels} from '../../src/idle/catSprite.js';
const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const label = (x: number, y: number, text: string, size = 18, color = '#f2f0ec') => `<text x="${x}" y="${y}" fill="${color}" font-size="${size}">${escape(text)}</text>`;
function cat(x: number, y: number, scale = 4): string {
  return catPixels('idle').flatMap((row, ry) => [...row].flatMap((pixel, rx) => pixel === '.' ? [] : [`<rect x="${x + rx * scale}" y="${y + ry * scale}" width="${scale}" height="${scale}" fill="#${(pixel === 'E' ? CAT_EYE : CAT_BODY).toString(16)}"/>`])).join('');
}
const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], accent = false) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${accent ? '#252139' : '#1d202c'}" stroke="${accent ? '#c5b9e8' : '#555b70'}"/>${label(x + 20, y + 32, title, title.length > 25 ? 17 : 20, accent ? '#c5b9e8' : '#f2f0ec')}${lines.map((text, i) => label(x + 20, y + 61 + i * 24, text, 15, '#b0b8c2')).join('')}`;
const arrow = (path: string, dashed = false) => `<path d="${path}" fill="none" stroke="${dashed ? '#7fc4cc' : '#8b84b2'}" stroke-width="2" ${dashed ? 'stroke-dasharray="6 5"' : ''} marker-end="url(#arrow)"/>`;
function svg(w: number, h: number, title: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><title>${title}</title><defs><marker id="arrow" markerWidth="9" markerHeight="9" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#8b84b2"/></marker></defs><rect width="${w}" height="${h}" rx="20" fill="#15141c"/><g font-family="ui-sans-serif,system-ui,sans-serif">${body}</g></svg>\n`;
}
const heading = cat(32, 24) + label(103, 50, 'notMyShell', 26, '#c5b9e8');
const simple = heading + label(32, 84, 'Your terminal. Your real shell. NMSh brings them together.', 17, '#b0b8c2')
  + box(32, 125, 270, 116, 'Terminal host', ['Ghostty · Zed · Terminal.app', 'Fonts, window, key transport'])
  + box(344, 125, 270, 116, 'NMSh frontend', ['Composer, prompt, feedback', 'Transcript, themes, sessions'], true)
  + box(656, 125, 270, 116, 'Persistent real shell', ['ShellAdapter + hidden PTY', 'zsh · Bash 4.4+ · Fish'])
  + arrow('M302 180 L338 180') + arrow('M614 180 L650 180')
  + box(656, 286, 270, 90, 'CLI / TUI programs', ['git · npm · Vim · agent CLIs'])
  + arrow('M791 241 L791 280') + label(32, 292, 'Shell state survives between commands.', 18)
  + label(32, 322, 'Fullscreen programs use passthrough to the host.', 16, '#7fc4cc');
writeFileSync(new URL('../../assets/readme/architecture.svg', import.meta.url), svg(960, 408, 'NMSh terminal stack', simple));
const detailed = heading + label(32, 87, 'Runtime flow · one persistent shell, one geometry plan per frame', 18, '#b0b8c2')
  + box(32, 128, 280, 112, 'Terminal host', ['Keys, mouse, resize → NMSh', '← rendered cells / raw passthrough'])
  + box(366, 128, 340, 112, 'NMSh editor & command routing', ['Composer → lexical Highlighter', 'Slash actions or shell submission'], true)
  + box(760, 128, 310, 112, 'Detached helpers', ['Isolated SemanticService', 'Completion · optional understanding'])
  + arrow('M312 182 L360 182') + arrow('M706 182 L754 182')
  + box(366, 294, 340, 134, 'ScreenPlan & presentation', ['Shared geometry: render, cursor, hit test', 'OutputBuffer → FOLLOW / DETACHED', 'Clock → motion, Chroma, live status'], true)
  + arrow('M536 240 L536 288')
  + arrow('M366 352 L172 352 L172 246')
  + box(366, 482, 340, 112, 'SessionClient', ['Session service: detach / reattach', 'Or in-process session transport'])
  + arrow('M712 216 L736 216 L736 538 L712 538') + label(746, 399, 'submit', 15, '#b0b8c2')
  + arrow('M510 482 L510 434') + label(525, 461, 'output + lifecycle markers', 14, '#b0b8c2')
  + box(32, 482, 280, 112, 'Persistence', ['Session journal / archives', 'History · configuration · themes'])
  + arrow('M366 545 L318 545')
  + box(760, 482, 310, 112, 'ShellSession + ShellAdapter', ['One persistent PTY', 'zsh / Bash / Fish → CLI & TUI'])
  + arrow('M706 557 L754 557')
  + arrow('M915 482 L915 267 L172 267 L172 246', true)
  + label(770, 289, 'interactive raw passthrough', 14, '#7fc4cc')
  + label(32, 647, 'Raw PTY output keeps its colors. Semantic highlighting belongs to NMSh input and submitted commands.', 16, '#b0b8c2')
  + label(32, 677, 'Helpers never attach to the host controlling TTY. ScreenPlan controls PTY size as well as frontend layout.', 16, '#b0b8c2');
writeFileSync(new URL('../../assets/readme/architecture-detailed.svg', import.meta.url), svg(1100, 716, 'NMSh detailed runtime flow', detailed));
