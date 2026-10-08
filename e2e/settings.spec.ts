import { dialog, expect, openAs, test } from './support';

/** Настройки: правила, номерной фонд, тарифы и вторая гостиница сети. */
test('правила гостиницы: изменить, сохранить, вернуть', async ({ page }) => {
  await openAs(page, 'owner', '/settings');
  await page.getByRole('tab', { name: 'Правила' }).click();
  const breakfast = page.getByLabel('Завтрак за гостя в сутки');
  const before = await breakfast.inputValue();
  await breakfast.fill('3 500');
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Правила' }).click();
  await expect(page.getByLabel('Завтрак за гостя в сутки')).toHaveValue(/^3\s500$/);
  await page.getByLabel('Завтрак за гостя в сутки').fill(before);
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены')).toBeVisible();
  // Ошибка ввода видна сразу и не даёт сохранить мусор.
  await page.getByLabel('Скидка без согласования, до').fill('150');
  await expect(page.getByText('От 0 до 100')).toBeVisible();
});

test('причины: добавить свою, дубль не пропустит', async ({ page }) => {
  await openAs(page, 'owner', '/settings');
  await page.getByRole('tab', { name: 'Причины' }).click();
  const block = page.locator('section', { has: page.getByRole('heading', { name: 'Причины отмены брони' }) });
  await block.getByLabel('Новая причина').fill('e2e: гость нашёл дешевле');
  await block.getByRole('button', { name: 'Добавить' }).click();
  await expect(block.getByText('e2e: гость нашёл дешевле')).toBeVisible();
  await block.getByLabel('Новая причина').fill('E2E: гость нашёл дешевле');
  await expect(block.getByText('Такая причина уже есть')).toBeVisible();
  await page.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.getByText('Настройки сохранены')).toBeVisible();
});

test('номерной фонд и тариф во второй гостинице сети; переключение гостиниц', async ({ page }) => {
  const stamp = Date.now().toString().slice(-5);
  const hotel = `Bizdin Auyl Түркістан ${stamp}`;
  await openAs(page, 'owner', '/settings');
  await page.getByRole('button', { name: 'Добавить гостиницу' }).click();
  const add = dialog(page, 'Новая гостиница сети');
  await add.getByLabel('Название').fill(hotel);
  await add.getByRole('button', { name: 'Добавить' }).click();
  await expect(page.getByText(`Гостиница «${hotel}» добавлена`)).toBeVisible();
  await expect(page.getByRole('button', { name: /Бауыржан Есенов/ })).toBeVisible();

  // Новая гостиница пуста: заводим тип, номер, тариф и цену.
  await page.getByRole('tab', { name: 'Номера' }).click();
  await page.getByRole('button', { name: 'Добавить тип' }).click();
  let d = dialog(page, 'Новый тип номера');
  await d.getByLabel('Название').fill('Стандарт');
  await d.getByLabel('Код').fill('std');
  await d.getByRole('button', { name: 'Добавить тип' }).click();
  await expect(page.getByText('Тип «Стандарт» добавлен')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить номер' }).click();
  d = dialog(page, 'Новый номер');
  await d.getByLabel('Номер').fill('101');
  await d.getByLabel(/Этаж/).fill('1');
  await d.getByRole('button', { name: 'Добавить номер' }).click();
  await expect(page.getByText('Номер 101 добавлен')).toBeVisible();

  await page.getByRole('tab', { name: 'Тарифы' }).click();
  await page.getByRole('button', { name: 'Новый тариф' }).click();
  d = dialog(page, 'Новый тариф');
  await d.getByLabel('Название').fill('Базовый');
  await d.getByLabel('Код').fill('bar');
  await d.getByRole('button', { name: 'Создать тариф' }).click();
  await expect(page.getByText('Тариф «Базовый» создан')).toBeVisible();
  await page.getByRole('button', { name: 'Добавить цену' }).click();
  d = dialog(page, /Базовый · новая цена/);
  await d.getByLabel('Цена за ночь').fill('18 000');
  await d.getByRole('button', { name: 'Добавить цену' }).click();
  await expect(page.getByText('Цена добавлена')).toBeVisible();
  await expect(page.locator('table').getByText('18 000')).toBeVisible();

  // Переключение: меню под именем - другая гостиница - её данные.
  await page.getByRole('button', { name: /Бауыржан Есенов/ }).click();
  await expect(page.getByRole('menuitem', { name: hotel })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('menuitem', { name: 'Bizdin Auyl', exact: true }).click();
  await expect(page).toHaveURL(/\/today$/);
  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Номера' }).click();
  // В первой гостинице номеров много, а не один.
  await expect(page.locator('tbody tr').nth(5)).toBeVisible();
});
