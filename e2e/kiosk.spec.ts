import { apiAs, expect, expectNoSideScroll, PIN, test } from './support';

/** Планшет прихода: без входа в систему, по логину и PIN; неверный PIN не раскрывает, что именно неверно. */
test('отметка прихода на планшете: недавние логины, клавиатура PIN, отказ при неверном PIN', async ({ page }) => {
  const api = await apiAs('owner');
  const propertyId = api.propertyId;
  await api.dispose();
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(`/kiosk?p=${propertyId}`);
  await expect(page.getByText('Отметка прихода')).toBeVisible();
  await expectNoSideScroll(page, 'планшет');

  await page.getByLabel('Логин').fill('maid3');
  for (const d of '9999') await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Отметиться' }).click();
  await expect(page.getByRole('alert')).toHaveText('Неверный логин или PIN');

  for (const d of PIN) await page.getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Отметиться' }).click();
  const done = page.locator('.kiosk-done');
  await expect(done).toContainText(/Приход отмечен|Уход отмечен/);
  await expect(done).toContainText('Ақбота Серікбаева');

  // Следующий сотрудник: логин запомнился кнопкой.
  await page.getByRole('button', { name: 'Следующий' }).click();
  await expect(page.getByRole('button', { name: 'maid3' })).toBeVisible();
});

test('планшет без гостиницы объясняет, что делать', async ({ page }) => {
  await page.goto('/kiosk');
  await expect(page.getByRole('heading', { name: 'Планшет ещё не знает гостиницу' })).toBeVisible();
});
