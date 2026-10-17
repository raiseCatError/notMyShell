import type { APIRoute } from 'astro';
import { documents } from '../lib/docs';
import { site, release } from '../lib/site';
export const GET: APIRoute = async () => {
  const paths = ['/', '/features/', '/install/', '/docs/', '/learn/', '/roadmap/', '/releases/', '/architecture/', ...release.history.map(item => `/releases/${item.tag}/`), ...(await documents()).map(entry => `/docs/${entry.slug}/`)];
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(path => `<url><loc>${site.url}${path}</loc></url>`).join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
