import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { dialog, expect, expectCentered, expectNoEmDash, expectNoSideScroll, openAs, test } from './support';

/**
 * Аудит вёрстки и удобства: каждая роль, каждая её страница, три ширины
 * (1440 / 800 / 390) и обе темы. Проверяется то, что ломается тихо: прокрутка
 * вбок, пилюли, длинное тире, пропавший заголовок, мелкие кнопки на телефоне,
 * доступность по WCAG (axe), лишние пункты меню у роли.
 */
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 800, height: 1100 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

const ROLES: { login: string; pages: string[]; hidden: string[] }[] = [
  {
    login: 'owner',
    pages: ['/today', '/tape', '/bookings', '/guests', '/companies', '/cash', '/housekeeping', '/maintenance', '/reports', '/profile', '/staff', '/positions', '/timesheet', '/audit', '/settings'],
    hidden: ['Мои уборки'],
  },
  // Ресепшену по должности видны готовность номеров и поломки, но не отчёты и не уборки горничных.
  { login: 'reception', pages: ['/today', '/tape', '/bookings', '/guests', '/cash', '/housekeeping', '/maintenance', '/profile'], hidden: ['Отчёты', 'Мои уборки'] },
  { login: 'supervisor', pages: ['/housekeeping', '/maintenance', '/profile'], hidden: ['Касса', 'Брони', 'Мои уборки'] },
  { login: 'maid', pages: ['/tasks', '/profile'], hidden: ['Касса', 'Брони', 'Гости', 'Хозслужба', 'Отчёты'] },
  { login: 'tech', pages: ['/maintenance', '/profile'], hidden: ['Касса', 'Брони', 'Гости'] },
  { login: 'accountant', pages: ['/reports', '/cash', '/profile'], hidden: ['Мои уборки'] },
];

/** Страница дорисовалась: нет полосы загрузки и заглушки входа. */
async function settle(page: Page) {
  await expect(page.locator('.boot')).toHaveCount(0);
  await expect(page.locator('.loading-block')).toHaveCount(0, { timeout: 15_000 });
}

/** Скруглённые «пилюли» запрещены: кнопки - прямоугольники. */
async function pills(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a.btn, .choice, .tag, .badge')]
      .filter((el) => el.offsetParent !== null && !el.closest('.theme-switch'))
      .filter((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 12)
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}: «${el.innerText.slice(0, 30)}»`),
  );
}

/** На телефоне в кнопку попадает палец: не меньше 32 px по высоте. */
async function tinyTargets(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('button, a.btn, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden])')]
      .filter((el) => el.offsetParent !== null && !el.closest('.btn-quiet, .link-btn, .tab, .nav-item, .cc, .photo-remove, .theme-switch, .menu-item, .sheet-nav'))
      .filter((el) => !el.classList.contains('btn-quiet') && !el.classList.contains('link-btn') && !el.classList.contains('tab'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && r.height < 32)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className} ${Math.round(r.height)}px «${(el.innerText || el.getAttribute('aria-label') || '').slice(0, 24)}»`),
  );
}

for (const role of ROLES) {
  test(`вёрстка и удобство: ${role.login}`, async ({ page }) => {
    test.setTimeout(240_000 + role.pages.length * 30_000);
    await openAs(page, role.login, role.pages[0]);
    const problems: string[] = [];
    for (const theme of THEMES) {
      await page.emulateMedia({ colorScheme: theme });
      for (const vp of VIEWPORTS) {
        await page.setViewportSize(vp);
        for (const path of role.pages) {
          const where = `${role.login} ${path} ${vp.width}px ${theme}`;
          await page.goto(path);
          await settle(page);
          await expect(page).toHaveURL(new RegExp(`${path}$`));
          await expectNoSideScroll(page, where);
          await expectNoEmDash(page, where);
          // Заголовок страницы: на телефоне он в шапке, на остальных - на самой странице.
          await expect(page.locator('h1').first(), `заголовок ${where}`).toBeVisible();
          const p = await pills(page);
          if (p.length) problems.push(`${where}: пилюли ${p.join('; ')}`);
          if (vp.width === 390) {
            const t = await tinyTargets(page);
            if (t.length) problems.push(`${where}: мелкие кнопки ${t.slice(0, 5).join('; ')}`);
          }
        }
      }
    }
    // Меню роли: лишних разделов нет.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(role.pages[0]!);
    await settle(page);
    const nav = page.getByRole('navigation', { name: 'Разделы' }).first();
    for (const label of role.hidden) await expect(nav.getByRole('link', { name: label, exact: true }), `${role.login}: пункта «${label}» быть не должно`).toHaveCount(0);
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

test('доступность (WCAG 2 AA) главных экранов', async ({ page }) => {
  test.setTimeout(240_000);
  await openAs(page, 'owner', '/today');
  const report: string[] = [];
  for (const theme of THEMES) {
    await page.emulateMedia({ colorScheme: theme });
    for (const path of ['/today', '/tape', '/bookings', '/guests', '/cash', '/housekeeping', '/maintenance', '/reports', '/staff', '/settings', '/profile']) {
      await page.goto(path);
      await settle(page);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      for (const v of res.violations.filter((x) => x.impact === 'critical' || x.impact === 'serious')) {
        report.push(`${path} ${theme}: ${v.id} (${v.impact}) ${v.help} -> ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
      }
    }
  }
  expect(report, report.join('\n')).toEqual([]);
});

test('окна записей открываются по центру на всех ширинах', async ({ page }) => {
  test.setTimeout(180_000);
  await openAs(page, 'senior', '/bookings');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize(vp);
    await page.goto('/bookings');
    await settle(page);
    await page.locator('tbody tr').first().click();
    const card = dialog(page);
    await expectCentered(page, card, `брони ${vp.width}px`);
    await expectNoSideScroll(page, `карточка брони ${vp.width}px`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.goto('/guests');
    await settle(page);
    await page.locator('tbody tr').first().click();
    if (await page.getByRole('dialog').count()) {
      await expectCentered(page, dialog(page), `гостя ${vp.width}px`);
      await page.keyboard.press('Escape');
    }
  }
});
