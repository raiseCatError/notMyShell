import { test, expect } from '@playwright/test';
import launch from '../../src/data/launch.json' with { type: 'json' };

test('docs navigation keeps the sidebar stable and leaves history and anchors native', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/docs/reference/architecture/');
  const sidebar = page.locator('.docs-sidebar');
  const position = await sidebar.evaluate(element => {
    const link = element.querySelector('a[href="/docs/reference/context-modules/"]');
    window.scrollTo(0, 800);
    element.scrollTop = link.offsetTop - 250;
    return element.scrollTop;
  });
  expect(position).toBeGreaterThan(200);
  const destination = sidebar.locator('a[href="/docs/reference/context-modules/"]');
  await destination.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/docs\/reference\/context-modules\/$/);
  await expect.poll(() => sidebar.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
  await expect(sidebar.locator('[aria-current="page"]')).toHaveText('Context modules and packs');
  expect(await sidebar.evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('auto');

  await page.evaluate(() => window.scrollTo(0, 600));
  await sidebar.locator('[aria-current="page"]').click();
  expect(await page.evaluate(() => scrollY)).toBe(600);

  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/reference\/architecture\/$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(800);
  await page.goForward();
  await expect(page).toHaveURL(/\/docs\/reference\/context-modules\/$/);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(600);

  await page.goto('/docs/getting-started/#try-a-familiar-command');
  await expect(page).toHaveURL(/#try-a-familiar-command$/);
  const headingTop = await page.locator('#try-a-familiar-command').evaluate(element => element.getBoundingClientRect().top);
  expect(headingTop).toBeGreaterThanOrEqual(75);
  expect(headingTop).toBeLessThan(150);
});

test('docs remain usable with blocked session storage', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
  });
  await page.goto('/docs/getting-started/');
  await page.locator('.docs-sidebar').getByRole('link', { name: 'Composer and input', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Composer and input');
  await expect(page.locator('.docs-sidebar [aria-current="page"]')).toHaveText('Composer and input');
});

test('branding, product hook and footer use the refined product voice', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('A richer way to use the terminal.');
  await expect(page.locator('.brand [data-brand-vespyr]')).toHaveCount(1);
  await expect(page.locator('.brand img[src="/brand/nmsh-logo.png"]')).toHaveCount(0);
  await expect(page.locator('.brand')).toContainText('notMyShell');
  await expect(page.locator('.site-footer')).toContainText('Made with curiosity, care, and a few strong opinions about terminals.');
});

test('search keyboard controls and modal geometry stay deliberate as results change', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  const input = page.getByRole('searchbox', { name: 'Search documentation' });
  await expect(input).toBeFocused();
  await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const inputTop = (await input.boundingBox()).y;
  expect(await dialog.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBeLessThanOrEqual(3);
  expect(await input.evaluate(element => parseFloat(getComputedStyle(element).borderRadius))).toBe(0);
  await input.fill('shell');
  await expect(page.locator('#search-results a').first()).toBeVisible();
  expect((await input.boundingBox()).y).toBeCloseTo(inputTop, 0);
  const bounds = await dialog.boundingBox();
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize().height - 16);
  await page.locator('.search-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.search-footer')).toBeInViewport();
  await page.mouse.click(8, 8);
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Search documentation' })).toBeFocused();
});

test('motion is progressive, restrained and absent from docs or reduced-motion mode', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect.poll(() => page.locator('.hero h1').evaluate(element => getComputedStyle(element).animationName)).not.toBe('none');
  await expect(page.locator('[data-reveal]')).toHaveCount(0);
  const section = page.locator('.split-copy').last();
  expect(await section.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.locator('.hero h1').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  expect(await page.locator('.hero h1').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/docs/getting-started/');
  expect(await page.locator('.doc-heading').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(page.locator('[data-reveal]')).toHaveCount(0);
});

test('production metadata points to real social artwork and transparent Vespyr tab icons', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://nmsh.raisecaterror.com/brand/social-preview.png');
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image');
  if (launch.state === 'candidate') await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  else await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  const dimensions = await page.evaluate(() => new Promise(resolve => {
    const artwork = new Image();
    artwork.onload = () => resolve([artwork.naturalWidth, artwork.naturalHeight]);
    artwork.onerror = () => resolve([]);
    artwork.src = '/brand/social-preview.png';
  }));
  expect(dimensions).toEqual([1200, 630]);
  const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(icons).toContain('/brand/favicon.svg');
  for (const path of icons) {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toMatch(/^image\//);
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.getByRole('button', { name: 'Search documentation' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
});
