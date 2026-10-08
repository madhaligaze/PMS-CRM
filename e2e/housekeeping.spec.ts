import { devices } from '@playwright/test';
import { apiAs, dialog, expect, expectNoSideScroll, openAs, signIn, test } from './support';

/**
 * Хозслужба: супервайзер распределяет уборки за компьютером, горничная
 * убирает с телефона, супервайзер принимает номер - и он готов к заселению.
 */
test('уборка от назначения до приёмки: супервайзер и горничная с телефона', async ({ page, browser }) => {
  const sup = await apiAs('supervisor');
  const board = await sup.get('/housekeeping/board');
  const room = board.rooms.find((r: { occupancy: string; dnd: boolean; hkStatus: string; tasks: { status: string }[] }) =>
    (r.occupancy === 'free' || r.occupancy === 'occupied') && !r.dnd && r.hkStatus !== 'repair' && !r.tasks.some((t) => t.status === 'open' || t.status === 'in_progress'),
  );
  expect(room, 'номер без открытых задач').toBeTruthy();
  const created = await sup.post('/housekeeping/tasks', { roomId: room.id, kind: 'request', note: 'e2e: поменять полотенца' }, { 'Idempotency-Key': `e2e-hk-${Date.now()}` });
  expect(created.status).toBe(201);
  await sup.dispose();

  // Супервайзер: «Задачи» - «Без горничной» - назначить Гүлнар.
  await openAs(page, 'supervisor', '/housekeeping');
  await page.getByRole('tab', { name: /Задачи/ }).click();
  await page.getByRole('radio', { name: 'Без горничной' }).click();
  const row = page.locator('tbody tr', { hasText: 'e2e: поменять полотенца' });
  const maidApi = await apiAs('maid');
  const maidId = (await maidApi.get('/api/v1/me')).id as string;
  await maidApi.dispose();
  await row.getByRole('combobox').selectOption(maidId);
  await expect(page.getByText(`Номер ${room.number}: Гүлнар Иманғалиева`)).toBeVisible();

  // Горничная - с телефона.
  const phone = await browser.newContext({ ...devices['iPhone 13'], baseURL: test.info().project.use.baseURL, locale: 'ru-RU', timezoneId: 'Asia/Almaty' });
  const m = await phone.newPage();
  const errors: string[] = [];
  m.on('pageerror', (e) => errors.push(e.message));
  await signIn(m, 'maid');
  await m.goto('/tasks');
  await expect(m.getByRole('heading', { name: 'Мои уборки' })).toBeVisible();
  await expectNoSideScroll(m, 'мои уборки на телефоне');
  const card = m.locator('.mt-card', { hasText: 'e2e: поменять полотенца' });
  await card.getByRole('button', { name: 'Начать уборку' }).tap();
  await expect(m.getByText(`Номер ${room.number}: уборка начата`)).toBeVisible();
  await card.getByRole('button', { name: 'Закончить уборку' }).tap();
  await expect(m.getByText(`Номер ${room.number} убран`)).toBeVisible();
  expect(errors).toEqual([]);
  await phone.close();

  // Супервайзер принимает.
  await page.reload();
  await page.getByRole('tab', { name: /Задачи/ }).click();
  await page.getByRole('radio', { name: 'Проверить' }).click();
  const done = page.locator('tbody tr', { hasText: 'e2e: поменять полотенца' });
  await done.getByRole('button', { name: 'Принять' }).click();
  await expect(page.getByText(`Номер ${room.number} принят, можно заселять`)).toBeVisible();

  // На доске номер - «Проверен».
  await page.getByRole('tab', { name: 'Номера' }).click();
  await expect(page.locator('.hk-tile', { hasText: room.number }).first()).toContainText('Проверен');
});

test('возврат на доуборку: без причины не вернуть, горничная видит, что доделать', async ({ page }) => {
  const sup = await apiAs('supervisor');
  const maid = await apiAs('maid2');
  const board = await sup.get('/housekeeping/board');
  const maidId = (await maid.get('/api/v1/me')).id;
  const room = board.rooms.find((r: { occupancy: string; dnd: boolean; hkStatus: string; tasks: { status: string }[] }) =>
    r.occupancy !== 'blocked' && !r.dnd && r.hkStatus !== 'repair' && !r.tasks.some((t) => t.status === 'open' || t.status === 'in_progress'),
  );
  const t = await sup.post('/housekeeping/tasks', { roomId: room.id, kind: 'request', note: 'e2e: возврат', assigneeId: maidId }, { 'Idempotency-Key': `e2e-ret-${Date.now()}` });
  expect((await maid.post(`/housekeeping/tasks/${t.body.id}/start`)).status).toBe(200);
  expect((await maid.post(`/housekeeping/tasks/${t.body.id}/finish`, {})).status).toBe(200);
  await sup.dispose();

  await openAs(page, 'supervisor', '/housekeeping');
  await page.locator('.hk-tile', { hasText: room.number }).first().click();
  const modal = dialog(page, `Номер ${room.number}`);
  await modal.getByRole('button', { name: 'Вернуть' }).click();
  const ask = dialog(page, `Вернуть номер ${room.number} на доуборку`);
  const confirm = ask.getByRole('button', { name: 'Вернуть на доуборку' });
  await expect(confirm).toBeDisabled();
  await ask.getByLabel('Что доделать').fill('Пыль на подоконнике');
  await confirm.click();
  await expect(page.getByText(`Номер ${room.number} возвращён на доуборку`)).toBeVisible();

  const mine = await maid.get('/housekeeping/tasks?assignee=me');
  const back = mine.find((x: { id: string }) => x.id === t.body.id);
  expect(back.status).toBe('open');
  expect(back.note).toBe('Пыль на подоконнике');
  await maid.dispose();
});
