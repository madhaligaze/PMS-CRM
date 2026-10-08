import { expect, openAs, test } from './support';

/** Отчёты: день и период, график с подсказкой и таблицей, выгрузка оплат. */
test('отчёт за день и за период: числа, график, таблица, выгрузка CSV', async ({ page }) => {
  await openAs(page, 'owner', '/reports');
  await expect(page.getByText('Оплаты по способам')).toBeVisible();
  await expect(page.getByText(/загрузка, \d+ из \d+/)).toBeVisible();
  await page.getByRole('button', { name: 'Предыдущий день' }).click();
  await expect(page.getByText('Оплаты по способам')).toBeVisible();

  await page.getByRole('tab', { name: 'За период' }).click();
  const chart = page.getByRole('img', { name: /Загрузка по дням/ });
  await expect(chart).toBeVisible();
  // Подсказка по наведению и с клавиатуры.
  const box = (await chart.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await expect(page.locator('.cc-tip')).toBeVisible();
  await expect(page.locator('.cc-tip')).toContainText('загрузка');
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press('End');
  await expect(page.locator('.cc-tip')).toBeVisible();

  await page.getByRole('radio', { name: '7 дней' }).click();
  await expect(chart).toBeVisible();
  await page.getByRole('button', { name: 'Таблицей' }).click();
  await expect(page.locator('.rep-days tbody tr')).toHaveCount(7);
  await page.getByRole('button', { name: 'Графиком' }).click();

  await page.getByRole('tab', { name: 'Выгрузка' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^payments-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await download.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString('utf8');
  expect(text.split('\n')[0]).toContain('Сумма');
});
