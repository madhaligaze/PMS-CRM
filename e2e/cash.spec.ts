import { apiAs, dialog, expect, openAs, test } from './support';

/**
 * Касса: смена открывается после отметки прихода и принимает остаток,
 * закрывается Z-отчётом; расхождение без комментария не закрыть.
 */
test('смена: приход, открытие, внесение, выемка, Z-отчёт с расхождением', async ({ page }) => {
  // Если смену кто-то оставил открытой - закрываем её по API без расхождения.
  const senior = await apiAs('senior');
  const now = await senior.get('/cash');
  if (now.shift) {
    const closed = await senior.post(`/cash/shifts/${now.shift.id}/close`, { countedCash: now.report.expectedCash });
    expect(closed.status).toBe(200);
  }
  await senior.dispose();

  await openAs(page, 'reception2', '/cash');
  await expect(page.getByRole('heading', { name: 'Смена закрыта' })).toBeVisible();
  const clock = page.getByRole('button', { name: 'Отметить приход' });
  if (await clock.isVisible()) {
    await clock.click();
    await expect(page.getByText('Приход отмечен')).toBeVisible();
  }
  await page.getByRole('button', { name: /открыть смену/i }).click();
  await expect(page.getByText(/Смена \d+ открыта/)).toBeVisible();

  await page.getByRole('button', { name: 'Внесение' }).click();
  let d = dialog(page, 'Внесение наличных');
  await d.getByLabel('Сумма').fill('5000');
  await d.getByLabel('Откуда').fill('Размен из сейфа');
  await d.getByRole('button', { name: 'Провести внесение' }).click();
  await expect(page.getByText('Внесение проведено')).toBeVisible();

  await page.getByRole('button', { name: 'Выемка' }).click();
  d = dialog(page, 'Выемка наличных');
  await d.getByLabel('Сумма').fill('2000');
  await d.getByLabel('Кому сдано').fill('Сдано бухгалтеру');
  await d.getByRole('button', { name: 'Провести выемку' }).click();
  await expect(page.getByText('Выемка проведена')).toBeVisible();

  const api = await apiAs('reception2');
  const expected = (await api.get('/cash')).report.expectedCash as number;
  await api.dispose();

  await page.getByRole('button', { name: 'Закрыть смену' }).click();
  d = dialog(page, /Закрыть смену \d+/);
  await d.getByLabel('Пересчитано').fill(String(expected / 100 - 100));
  const close = d.getByRole('button', { name: 'Закрыть смену, Z-отчёт' });
  await expect(d.getByText('Без комментария смену с расхождением не закрыть')).toBeVisible();
  await expect(close).toBeDisabled();
  await d.getByLabel(/Недостача/).fill('Сдача гостю без чека, разберёмся');
  await close.click();
  await expect(page.getByText(/Смена \d+ закрыта/)).toBeVisible();
  const report = dialog(page, /Z-отчёт · смена \d+/);
  await expect(report).toBeVisible();
  await expect(report.getByText('Расхождение')).toBeVisible();
  await expect(report.getByRole('button', { name: 'Печать' })).toBeVisible();
  await page.keyboard.press('Escape');

  // История смен: только что закрытая - сверху, с расхождением.
  await page.getByRole('tab', { name: /История смен|Мои смены/ }).click();
  await expect(page.locator('tbody tr').first()).toContainText('100');
});
