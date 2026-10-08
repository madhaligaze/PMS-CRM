import { apiAs, dialog, expect, freeRoom, openAs, plusDays, test } from './support';

/**
 * Ремонт: поломка в номере снимает его с продажи; техник берёт заявку и
 * закрывает с комментарием, номер уходит в уборку, а не сразу в продажу.
 */
test('заявка с блокировкой номера: создать, взять, закрыть - номер в уборку', async ({ page, browser }) => {
  const senior = await apiAs('senior');
  const today = (await senior.get('')).businessDate as string;
  const room = await freeRoom(senior, today, plusDays(today, 3));
  await senior.dispose();

  await openAs(page, 'supervisor', '/housekeeping');
  await page.getByRole('button', { name: 'Сообщить о поломке' }).first().click();
  const d = dialog(page, 'Сообщить о поломке');
  await d.getByLabel('Где').selectOption({ label: `Номер ${room.number}` });
  await d.getByLabel('Что случилось').fill('e2e: течёт смеситель в ванной');
  await d.getByRole('radio', { name: 'Срочно', exact: true }).click();
  await d.getByText('Жить в номере нельзя: снять его с продажи до ремонта').click();
  const send = d.getByRole('button', { name: 'Отправить заявку' });
  await expect(send).toBeDisabled();
  await d.getByLabel('Не продавать до').fill(plusDays(today, 2));
  await send.click();
  await expect(page.getByText(/Заявка \d+ отправлена/)).toBeVisible();
  await expect(page.getByText(new RegExp(`Номер ${room.number} не продаётся до`))).toBeVisible();

  // Техник.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'ru-RU', timezoneId: 'Asia/Almaty', viewport: { width: 1440, height: 900 } });
  const tech = await ctx.newPage();
  const errors: string[] = [];
  tech.on('pageerror', (e) => errors.push(e.message));
  await openAs(tech, 'tech', '/maintenance');
  await tech.locator('tbody tr', { hasText: 'e2e: течёт смеситель в ванной' }).click();
  const card = dialog(tech, new RegExp(`Номер ${room.number}`));
  await card.getByRole('button', { name: 'Взять в работу' }).click();
  await expect(tech.getByText(/Заявка \d+ в работе/)).toBeVisible();
  await card.getByRole('button', { name: 'Готово, закрыть' }).click();
  const close = dialog(tech, /Закрыть заявку \d+/);
  await close.getByLabel('Что сделано').fill('Заменил картридж смесителя, протечки нет');
  await close.getByRole('button', { name: 'Закрыть заявку' }).click();
  await expect(tech.getByText(/Заявка \d+ закрыта/)).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();

  // Номер больше не на ремонте: в уборке и без блокировки.
  const api = await apiAs('senior');
  const after = (await api.get('/rooms')).find((r: { id: string }) => r.id === room.id);
  expect(after.hkStatus).toBe('dirty');
  const tape = await api.get(`/tape-chart?from=${today}&to=${plusDays(today, 3)}`);
  expect(tape.blocks.filter((b: { roomId: string }) => b.roomId === room.id)).toHaveLength(0);
  const tasks = await api.get('/housekeeping/tasks');
  expect(tasks.some((t: { roomId: string; note: string | null }) => t.roomId === room.id && (t.note ?? '').startsWith('После ремонта'))).toBe(true);
  await api.dispose();
});

test('горничная сообщает о поломке с телефона: заявка видна технику', async ({ page }) => {
  await openAs(page, 'maid', '/tasks');
  await page.getByRole('button', { name: 'Сообщить о поломке' }).first().click();
  const d = dialog(page, 'Сообщить о поломке');
  // Горничной блокировка номера не открыта.
  await expect(d.getByText('Жить в номере нельзя')).toHaveCount(0);
  await d.getByLabel('Где').selectOption({ index: 0 });
  await d.getByLabel('Место').fill('Прачечная, 1 этаж');
  await d.getByLabel('Что случилось').fill('e2e: не включается стиральная машина');
  await d.getByRole('button', { name: 'Отправить заявку' }).click();
  await expect(page.getByText(/Заявка \d+ отправлена/)).toBeVisible();

  const tech = await apiAs('tech');
  const open = await tech.get('/maintenance?status=open');
  expect(open.some((m: { title: string; location: string | null }) => m.title === 'e2e: не включается стиральная машина' && m.location === 'Прачечная, 1 этаж')).toBe(true);
  await tech.dispose();
});
