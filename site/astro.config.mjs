import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://raisecaterror.github.io',
  base: '/notMyShell',
  integrations: [
      starlight({
          title: 'notMyShell',
          customCss: [
              './src/styles/global.css',
              './src/custom.css',
          ],
          logo: {
              src: './src/assets/nmsh-lockup.svg',
          },
          sidebar: [
              {
                  label: 'Learn',
                  items: [
                      { label: 'What is NMSh?', slug: 'guides/getting-started' },
                      { label: 'Fundamental Concepts', slug: 'guides/concepts' },
                  ],
              },
              {
                  label: 'Guides',
                  items: [
                      { label: 'Composer and Interaction', slug: 'guides/composer' },
                      { label: 'Transcripts and Workflows', slug: 'guides/transcripts' },
                      { label: 'Themes and Customization', slug: 'guides/customization' },
                      { label: 'Context Engine', slug: 'guides/context-engine' },
                      { label: 'Sessions and Workspaces', slug: 'guides/sessions' },
                      { label: 'Tool Integrations', slug: 'guides/tools' },
                      { label: 'Managed Agents', slug: 'guides/agents' },
                  ],
              },
              {
                  label: 'Reference',
                  items: [
                      { label: 'Commands & Flags', slug: 'reference/commands' },
                      { label: 'Configuration', slug: 'reference/configuration' },
                      { label: 'Keyboard Shortcuts', slug: 'reference/keyboard-shortcuts' },
                  ],
              },
              {
                  label: 'Project',
                  items: [
                      { label: 'Architecture', slug: 'project/architecture' },
                      { label: 'Roadmap & Releases', slug: 'project/roadmap' },
                      { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
                      { label: 'Contributing', slug: 'guides/contributing' },
                  ],
              },
          ],
      }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});