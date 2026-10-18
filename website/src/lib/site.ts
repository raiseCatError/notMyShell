import release from '../data/release.json';
import launch from '../data/launch.json';
export { release, launch };
export const launchLabel = `v${launch.version}${launch.state === 'candidate' ? ' preview' : ''}`;
export const site = {
  name: 'notMyShell', shortName: 'NMSh', creator: 'raiseCatError',
  url: 'https://nmsh.raisecaterror.com', repo: 'https://github.com/raiseCatError/notMyShell',
  description: 'A richer way to use the terminal. Edit commands in a persistent composer, search your output and resume live sessions, with your real shell underneath.',
};
export const sourceUrl = (path: string) => `${site.repo}/blob/${launch.commit}/${path}`;
export const sourceInstall = launch.state === 'candidate'
  ? `git clone https://github.com/raiseCatError/notMyShell.git\ncd notMyShell\ngit checkout --detach ${launch.commit}\nnpm install\nnpm run build\nnpm link\nnmsh`
  : `git clone --branch v${launch.version} https://github.com/raiseCatError/notMyShell.git\ncd notMyShell\nnpm install\nnpm run build\nnpm link\nnmsh`;
export const dateLabel = (date: string | Date) => new Date(date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
