import { expect, PASSWORD, test } from './support';

/**
 * Первый запуск на пустой базе: вместо входа - регистрация гостиницы и её
 * владельца. Владелец сразу внутри и дальше заводит людей сам.
 */
test('регистрация гостиницы и владельца на пустой базе', async ({ page }) => {
  await page.goto('/login');
  await page.keyboard.press('Shift');
  const card = page.getByRole('region', { name: 'Регистрация гостиницы' });
  await expect(card).toBeVisible();
  await page.getByLabel('Название гостиницы').fill('Bizdin Auyl Алматы');
  await page.getByLabel('Ваши имя и фамилия').fill('Ерлан Сапаров');
  await page.getByLabel(/Телефон/).fill('+7 701 555 12 34');
  await page.getByLabel('Логин').fill('erlan');
  await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Ещё раз').fill(PASSWORD);
  await page.getByRole('button', { name: 'Зарегистрировать' }).click();
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.getByRole('button', { name: /Ерлан Сапаров/ })).toBeVisible();

  // Регистрация одна: повторно форма не появляется.
  const again = await page.request.get('/api/v1/setup');
  expect((await again.json()).needed).toBe(false);

  // Владелец сразу видит людей и может нанять первого сотрудника.
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Сотрудники' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Нанять/ })).toBeVisible();
});
