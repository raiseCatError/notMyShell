import { readFileSync } from 'node:fs';
import { resolveSourceLink } from './content.mjs';

function walk(node, visitor) {
  visitor(node);
  for (const child of [...(node.children || [])]) walk(child, visitor);
}
export function sourceLinks() {
  return (tree, file) => {
    const frontmatter = file.data.astro?.frontmatter;
    const source = frontmatter?.source;
    const tag = frontmatter?.tag;
    if (!source && !tag) return;
    const manifest = tag ? { commit: tag, routes: {} } : JSON.parse(readFileSync(new URL('../src/data/upstream.json', import.meta.url), 'utf8'));
    walk(tree, node => {
      if (tag && node.type === 'heading' && node.depth === 1) node.depth = 2;
      if (node.type === 'link' || node.type === 'definition' || node.type === 'image') node.url = resolveSourceLink(node.url, source || 'README.md', manifest);
    });
  };
}
export function accessibleMarkup() {
  return tree => walk(tree, node => {
    if (node.type !== 'element') return;
    if (/^h[2-4]$/.test(node.tagName) && node.properties?.id) {
      node.children.push({ type: 'element', tagName: 'a', properties: { href: `#${node.properties.id}`, className: ['heading-anchor'], ariaLabel: 'Link to this section' }, children: [] });
    }
    if (node.tagName === 'pre') {
      node.properties ||= {};
      node.properties.tabIndex = 0;
      node.properties.ariaLabel = 'Code example';
    }
    if (node.tagName === 'table' && !node.properties?.dataScrollable) {
      const table = { ...node, properties: { ...node.properties, dataScrollable: true } };
      node.tagName = 'div';
      node.properties = { className: ['table-scroll'], tabIndex: 0, role: 'region', ariaLabel: 'Scrollable reference table' };
      node.children = [table];
    }
  });
}
