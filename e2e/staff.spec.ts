import { apiAs, dialog, expect, openAs, PASSWORD, test } from './support';

/**
 * Люди: владелец нанимает (должность из списка или новая прямо в поле),
 * выдаёт пароль и PIN один раз, права - по должности; уволенный не входит.
 */
test('найм с новой должностью, первый вход, увольнение', async ({ page, browser }) => {
  const stamp = Date.now().toString().slice(-6);
  const login = `e2e.hire.${stamp}`;
  await openAs(page, 'owner', '/staff');
  await page.getByRole('button', { name: 'Нанять' }).click();
  const hire = dialog(page, 'Новый сотрудник');
  await hire.getByLabel('Имя и фамилия').fill('Дана Тестовая');
  await hire.getByLabel('Логин').fill(login);
  const position = hire.getByRole('combobox');
  await position.fill(`Ночной портье ${stamp}`);
  await hire.getByRole('option', { name: `Новая должность: «Ночной портье ${stamp}»` }).click();
  // У новой должности прав нет, пока их не дали: открываем «Брони» на просмотр.
  await expect(hire.getByRole('heading', { name: 'Права' })).toBeVisible();
  await hire.getByRole('button', { name: 'Нанять' }).click();

  const secrets = dialog(page, 'Передайте: Дана Тестовая');
  await expect(secrets).toBeVisible();
  await expect(secrets.getByText(login)).toBeVisible();
  const temp = (await secrets.locator('dd.mono').nth(1).innerText()).trim();
  expect(temp).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}$/i);
  await page.keyboard.press('Escape');

  // Первый вход новенькой: свой пароль.
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: 'ru-RU', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('/login');
  await p.keyboard.press('Shift');
  await p.getByLabel('Логин').fill(login);
  await p.getByLabel('Пароль').fill(temp);
  await p.getByRole('button', { name: 'Войти' }).click();
  const form = p.getByRole('region', { name: 'Новый пароль' });
  await form.getByLabel('Новый пароль').fill(PASSWORD);
  await form.getByLabel('Ещё раз').fill(PASSWORD);
  await p.getByRole('button', { name: 'Сохранить и войти' }).click();
  // Без прав - только кабинет.
  await expect(p).toHaveURL(/\/profile$/);
  await ctx.close();

  // Увольнение: с причиной, после - вход закрыт. Карточка новенькой открыта сразу после найма.
  const card = dialog(page, /Дана Тестовая/);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Действия' }).click();
  await page.getByRole('menuitem', { name: 'Уволить' }).click();
  const fire = dialog(page, /Уволить · Дана Тестовая/);
  await fire.getByLabel('Причина').fill('Испытательный срок не пройден');
  await fire.getByRole('button', { name: /Уволить/ }).last().click();
  await expect(page.getByText('Увольнение оформлено: Дана Тестовая')).toBeVisible();

  const res = await page.request.post('/api/v1/auth/login', { data: { login, password: PASSWORD, client: 'mobile' } });
  expect(res.status()).toBe(401);
});

test('права закрывают разделы: горничная не попадает в кассу ни ссылкой, ни через API', async ({ page }) => {
  await openAs(page, 'maid', '/tasks');
  for (const path of ['/cash', '/bookings', '/staff', '/settings', '/reports']) {
    await page.goto(path);
    await expect(page, `${path} закрыт горничной`).toHaveURL(/\/tasks$/);
  }
  const maid = await apiAs('maid');
  for (const path of ['/cash', '/bookings', '/staff', '/reports/daily', '/guests']) {
    const r = await maid.raw(path);
    expect(r, `API ${path}`).toBe(403);
  }
  await maid.dispose();
});
