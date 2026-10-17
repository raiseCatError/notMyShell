import { getCollection } from 'astro:content';
export async function documents() {
  const guides = await getCollection('guides');
  const reference = await getCollection('reference');
  return [
    ...guides.map(entry => ({ ...entry, slug: entry.id })),
    ...reference.map(entry => ({ ...entry, slug: `reference/${entry.id}` })),
  ].sort((left, right) => left.data.order - right.data.order);
}
export const docGroups = ['Start here', 'Daily work', 'Make it yours', 'Understand the system', 'Technical reference'];
