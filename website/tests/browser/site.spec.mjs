import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('home explains the product, pending media and released version', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Your shell.');
  await expect(page.getByRole('link', { name: 'Get started', exact: true }).first()).toHaveAttribute('href', '/install/');
  await expect(page.locator('[data-media="home-overview"]')).toContainText('Media pending');
  await expect(page.locator('[data-media] img, [data-media] video')).toHaveCount(0);
  await expect(page.getByText('v0.18.0', { exact: false }).first()).toBeVisible();
});

test('theme persists and remains usable when local storage is blocked', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new Error('Blocked'); }; });
  await page.reload();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('local docs search returns useful results and closes back to its trigger', async ({ page }) => {
  await page.goto('/docs/');
  const trigger = page.getByRole('button', { name: 'Search documentation' });
  await trigger.click();
  await page.getByRole('searchbox', { name: 'Search documentation' }).fill('Theme Bridge');
  await expect(page.locator('#search-results a').first()).toBeVisible();
  await expect(page.locator('#search-results')).toContainText(/theme/i);
  await page.getByRole('searchbox').fill('zzzznoresultxyz');
  await expect(page.locator('#search-status')).toContainText('No results');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test('copy succeeds and failure gives honest manual instructions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/install/');
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  await expect(page.locator('#feedback')).toContainText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('brew install');
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Denied'); }; });
  await page.getByRole('button', { name: 'Copy code' }).first().click();
  await expect(page.locator('#feedback')).toContainText('Select');
});

test('desktop, tablet and mobile preserve layout, links and accessible navigation', async ({ page }) => {
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ['/', '/features/', '/docs/context/', '/docs/reference/context-modules/', '/learn/']) {
      await page.goto(path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  }
  await page.locator('.mobile-menu summary').click();
  await page.locator('.mobile-menu').getByRole('link', { name: 'Docs', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\//);
  await page.locator('.docs-mobile summary').click();
  await page.locator('.docs-mobile').getByRole('link', { name: 'Composer and input', exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/composer\//);
});

test('planned learning is explicit and documentation works without JavaScript', async ({ browser, page }) => {
  await page.goto('/learn/');
  await expect(page.getByText('Planned · Future Learn Mode', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /proposal.*398/i })).toHaveAttribute('href', 'https://github.com/raiseCatError/notMyShell/issues/398');
  await expect(page.locator('main')).toContainText('temporary folder');
  const context = await browser.newContext({ javaScriptEnabled: false });
  const plain = await context.newPage();
  await plain.goto('http://127.0.0.1:4321/docs/');
  await plain.locator('.docs-index').getByRole('link', { name: 'Getting started', exact: true }).click();
  await expect(plain.getByRole('heading', { level: 1 })).toHaveText('Getting started');
  await context.close();
});

test('reduced motion, skip link and both themes pass automated accessibility checks', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['dark', 'light']) {
    for (const path of ['/', '/install/', '/docs/getting-started/', '/learn/', '/docs/reference/context-modules/']) {
      await page.goto(path);
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      expect(result.violations, `${theme} ${path}: ${JSON.stringify(result.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })))}`).toEqual([]);
    }
  }
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
});

test('compact contents, heading permalinks, missing search data and 404 remain useful', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/docs/getting-started/');
  await page.locator('.toc-mobile summary').click();
  await page.locator('.toc-mobile').getByRole('link', { name: 'Try a familiar command', exact: true }).click();
  await expect(page).toHaveURL(/#try-a-familiar-command$/);
  await page.locator('#try-a-familiar-command .heading-anchor').click();
  await expect(page).toHaveURL(/#try-a-familiar-command$/);
  await page.route('**/pagefind/**', route => route.abort());
  await page.getByRole('button', { name: 'Search documentation' }).click();
  await page.getByRole('searchbox').fill('sessions');
  await expect(page.locator('#search-status')).toContainText('Search index unavailable');
  await page.getByRole('button', { name: 'Close Esc' }).click();
  const response = await page.goto('/no-such-nmsh-page/');
  expect(response.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A small detour.');
});
