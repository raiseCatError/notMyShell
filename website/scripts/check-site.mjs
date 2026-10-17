import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('../dist/', import.meta.url);
const origin = 'https://nmsh.raisecaterror.com';
async function allFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? allFiles(new URL(`${entry.name}/`, directory)) : new URL(entry.name, directory)));
  return nested.flat();
}
const files = await allFiles(root);
const htmlFiles = files.filter(file => file.pathname.endsWith('.html'));
const pages = new Map();
const errors = [];
for (const file of htmlFiles) {
  const relative = path.relative(root.pathname, file.pathname);
  const pathname = `/${relative.replace(/index\.html$/, '')}`;
  const html = await readFile(file, 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  if (new Set(ids).size !== ids.length) errors.push(`${pathname}: duplicate IDs`);
  pages.set(pathname, { html, ids: new Set(ids) });
  if ((html.match(/<h1\b/g) || []).length !== 1) errors.push(`${pathname}: needs one h1`);
  if (!html.includes(`<link rel="canonical" href="${origin}${pathname}"`)) errors.push(`${pathname}: incorrect canonical`);
  for (const marker of ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:image"']) if (!html.includes(marker)) errors.push(`${pathname}: missing ${marker}`);
  if (html.includes('<video') && /<video[^>]*\bautoplay/.test(html)) errors.push(`${pathname}: autoplay is forbidden`);
  if (/<img[^>]+src="(?!\/brand\/|\/media\/)/.test(html)) errors.push(`${pathname}: unexpected image outside brand/media`);
}
let checkedLinks = 0;
for (const [pathname, { html }] of pages) {
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const href = match[1].replaceAll('&amp;', '&');
    if (/^(data:|mailto:|tel:)/.test(href)) continue;
    const target = new URL(href, origin + pathname);
    if (target.origin !== origin) continue;
    checkedLinks++;
    const targetPath = decodeURIComponent(target.pathname);
    const page = pages.get(targetPath) || pages.get(`${targetPath}/`);
    if (!page) {
      try { if (!(await stat(new URL(`.${targetPath}`, root))).isFile()) throw new Error(); }
      catch { errors.push(`${pathname}: missing ${href}`); }
    } else if (target.hash && !page.ids.has(decodeURIComponent(target.hash.slice(1)))) {
      errors.push(`${pathname}: missing anchor ${href}`);
    }
  }
}
const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
for (const pathname of pages.keys()) if (pathname !== '/404.html' && !sitemap.includes(`<loc>${origin}${pathname}</loc>`)) errors.push(`${pathname}: absent from sitemap`);
await stat(new URL('pagefind/pagefind.js', root));
const scripts = files.filter(file => file.pathname.includes('/_astro/') && file.pathname.endsWith('.js'));
const javascriptBytes = (await Promise.all(scripts.map(async file => gzipSync(await readFile(file)).length))).reduce((total, size) => total + size, 0);
if (javascriptBytes > 15000) errors.push(`Site JS exceeds 15KB gzip: ${javascriptBytes}`);
if (errors.length) throw new Error(`Site validation failed:\n${[...new Set(errors)].join('\n')}`);
console.log(`Site valid: ${pages.size} HTML pages, ${checkedLinks} internal links/anchors, sitemap, metadata and local search. Shared JS: ${javascriptBytes} bytes gzip (search engine lazy-loaded separately).`);
