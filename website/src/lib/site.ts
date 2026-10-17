import release from '../data/release.json';
export { release };
export const site = {
  name: 'notMyShell', shortName: 'NMSh', creator: 'raiseCatError',
  url: 'https://nmsh.raisecaterror.com', repo: 'https://github.com/raiseCatError/notMyShell',
  description: 'A considered frontend for your real shell. A persistent composer, readable transcript and live sessions, inside the terminal you already use.',
};
export const sourceUrl = (path: string) => `${site.repo}/blob/${release.sourceCommit}/${path}`;
export const sourceInstall = `git clone --branch ${release.latest.tag} https://github.com/raiseCatError/notMyShell.git\ncd notMyShell\nnpm install\nnpm run build\nnpm link\nnmsh`;
export const dateLabel = (date: string | Date) => new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
