import { apiAs, dialog, ensureShift, expect, expectCentered, freeRoom, openAs, plusDays, test } from './support';

/** Брони: от звонка до выезда - так, как это делает администратор. */
test.describe('бронь', () => {
  test('новая бронь через окно: гость, даты, свободный номер, цена; отмена с причиной', async ({ page }) => {
    const api = await apiAs('reception');
    const today = (await api.get('')).businessDate as string;
    await api.dispose();
    const arrival = plusDays(today, 45);
    const departure = plusDays(today, 47);

    await openAs(page, 'reception', '/bookings');
    await page.getByRole('button', { name: 'Новая бронь' }).first().click();
    const modal = page.getByRole('dialog', { name: 'Новая бронь' });
    await expectCentered(page, modal, 'новой брони');
    await modal.getByLabel('Фамилия').fill('Тестова');
    await modal.getByLabel('Имя', { exact: true }).fill('Айгуль');
    await modal.getByLabel('Телефон').fill('+7 701 000 45 47');
    await modal.getByLabel('Заезд').fill(arrival);
    await modal.getByLabel('Выезд').fill(departure);
    const rooms = modal.getByRole('radiogroup', { name: 'Свободные номера' });
    await rooms.getByRole('radio').first().click();
    await expect(modal.getByRole('button', { name: 'Создать бронь' })).toBeEnabled();
    await modal.getByRole('button', { name: 'Создать бронь' }).click();

    await expect(page.getByText(/Бронь \d+ создана/)).toBeVisible();
    const card = dialog(page, /^Бронь \d+$/);
    await expect(card).toBeVisible();
    await expect(card.getByText('Тестова Айгуль').first()).toBeVisible();
    await expect(card.getByText('Предварительная')).toBeVisible();

    await card.getByRole('button', { name: 'Отменить бронь' }).click();
    const ask = dialog(page, /Отменить бронь \d+\?/);
    const confirm = ask.getByRole('button', { name: 'Отменить бронь' });
    await expect(confirm).toBeDisabled();
    await ask.getByRole('textbox', { name: 'Причина' }).fill('Гость передумал, тест');
    await confirm.click();
    await expect(card.getByText('Отменена')).toBeVisible();
  });

  test('двойное нажатие «Создать бронь» не создаёт двух броней', async ({ page }) => {
    const api = await apiAs('reception');
    const today = (await api.get('')).businessDate as string;
    const arrival = plusDays(today, 52);
    const departure = plusDays(today, 53);
    await openAs(page, 'reception', '/bookings');
    await page.getByRole('button', { name: 'Новая бронь' }).first().click();
    const modal = page.getByRole('dialog', { name: 'Новая бронь' });
    await modal.getByLabel('Фамилия').fill('Двойной');
    await modal.getByLabel('Имя', { exact: true }).fill('Клик');
    await modal.getByLabel('Заезд').fill(arrival);
    await modal.getByLabel('Выезд').fill(departure);
    await modal.getByRole('radiogroup', { name: 'Свободные номера' }).getByRole('radio').first().click();
    await expect(modal.getByRole('button', { name: 'Создать бронь' })).toBeEnabled();
    await modal.getByRole('button', { name: 'Создать бронь' }).dblclick();
    await expect(page.getByText(/Бронь \d+ создана/).first()).toBeVisible();
    await page.waitForTimeout(800);
    const list = await api.get(`/bookings?q=${encodeURIComponent('Двойной')}`);
    expect(list.items.filter((b: { arrival: string }) => b.arrival === arrival)).toHaveLength(1);
    await api.dispose();
  });

  test('цикл гостя: документ, согласие, заселение, оплата, выезд - всё из карточки', async ({ page }) => {
    const reception = await apiAs('reception');
    const supervisor = await apiAs('supervisor');
    const today = (await reception.get('')).businessDate as string;
    const room = await freeRoom(reception, today, plusDays(today, 1));
    const ratePlanId = (await reception.get('/rate-plans')).find((p: { code: string }) => p.code === 'BAR').id;
    const created = await reception.post(
      '/bookings',
      { guest: { lastName: 'Цикл', firstName: 'Сауле', phone: '+7 702 111 22 33' }, roomId: room.id, arrival: today, departure: plusDays(today, 1), ratePlanId, source: 'walk_in', status: 'confirmed' },
      { 'Idempotency-Key': `e2e-cycle-${Date.now()}` },
    );
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    // Номер проверен супервайзером - иначе заселять нельзя.
    await supervisor.post(`/rooms/${room.id}/hk-status`, { status: 'inspected' });
    await ensureShift(reception);
    await reception.dispose();
    await supervisor.dispose();

    await openAs(page, 'reception', `/today?booking=${id}`);
    const card = dialog(page, /^Бронь \d+$/);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Заселить' }).click();

    // 1. Документ.
    await card.getByLabel('Документ', { exact: true }).selectOption('id_card');
    await card.getByLabel('Номер документа').fill(String(Date.now()).slice(-9));
    await card.getByLabel('Дата рождения').fill('1992-04-15');
    await card.getByRole('button', { name: 'Сохранить данные гостя' }).click();
    await expect(page.getByText('Данные гостя сохранены')).toBeVisible();
    // 2. Согласие.
    await card.getByText('Гость подписал согласие на обработку персональных данных и правила проживания').click();
    await card.getByRole('button', { name: 'Отметить' }).click();
    await expect(page.getByText('Согласие отмечено')).toBeVisible();
    // 3-5. Заселение.
    const go = card.getByRole('button', { name: `Заселить в ${room.number}` });
    await expect(go).toBeEnabled();
    await go.click();
    await expect(page.getByText(`Заселение в номер ${room.number}: Цикл Сауле`)).toBeVisible();
    await expect(card.getByText('Проживает')).toBeVisible();

    // Оплата из счёта.
    await card.getByRole('tab', { name: /Счёт/ }).click();
    await card.getByRole('button', { name: 'Принять оплату' }).first().click();
    const pay = dialog(page, /Оплата по брони \d+/);
    await pay.getByRole('radio', { name: 'Карта' }).click();
    await pay.getByRole('button', { name: /^Провести/ }).click();
    await expect(page.getByText(/Оплата № \d+ проведена/)).toBeVisible();
    await expect(card.getByText('Оплачено').first()).toBeVisible();
  });

  test('выезд сегодня: доплата или возврат депозита, затем номер уходит в уборку', async ({ page }) => {
    const reception = await apiAs('reception');
    await ensureShift(reception);
    const departures = (await reception.get('/bookings?view=departures')).items as { id: string; status: string; roomNumber: string; guest: { fullName: string } }[];
    const b = departures.find((x) => x.status === 'checked_in');
    expect(b, 'в демо есть гость, который выезжает сегодня').toBeTruthy();
    await reception.dispose();

    await openAs(page, 'reception', `/today?booking=${b!.id}`);
    const card = dialog(page, /^Бронь \d+$/);
    await card.getByRole('button', { name: 'Выселить' }).click();
    await expect(card.getByText('Сверка счёта')).toBeVisible();
    const extra = card.getByRole('button', { name: 'Принять доплату' });
    if (await extra.isVisible()) {
      await extra.click();
      await dialog(page, /Оплата по брони/).getByRole('button', { name: /^Провести/ }).click();
      await expect(page.getByText(/Оплата № \d+ проведена/)).toBeVisible();
    }
    const deposit = card.getByRole('button', { name: 'Вернуть депозит' });
    if (await deposit.isVisible()) {
      await deposit.click();
      await dialog(page, /депозит/i).getByRole('button', { name: /^Провести/ }).click();
      await expect(page.getByText(/Депозит возвращён/)).toBeVisible();
    }
    const refund = card.getByRole('button', { name: 'Вернуть переплату' });
    if (await refund.isVisible()) {
      await refund.click();
      await dialog(page, /Возврат по брони/).getByRole('button', { name: /^Провести/ }).click();
      await expect(page.getByText(/Возврат № \d+ проведён/)).toBeVisible();
    }
    await card.getByRole('radio', { name: '5 отлично' }).click();
    const out = card.getByRole('button', { name: `Выселить, номер ${b!.roomNumber} в уборку` });
    await expect(out).toBeEnabled();
    await out.click();
    await expect(page.getByText(new RegExp(`Выезд из номера ${b!.roomNumber}`))).toBeVisible();
    await expect(card.getByText('Выезд оформлен').first()).toBeVisible();
  });
});
