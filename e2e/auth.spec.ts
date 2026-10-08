import { apiAs, expect, expectCentered, expectNoEmDash, openAs, PASSWORD, test } from './support';

/** Вход: шаңырақ собирает окно, ошибки понятны, временный пароль меняется до работы. */
test.describe('вход в систему', () => {
  test('окно входа собирается по центру; вход ведёт на главную роли', async ({ page }) => {
    await page.goto('/login');
    // Клавиша без буквы досрочно заканчивает сборку и ничего не печатает.
    await page.keyboard.press('Shift');
    const card = page.getByRole('region', { name: 'Вход' });
    await expect(card).toBeVisible();
    await expectCentered(page, card, 'входа');
    await expect(page.getByLabel('Логин')).toBeFocused();
    await expectNoEmDash(page, 'входа');
    await page.getByLabel('Логин').fill('reception');
    await page.getByLabel('Пароль').fill(PASSWORD);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.locator('header.topbar')).toBeVisible();
  });

  test('буква, нажатая во время сборки, уходит в логин', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.type('own');
    await expect(page.getByLabel('Логин')).toHaveValue('own');
  });

  test('неверный пароль: понятный отказ, вход не происходит', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Shift');
    await page.getByLabel('Логин').fill('reception');
    await page.getByLabel('Пароль').fill('не-тот-пароль');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toHaveText('');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('пустая форма: подсказка, а не запрос на сервер', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Shift');
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Введите логин и пароль');
  });

  test('выход закрывает сессию: назад в приложение без входа не попасть', async ({ page }) => {
    await openAs(page, 'reception', '/today');
    await page.getByRole('button', { name: /Жансая/ }).click();
    await page.getByRole('menuitem', { name: 'Выйти' }).or(page.getByRole('button', { name: 'Выйти' })).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('тема: только солнце и луна, переключение меняет всю страницу', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/login');
    await page.keyboard.press('Shift');
    const sw = page.getByRole('switch').first();
    await expect(sw).toBeVisible();
    await expect(sw).not.toContainText(/день|ночь/i);
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await sw.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).not.toBe(before);
    await sw.click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(before);
  });

  test('временный пароль: сначала свой пароль, потом работа', async ({ page }) => {
    const owner = await apiAs('owner');
    const login = `e2e.first.${Date.now()}`;
    const hired = await owner.post('/staff', { fullName: 'Айжан Первая', login, positionName: 'Горничная' });
    expect(hired.status).toBe(201);
    const temp = hired.body.secrets.temporaryPassword as string;
    await owner.dispose();

    await page.goto('/login');
    await page.keyboard.press('Shift');
    await page.getByLabel('Логин').fill(login);
    await page.getByLabel('Пароль').fill(temp);
    await page.getByRole('button', { name: 'Войти' }).click();
    await expect(page.getByRole('heading', { name: 'Айжан, придумайте пароль' })).toBeVisible();
    // В приложение до смены пароля не пускает.
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login$/);
    const form = page.getByRole('region', { name: 'Новый пароль' });
    // После перезагрузки временный пароль не помнится: форма просит его снова.
    await form.getByLabel('Временный пароль').fill(temp);
    await form.getByLabel('Новый пароль').fill('коротко');
    await form.getByLabel('Ещё раз').fill('коротко');
    await page.getByRole('button', { name: 'Сохранить и войти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Пароль - не короче 8 знаков');
    await form.getByLabel('Новый пароль').fill('свой-пароль-123');
    await form.getByLabel('Ещё раз').fill('свой-пароль-123');
    await page.getByRole('button', { name: 'Сохранить и войти' }).click();
    // Горничной открыты только её уборки.
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole('heading', { name: 'Мои уборки' })).toBeVisible();
  });
});
