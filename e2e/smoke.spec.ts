import { dialog, expect, expectCentered, expectNoSideScroll, PASSWORD, test } from './support';

/**
 * Дымовой прогон в каждом браузере и на телефонах: Chromium, Firefox, Safari
 * (WebKit), iPhone и Android. Главное должно работать везде одинаково.
 */
test('вход, главная, карточка брони по центру, тема - в этом браузере', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Shift');
  const card = page.getByRole('region', { name: 'Вход' });
  await expect(card).toBeVisible();
  await expectNoSideScroll(page, 'вход');
  await page.getByLabel('Логин').fill('senior');
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('header.topbar')).toBeVisible();
  await expectNoSideScroll(page, 'сегодня');

  // Меню: на телефоне - кнопка «Меню», на компьютере - разделы в шапке.
  const width = page.viewportSize()!.width;
  if (width <= 760) {
    await page.getByRole('button', { name: 'Меню' }).click();
    await page.getByRole('dialog', { name: 'Меню' }).getByRole('link', { name: 'Брони' }).click();
  } else {
    await page.getByRole('navigation', { name: 'Разделы' }).getByRole('link', { name: 'Брони' }).click();
  }
  await expect(page).toHaveURL(/\/bookings/);
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.locator('tbody tr').first().click();
  const booking = dialog(page, /^Бронь \d+$/);
  await expectCentered(page, booking, 'брони');
  await expectNoSideScroll(page, 'карточка брони');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.goto('/tape');
  await expect(page.locator('h1').first()).toBeVisible();
  await expectNoSideScroll(page, 'шахматка');
});
