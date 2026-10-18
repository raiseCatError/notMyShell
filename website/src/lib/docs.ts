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

export const groupId = (title: string) => title.toLowerCase().replaceAll(' ', '-');
export function docNavigation(entries: Awaited<ReturnType<typeof documents>>) {
  const referenceGroups = [
    { title: 'Runtime and compatibility', slugs: ['architecture', 'shell-adapter', 'platforms', 'session-interaction'] },
    { title: 'Context and appearance', slugs: ['context-modules', 'prompt-customization', 'theme-bridge'] },
    { title: 'Workflows and integrations', slugs: ['configured-completion', 'optional-tools', 'terminal-workflow', 'background-tasks', 'workspace-keymap', 'github-workspace', 'copy-actions'] },
    { title: 'Project and validation', slugs: ['privacy', 'security', 'accessibility', 'contributing', 'verification', 'physical-qa', 'changelog', 'onboarding'] },
  ];
  const referenceSlugs = new Set(referenceGroups.flatMap(group => group.slugs.map(slug => `reference/${slug}`)));
  if (entries.some(entry => entry.data.group === 'Technical reference' && !referenceSlugs.has(entry.slug))) throw new Error('Add the new technical reference to its documentation navigation category.');
  return docGroups.map(title => ({
    title, id: groupId(title),
    articles: entries.filter(entry => entry.data.group === title && title !== 'Technical reference'),
    children: title === 'Technical reference' ? referenceGroups.map(group => ({
      title: group.title, id: groupId(group.title), articles: entries.filter(entry => group.slugs.includes(entry.slug.replace('reference/', '')) && entry.slug.startsWith('reference/')),
    })).filter(group => group.articles.length) : [],
  })).filter(group => group.articles.length || group.children.length);
}
