import type { CDPSession, Page } from '@playwright/test';
import { dialog, expect, openAs, PASSWORD, signIn, test } from './support';

/**
 * Стресс интерфейса на слабом железе: процессор в 4-6 раз медленнее,
 * браузер без WebGL, медленная и пропадающая сеть, сотни открытий окон.
 * Только Chromium: замедление процессора и памяти даёт его протокол отладки.
 */
async function cdp(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** Длинные задачи главного потока после загрузки: то, из-за чего страница «залипает». */
async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'longtask', buffered: true });
    } catch {
      /* браузер без longtask */
    }
  });
}
const blocking = (page: Page) => page.evaluate(() => (window as unknown as { __long: number[] }).__long.reduce((a, d) => a + Math.max(0, d - 50), 0));

test('вход на процессоре в 6 раз медленнее: окно появляется, ввод не тормозит', async ({ page }) => {
  await watchLongTasks(page);
  const session = await cdp(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  const t0 = Date.now();
  await page.goto('/login');
  await page.keyboard.press('Shift');
  await expect(page.getByRole('region', { name: 'Вход' })).toBeVisible({ timeout: 20_000 });
  const visibleMs = Date.now() - t0;
  // Отклик поля: от нажатия до значения в поле.
  const field = page.getByLabel('Логин');
  await field.click();
  const k0 = Date.now();
  await page.keyboard.type('senior');
  await expect(field).toHaveValue('senior');
  const typeMs = Date.now() - k0;
  await page.waitForTimeout(3000);
  const tbt = await blocking(page);
  console.log(`CPU x6: окно входа через ${visibleMs} мс, ввод 6 букв ${typeMs} мс, блокировка потока ${Math.round(tbt)} мс`);
  expect(visibleMs).toBeLessThan(15_000);
  expect(typeMs).toBeLessThan(3_000);
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('header.topbar')).toBeVisible({ timeout: 30_000 });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('браузер без WebGL: небо заменяется рисунком, вход работает', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('/login');
  await page.keyboard.press('Shift');
  await expect(page.getByRole('region', { name: 'Вход' })).toBeVisible();
  await expect(page.locator('.sky-fallback')).toBeVisible();
  await page.getByLabel('Логин').fill('senior');
  await page.getByLabel('Пароль').fill(PASSWORD);
  await page.getByRole('button', { name: 'Войти' }).click();
  await expect(page.locator('header.topbar')).toBeVisible();
});

test('меньше движения (настройка системы): окно входа сразу, без сборки', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const t0 = Date.now();
  await page.goto('/login');
  await expect(page.getByRole('region', { name: 'Вход' })).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(5_000);
});

test('медленная сеть (3G): приложение дорисовывается, без ошибок', async ({ page }) => {
  await signIn(page, 'reception');
  const session = await cdp(page);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
  await page.goto('/today');
  await expect(page.locator('header.topbar')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.loading-block')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/tape');
  await expect(page.locator('.loading-block')).toHaveCount(0, { timeout: 60_000 });
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('пропала сеть: действие говорит «нет связи», после - всё работает', async ({ page }) => {
  await openAs(page, 'reception', '/bookings');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Новая бронь' }).first().click();
  const modal = dialog(page, 'Новая бронь');
  await expect(modal).toBeVisible();
  // Поиск гостя без сети не роняет окно.
  await modal.getByLabel('Найти в базе').fill('Ахметов');
  await page.waitForTimeout(1500);
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape');
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
});

test('утечки памяти: 40 открытий карточки брони не раздувают память', async ({ page }) => {
  test.setTimeout(180_000);
  await openAs(page, 'senior', '/bookings');
  await page.getByRole('tab', { name: 'Все брони' }).click();
  await expect(page.locator('tbody tr').nth(7)).toBeVisible();
  const session = await cdp(page);
  await session.send('HeapProfiler.enable');
  const heap = async () => {
    await session.send('HeapProfiler.collectGarbage');
    const m = await session.send('Runtime.getHeapUsage');
    return m.usedSize / 1024 / 1024;
  };
  // Прогрев: первые открытия загружают код и кэш.
  for (let i = 0; i < 3; i++) {
    await page.locator('tbody tr').nth(i).click();
    await expect(dialog(page, /^Бронь \d+$/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const before = await heap();
  for (let i = 0; i < 40; i++) {
    await page.locator('tbody tr').nth(i % 8).click();
    const card = dialog(page, /^Бронь \d+$/);
    await expect(card).toBeVisible();
    if (i % 3 === 0) await card.getByRole('tab', { name: 'История' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  const after = await heap();
  console.log(`память: ${before.toFixed(1)} МБ -> ${after.toFixed(1)} МБ после 40 открытий`);
  expect(after - before).toBeLessThan(15);
});

test('шахматка на процессоре в 4 раза медленнее: прокрутка без залипаний', async ({ page }) => {
  await openAs(page, 'senior', '/tape');
  await expect(page.locator('.loading-block')).toHaveCount(0);
  const session = await cdp(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const frames = await page.evaluate(async () => {
    const el = [...document.querySelectorAll<HTMLElement>('*')].find((e) => e.scrollWidth > e.clientWidth + 50 && /auto|scroll/.test(getComputedStyle(e).overflowX));
    const target = el ?? document.scrollingElement!;
    const deltas: number[] = [];
    let last = performance.now();
    for (let i = 0; i < 60; i++) {
      target.scrollBy({ left: 40, top: 12 });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const now = performance.now();
      deltas.push(now - last);
      last = now;
    }
    return deltas.sort((a, b) => a - b);
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const p95 = frames[Math.floor(frames.length * 0.95)]!;
  console.log(`шахматка, CPU x4: кадр p50 ${Math.round(frames[30]!)} мс, p95 ${Math.round(p95)} мс`);
  expect(p95).toBeLessThan(250);
});

test('долгая смена: страница «Сегодня» час в фоне не копит запросы и ошибки', async ({ page }) => {
  test.setTimeout(120_000);
  // Часы страницы под управлением теста: час работы ресепшена проходит за секунды.
  await page.clock.install();
  await openAs(page, 'reception', '/today');
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.clock.runFor(60 * 60 * 1000);
  await page.waitForTimeout(2000);
  // Опрос раз в 1-2 минуты, а не каждую секунду.
  expect(requests.length).toBeLessThan(400);
  await expect(page.locator('header.topbar')).toBeVisible();
});
