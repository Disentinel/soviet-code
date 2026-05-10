import { test, expect } from '@playwright/test';

test('homepage opens with status 200', async ({ request }) => {
  const response = await request.get('/');
  expect(response.status()).toBe(200);
});

test('page title contains "Soviet Code"', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Soviet Code/);
});

test('ГАЗЕТА nav link points to /gazeta/', async ({ page }) => {
  await page.goto('/');
  const gazetaLink = page.locator('a', { hasText: 'ГАЗЕТА' }).first();
  await expect(gazetaLink).toHaveAttribute('href', /\/gazeta\//);
});

test('/gazeta/ opens and lists at least one issue', async ({ page }) => {
  await page.goto('/gazeta/');
  await expect(page).toHaveURL(/\/gazeta\//);
  const issues = page.locator('.gz-issue');
  await expect(issues.first()).toBeVisible();
});

test('/gazeta/001.html opens', async ({ page }) => {
  await page.goto('/gazeta/001.html');
  expect(await page.title()).toBeTruthy();
  await expect(page.locator('body')).toBeVisible();
});

test('mobile viewport (375px) — /mobile-staging/ has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/mobile-staging/');
  // Check if the user can actually scroll horizontally (some elements overflow their
  // clipping parents but the page itself is not scrollable)
  const canScrollHorizontally = await page.evaluate(() => {
    window.scrollTo(9999, 0);
    return window.scrollX > 0;
  });
  expect(canScrollHorizontally).toBe(false);
});

test('favicon link is present in head', async ({ page }) => {
  await page.goto('/');
  const favicon = page.locator('head link[rel="icon"]').first();
  await expect(favicon).toHaveCount(1);
});

test('og:image meta tag is present in head', async ({ page }) => {
  await page.goto('/');
  const ogImage = page.locator('head meta[property="og:image"]');
  await expect(ogImage).toHaveCount(1);
  const content = await ogImage.getAttribute('content');
  expect(content).toBeTruthy();
});
