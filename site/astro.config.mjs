import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [
      starlight({
          title: 'notMyShell (NMSh)',
          customCss: [
              './src/styles/global.css',
              './src/custom.css',
          ],
          logo: {
              src: './src/assets/houston.webp', // We will keep the default for now until we have Vespyr
          },
          sidebar: [
              {
                  label: 'Learn',
                  items: [
                      { label: 'What is NMSh?', link: '/notMyShell/guides/getting-started/' },
                      { label: 'Fundamental Concepts', link: '/notMyShell/guides/concepts/' },
                  ],
              },
              {
                  label: 'Guides',
                  items: [
                      { label: 'Composer and Interaction', link: '/notMyShell/guides/composer/' },
                      { label: 'Transcripts and Workflows', link: '/notMyShell/guides/transcripts/' },
                      { label: 'Themes and Customization', link: '/notMyShell/guides/customization/' },
                      { label: 'Context Engine', link: '/notMyShell/guides/context-engine/' },
                      { label: 'Sessions and Workspaces', link: '/notMyShell/guides/sessions/' },
                      { label: 'Tool Integrations', link: '/notMyShell/guides/tools/' },
                      { label: 'Managed Agents', link: '/notMyShell/guides/agents/' },
                  ],
              },
              {
                  label: 'Reference',
                  items: [
                      { label: 'Commands & Shortcuts', link: '/notMyShell/reference/commands/' },
                  ],
              },
              {
                  label: 'Project',
                  items: [
                      { label: 'Architecture', link: '/notMyShell/project/architecture/' },
                      { label: 'Roadmap & Releases', link: '/notMyShell/project/roadmap/' },
                  ],
              },
          ],
      }),
	],

  vite: {
    plugins: [tailwindcss()],
  },
});