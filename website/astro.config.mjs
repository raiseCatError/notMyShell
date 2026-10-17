import { defineConfig } from 'astro/config';
import { unified, rehypeHeadingIds } from '@astrojs/markdown-remark';
import { sourceLinks, accessibleMarkup } from './scripts/markdown.mjs';

export default defineConfig({
  site: 'https://nmsh.raisecaterror.com',
  output: 'static',
  trailingSlash: 'always',
  compressHTML: true,
  devToolbar: { enabled: false },
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, defaultColor: false },
    processor: unified({ remarkPlugins: [sourceLinks], rehypePlugins: [rehypeHeadingIds, accessibleMarkup] }),
  },
});
