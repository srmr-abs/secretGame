import { test, expect } from '@playwright/test';
test('player landing page presents the join flow accessibly', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /the truth is/i })).toBeVisible();
  await expect(page.getByLabel('GAME PIN')).toBeVisible();
  await expect(page.getByLabel('DISPLAY NAME')).toBeVisible();
  await expect(page.getByRole('button', { name: /join game/i })).toBeDisabled();
  await page.getByLabel('GAME PIN').fill('123456');
  await page.getByLabel('DISPLAY NAME').fill('Detective');
  await expect(page.getByRole('button', { name: /join game/i })).toBeEnabled();
});

test('pastes a formatted game PIN from the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3000' });
  await page.goto('/');
  await page.evaluate(() => navigator.clipboard.writeText('PIN: 012-345'));
  await page.getByRole('button', { name: 'Paste PIN' }).click();
  await expect(page.getByLabel('GAME PIN')).toHaveValue('012345');
});

test('admin sign-in view is accessible', async ({ page }) => {
  await page.goto('/admin/login');
  await expect(page.getByRole('heading', { name: /administrator sign in/i })).toBeVisible();
  await expect(page.getByLabel('EMAIL')).toBeVisible();
  await expect(page.getByLabel('PASSWORD')).toBeVisible();
});
