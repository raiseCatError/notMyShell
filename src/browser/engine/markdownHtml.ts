import {marked} from 'marked';

/**
 * Markdown to a complete HTML document for the preview. GFM is on and raw HTML in the source passes through untouched: the preview
 * page is served with a CSP that forbids scripts and remote loads (and the page runs with scripts disabled unless trusted), so
 * sanitising here would only change what the author wrote. The stylesheet is built in and typesets like a README; no external
 * fonts or resources. Light and dark are CSS variables selected by the `colorScheme` option.
 */
export interface MarkdownOptions {
  title: string;
  colorScheme: 'light' | 'dark';
}

const LIGHT = '--bg:#ffffff;--fg:#1f2328;--muted:#59636e;--link:#0969da;--rule:#d1d9e0;--code-bg:#f2f4f6;--quote:#59636e;--th-bg:#f6f8fa';
const DARK = '--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--link:#4493f8;--rule:#3d444d;--code-bg:#1a2029;--quote:#9198a1;--th-bg:#151b23';

const STYLE = `
:root{${LIGHT};color-scheme:light}
:root[data-scheme=dark]{${DARK};color-scheme:dark}
html{background:var(--bg)}
body{margin:0 auto;padding:24px 28px 64px;max-width:46rem;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;overflow-wrap:break-word}
h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.6em 0 .6em;font-weight:600}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid var(--rule)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--rule)}
h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:var(--muted)}
body>:first-child{margin-top:0}
p,ul,ol,blockquote,pre,table,details{margin:0 0 1em}
a{color:var(--link)}
img,video{max-width:100%;height:auto}
code,pre,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:.875em}
code{background:var(--code-bg);padding:.15em .35em;border-radius:5px}
pre{background:var(--code-bg);padding:14px 16px;border-radius:6px;overflow:auto;line-height:1.45}
pre code{background:none;padding:0;font-size:1em}
blockquote{margin-left:0;padding:0 1em;color:var(--quote);border-left:.25em solid var(--rule)}
hr{border:0;border-top:1px solid var(--rule);margin:1.5em 0}
table{border-collapse:collapse;display:block;overflow:auto;max-width:100%}
th,td{border:1px solid var(--rule);padding:6px 13px}
th{background:var(--th-bg);font-weight:600}
ul,ol{padding-left:2em}
li+li{margin-top:.25em}
li:has(>input[type=checkbox]){list-style:none;margin-left:-1.4em}
li>input[type=checkbox]{margin-right:.5em}
`;

export function escapeHtml(text: string): string {
  return text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}

export function markdownToHtml(markdown: string, options: MarkdownOptions): string {
  const body = marked.parse(markdown, {gfm: true, async: false}) as string;
  return `<!doctype html>\n<html lang="en" data-scheme="${options.colorScheme === 'dark' ? 'dark' : 'light'}">\n<head>\n<meta charset="utf-8">\n`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(options.title)}</title>\n<style>${STYLE}</style>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}

/** The one entry point for the preview: HTML is served as written, Markdown is converted. */
export function htmlDocumentFor(source: string, kind: 'html' | 'markdown', options: Partial<MarkdownOptions> = {}): string {
  if (kind === 'html') return source;
  return markdownToHtml(source, {title: options.title ?? 'Preview', colorScheme: options.colorScheme ?? 'light'});
}
