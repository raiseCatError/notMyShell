import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const brand = new URL('public/brand/', root);
const lockup = await readFile(new URL('nmsh-lockup.svg', brand), 'utf8');
const sprite = lockup.match(/<g transform="translate\(0 68\.5\)"[^>]*>([\s\S]*?)<\/g>/)?.[1];
if (!sprite || !sprite.includes('x="416"')) throw new Error('The approved Vespyr sprite could not be located. Review the source artwork.');
const cat = `<svg xmlns="http://www.w3.org/2000/svg" width="448" height="256" viewBox="0 0 448 256"><g shape-rendering="crispEdges">${sprite}</g></svg>\n`;
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" width="448" height="448" viewBox="0 0 448 448"><g transform="translate(0 96)" shape-rendering="crispEdges">${sprite}</g></svg>\n`;
await writeFile(new URL('vespyr.svg', brand), cat);
await writeFile(new URL('favicon.svg', brand), favicon);
for (const size of [16, 32, 180]) {
  const filename = size === 180 ? 'apple-touch-icon.png' : `favicon-${size}.png`;
  await sharp(Buffer.from(favicon)).resize(size, size, { kernel: 'nearest' }).png({ compressionLevel: 9 }).toFile(new URL(filename, brand).pathname);
}
const template = await readFile(new URL('src/brand/social-preview.svg', root), 'utf8');
const artwork = template.replace('href="../../public/brand/vespyr.svg"', `href="data:image/svg+xml;base64,${Buffer.from(cat).toString('base64')}"`);
await sharp(Buffer.from(artwork)).png({ compressionLevel: 9 }).toFile(new URL('social-preview.png', brand).pathname);
console.log('Exported genuine Vespyr icons and the 1200×630 social preview. No product media generated.');
