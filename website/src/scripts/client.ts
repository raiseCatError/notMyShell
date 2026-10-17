const themeButton = document.querySelector<HTMLButtonElement>('#theme-toggle');
function updateThemeButton() {
  const light = document.documentElement.dataset.theme === 'light';
  themeButton?.setAttribute('aria-label', `Switch to ${light ? 'dark' : 'light'} theme`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f7f6f2' : '#101114');
}
if (themeButton) {
  themeButton.hidden = false;
  updateThemeButton();
  themeButton.addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('nmsh-theme', theme); } catch {}
    updateThemeButton();
  });
}

const feedback = document.querySelector<HTMLElement>('#feedback');
let feedbackTimer: ReturnType<typeof setTimeout>;
function announce(message: string) {
  if (!feedback) return;
  clearTimeout(feedbackTimer);
  feedback.textContent = message;
  feedback.classList.add('visible');
  feedbackTimer = setTimeout(() => feedback.classList.remove('visible'), 5000);
}
document.querySelectorAll<HTMLPreElement>('pre').forEach(pre => {
  if (!pre.querySelector('code')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'code-wrap';
  pre.before(wrapper);
  wrapper.append(pre);
  pre.tabIndex = 0;
  if (!pre.hasAttribute('aria-label')) pre.setAttribute('aria-label', 'Code example');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-button';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || '');
      announce('Copied to clipboard.');
    } catch {
      announce('Copy unavailable. Select the code and copy it manually.');
    }
  });
  wrapper.append(button);
});

interface SearchData { url: string; meta: { title?: string }; excerpt: string }
interface SearchModule { search: (query: string) => Promise<{ results: { data: () => Promise<SearchData> }[] }> }
const dialog = document.querySelector<HTMLDialogElement>('#docs-search');
const trigger = document.querySelector<HTMLButtonElement>('#search-open');
const input = document.querySelector<HTMLInputElement>('#search-input');
const searchStatus = document.querySelector<HTMLElement>('#search-status');
const results = document.querySelector<HTMLOListElement>('#search-results');
let searchModule: Promise<SearchModule> | undefined;
let generation = 0;
let searchTimer: ReturnType<typeof setTimeout>;
function openSearch() { dialog?.showModal(); input?.focus(); }
if (trigger && dialog) {
  trigger.hidden = false;
  const modifier = document.querySelector('#search-modifier');
  if (modifier && !/Mac|iPhone|iPad/.test(navigator.userAgent)) modifier.textContent = 'Ctrl';
  trigger.addEventListener('click', openSearch);
  document.querySelector('#search-close')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => trigger.focus());
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
  });
}
document.querySelector('#search-form')?.addEventListener('submit', event => event.preventDefault());
input?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const current = ++generation;
  const query = input.value.trim();
  results?.replaceChildren();
  if (!searchStatus || !results) return;
  if (!query) { searchStatus.textContent = 'Search guides and versioned technical references.'; return; }
  searchStatus.textContent = 'Searching…';
  searchTimer = setTimeout(async () => {
    try {
      const modulePath = '/pagefind/pagefind.js';
      searchModule ||= import(/* @vite-ignore */ modulePath).catch(error => { searchModule = undefined; throw error; });
      const pagefind = await searchModule;
      const response = await pagefind.search(query);
      const matches = await Promise.all(response.results.slice(0, 8).map(result => result.data()));
      if (current !== generation) return;
      searchStatus.textContent = matches.length ? `${response.results.length} result${response.results.length === 1 ? '' : 's'}.` : 'No results. Try a shorter term or browse the documentation.';
      for (const match of matches) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        const url = new URL(match.url, location.origin);
        if (url.origin !== location.origin) continue;
        link.href = url.pathname + url.hash;
        const title = document.createElement('span');
        title.textContent = match.meta.title || 'Documentation';
        const excerpt = document.createElement('p');
        const parsed = new DOMParser().parseFromString(match.excerpt, 'text/html');
        excerpt.textContent = parsed.body.textContent;
        link.append(title, excerpt);
        item.append(link);
        results.append(item);
      }
    } catch {
      if (current === generation) searchStatus.textContent = 'Search index unavailable. Browse all documentation below. Local development search needs a production build.';
    }
  }, 140);
});
