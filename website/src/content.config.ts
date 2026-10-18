import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

const documentSchema = z.object({
  title: z.string(), description: z.string(), group: z.string(), order: z.number(),
  source: z.string().optional(), sources: z.array(z.string()).default([]),
});
export const collections = {
  guides: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/guides' }), schema: documentSchema }),
  reference: defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/reference' }), schema: documentSchema }),
  releases: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/releases' }), schema: z.object({ title: z.string(), tag: z.string(), date: z.coerce.date(), url: z.url() }) }),
};
