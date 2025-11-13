import { test, expect } from '@playwright/test';
// Disable auth overlay for E2E tests by faking a signed-in state

const disableAuth = async (page) => {
  await page.addInitScript(() => {
    // Force-hide auth overlay and allow main content when signed-out in tests
    const style = document.createElement('style');
    style.textContent = `#auth-overlay{display:none!important;opacity:0!important;pointer-events:none!important} body.signed-out main{display:block!important} body.signed-out #pager{display:block!important}`;
    (document.head || document.documentElement).appendChild(style);
    // Prevent Firebase from attempting network/auth in tests
    Object.defineProperty(window, 'firebaseConfig', { value: undefined, writable: true });
    window.Firebase = window.Firebase || {};
    window.Firebase.init = async () => { /* no-op in tests */ };
  });
};



test.describe('Library Tracker smoke', () => {
  test.beforeEach(async ({ page }) => { await disableAuth(page); });
  test('loads and paginates', async ({ page }) => {
    await page.goto('/');
    // Ensure auth overlay is gone in case app tried to show it
    await page.evaluate(() => { document.getElementById('auth-overlay')?.remove(); document.body.classList.remove('signed-out'); });
    await expect(page.getByRole('heading', { name: 'Library Tracker' })).toBeVisible();
    // Seed a book so we always have at least one card
    await page.evaluate(async () => {
      const b = { isbn13: '9780143127796', title: 'Candide', authors: ['Voltaire'], addedAt: Date.now(), borrowHistory: [], coverUrl: 'https://placehold.co/320x480?text=Candide' };
      await window.Storage.putBook(b);
    });
    await expect(page.locator('article.book-card').first()).toBeVisible();

    // Try pagination next then prev
    const next = page.getByRole('button', { name: 'Next page' });
    if (await next.isVisible() && !(await next.isDisabled())) {
      await next.click();
      await page.waitForTimeout(200);
      const prev = page.getByRole('button', { name: 'Previous page' });
      await prev.click();
    }
  });

  test('open modal from a seeded book (deterministic)', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { document.getElementById('auth-overlay')?.remove(); document.body.classList.remove('signed-out'); });
    // Seed a book directly via Storage to avoid network flakiness
    await page.evaluate(async () => {
      const b = { isbn13: '9780143127796', title: 'Candide', authors: ['Voltaire'], addedAt: Date.now(), borrowHistory: [], coverUrl: 'https://placehold.co/320x480?text=Candide' };
      await window.Storage.putBook(b);
    });
    // Wait for shelves to render
    await page.waitForFunction(() => !!document.querySelector('article.book-card[data-isbn="9780143127796"]'), null, { timeout: 8000 });
    // Click the card to open modal
    await page.locator('article.book-card[data-isbn="9780143127796"]').first().click();
    await expect(page.locator('#book-modal[aria-hidden="false"], #book-modal:not([aria-hidden])')).toBeVisible({ timeout: 5000 });
  });
});
