import { test as base, expect, request as pwRequest, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/**
 * Общее для сквозных тестов. Каждый тест входит заново: refresh-токен
 * одноразовый, общий снимок входа на несколько тестов сервер справедливо
 * посчитал бы кражей сессии.
 */
export const PASSWORD = 'demo12345';
export const PIN = '1234';
export const API_URL = process.env.E2E_API ?? 'http://127.0.0.1:4100';

type Problems = { console: string[]; page: string[]; server: string[] };

/**
 * Каждый тест следит за страницей: исключение в JS, ответ 5xx или ошибка в
 * консоли - провал, даже если сам сценарий дошёл до конца.
 */
export const test = base.extend<{ problems: Problems }>({
  problems: [
    async ({ page }, use) => {
      const p: Problems = { console: [], page: [], server: [] };
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        // Ответы 4xx браузер пишет в консоль сам: это ожидаемые отказы API, тесты проверяют их отдельно.
        if (/status of 4\d\d/.test(text)) return;
        p.console.push(text);
      });
      page.on('pageerror', (e) => p.page.push(`${e.name}: ${e.message}`));
      page.on('response', (r) => {
        if (r.status() >= 500) p.server.push(`${r.status()} ${r.request().method()} ${r.url()}`);
      });
      await use(p);
      expect.soft(p.page, 'исключения JS на странице').toEqual([]);
      expect.soft(p.server, 'ответы сервера 5xx').toEqual([]);
      expect.soft(p.console, 'ошибки в консоли браузера').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Вход в браузере: cookie обновления ставит сервер, дальше приложение входит само. */
export async function signIn(page: Page, login: string, password = PASSWORD) {
  const res = await page.request.post('/api/v1/auth/login', { data: { login, password, client: 'web' }, headers: { 'X-Requested-With': 'fetch' } });
  expect(res.status(), `вход ${login}: ${await res.text()}`).toBe(200);
}

/** Открыть приложение сотрудником на нужной странице и дождаться шапки. */
export async function openAs(page: Page, login: string, path = '/') {
  await signIn(page, login);
  await page.goto(path);
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.locator('.boot')).toHaveCount(0);
}

export type Api = {
  token: string;
  propertyId: string;
  base: string;
  get: (path: string) => Promise<any>;
  /** Статус ответа без проверки: для отказов. */
  raw: (path: string) => Promise<number>;
  post: (path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  patch: (path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  dispose: () => Promise<void>;
};

/** Клиент API от имени сотрудника - готовить данные теста, не трогая интерфейс. */
export async function apiAs(login: string, password = PASSWORD): Promise<Api> {
  const ctx: APIRequestContext = await pwRequest.newContext({ baseURL: API_URL });
  const res = await ctx.post('/api/v1/auth/login', { data: { login, password, client: 'mobile' } });
  expect(res.status(), `API-вход ${login}`).toBe(200);
  const token = (await res.json()).accessToken as string;
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await ctx.get('/api/v1/me', { headers })).json();
  const propertyId = me.properties[0].id as string;
  const base = `/api/v1/properties/${propertyId}`;
  const url = (p: string) => (p.startsWith('/api/') ? p : base + p);
  const send = async (method: 'POST' | 'PATCH', path: string, body: unknown, extra: Record<string, string> = {}) => {
    const r = await ctx.fetch(url(path), { method, headers: { ...headers, ...extra }, data: body ?? {} });
    const text = await r.text();
    return { status: r.status(), body: text ? JSON.parse(text) : null };
  };
  return {
    token,
    propertyId,
    base,
    get: async (path) => {
      const r = await ctx.get(url(path), { headers });
      expect(r.status(), `GET ${path}`).toBe(200);
      return r.json();
    },
    raw: async (path) => (await ctx.get(url(path), { headers })).status(),
    post: (path, body, extra) => send('POST', path, body, extra),
    patch: (path, body, extra) => send('PATCH', path, body, extra),
    dispose: () => ctx.dispose(),
  };
}

export const plusDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Номер, свободный на даты, - по шахматке, как ищет администратор. */
export async function freeRoom(api: Api, arrival: string, departure: string): Promise<{ id: string; number: string }> {
  const tape = await api.get(`/tape-chart?from=${arrival}&to=${departure}`);
  const busy = new Set<string>([
    ...tape.bookings.filter((b: any) => b.arrival < departure && b.departure > arrival && !['cancelled', 'no_show'].includes(b.status)).map((b: any) => b.roomId),
    ...tape.blocks.filter((k: any) => k.startsOn < departure && k.endsOn > arrival).map((k: any) => k.roomId),
  ]);
  const room = tape.rooms.find((r: any) => r.isActive !== false && !busy.has(r.id));
  expect(room, `свободный номер на ${arrival} - ${departure}`).toBeTruthy();
  return { id: room.id, number: room.number };
}

/** Открытая кассовая смена: тесты оплат не зависят от того, кто закрыл кассу до них. */
export async function ensureShift(api: Api) {
  const cash = await api.get('/cash');
  if (cash.shift) return;
  if (!cash.clockedIn) await api.post('/attendance/clock', { kind: 'in' });
  const r = await api.post('/cash/shifts', {});
  expect([201, 409]).toContain(r.status);
}

/** Страница не ездит вбок ни на какой ширине. */
export async function expectNoSideScroll(page: Page, where = '') {
  const over = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scroll: doc.scrollWidth, view: window.innerWidth };
  });
  expect(over.scroll, `горизонтальная прокрутка ${where}: ${over.scroll} > ${over.view}`).toBeLessThanOrEqual(over.view + 1);
}

/** Окно стоит по центру экрана (а не прижато к краю). */
export async function expectCentered(page: Page, box: Locator, where = '') {
  await expect(box).toBeVisible();
  // Окно проявляется с подъёмом: ждём, пока анимация закончится.
  await page.waitForTimeout(400);
  const b = (await box.boundingBox())!;
  const vp = page.viewportSize()!;
  const dx = Math.abs(b.x + b.width / 2 - vp.width / 2);
  expect(dx, `окно ${where} смещено по горизонтали на ${Math.round(dx)} px`).toBeLessThanOrEqual(Math.max(8, vp.width * 0.02));
  if (b.height < vp.height - 40) {
    const dy = Math.abs(b.y + b.height / 2 - vp.height / 2);
    expect(dy, `окно ${where} смещено по вертикали на ${Math.round(dy)} px`).toBeLessThanOrEqual(vp.height * 0.08);
  }
}

/** Видимый текст без длинного тире: в продукте его нет нигде. */
export async function expectNoEmDash(page: Page, where = '') {
  const text = await page.evaluate(() => document.body.innerText);
  const at = text.indexOf('—');
  expect(at, `длинное тире на экране ${where}: «${text.slice(Math.max(0, at - 30), at + 30)}»`).toBe(-1);
}

/** Окно (модальное) - верхнее открытое. */
export const dialog = (page: Page, name?: string | RegExp) => (name ? page.getByRole('dialog', { name }) : page.getByRole('dialog').last());
