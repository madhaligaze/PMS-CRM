/** Разделы и кому они видны. Сервер всё равно проверит права сам. */
export type NavItem = { to: string; label: string; any: string[]; short?: string };

export const PRIMARY_NAV: NavItem[] = [
  { to: '/today', label: 'Сегодня', any: ['dashboard.view'] },
  { to: '/tape', label: 'Шахматка', any: ['tape.view'] },
  { to: '/bookings', label: 'Брони', any: ['booking.view'] },
  { to: '/guests', label: 'Гости', any: ['guest.view'] },
  { to: '/cash', label: 'Касса', any: ['cash.view'] },
  { to: '/housekeeping', label: 'Хозслужба', any: ['hk.view'] },
  { to: '/tasks', label: 'Мои уборки', any: ['hk.own_tasks'], short: 'Уборки' },
  { to: '/maintenance', label: 'Ремонт', any: ['maintenance.view'] },
  { to: '/reports', label: 'Отчёты', any: ['reports.view'] },
];

/**
 * Меню под именем: кабинет есть у каждого (профиль, а кому открыто - люди,
 * табель, журнал), настройки - у того, кто правит гостиницу. Пустой any -
 * пункт для всех.
 */
export const SECONDARY_NAV: NavItem[] = [
  { to: '/profile', label: 'Кабинет', any: [] },
  { to: '/settings', label: 'Настройки гостиницы', any: ['settings.manage', 'rates.manage'], short: 'Настройки' },
];

/** Подписи страниц, которых нет в меню: заголовок шапки на телефоне. */
export const PAGE_TITLES: NavItem[] = [
  { to: '/companies', label: 'Компании', any: [] },
  { to: '/staff', label: 'Сотрудники', any: [] },
  { to: '/positions', label: 'Должности', any: [] },
  { to: '/timesheet', label: 'Табель', any: [] },
  { to: '/audit', label: 'Журнал действий', any: [] },
];

export const allowed = (can: (...p: string[]) => boolean, n: NavItem) => !n.any.length || can(...n.any);

/**
 * Горничной «Хозслужба» и «Мои уборки» одновременно не нужны: у неё нет
 * hk.view, у супервайзера есть и то и другое - ему достаточно доски.
 */
export function visibleNav(can: (...p: string[]) => boolean): NavItem[] {
  return PRIMARY_NAV.filter((n) => {
    if (n.to === '/tasks') return can('hk.own_tasks') && !can('hk.view');
    return allowed(can, n);
  });
}

/** Первая страница после входа: по самому частому делу человека. */
export function homePath(can: (...p: string[]) => boolean): string {
  if (can('dashboard.view')) return '/today';
  if (can('hk.view')) return '/housekeeping';
  if (can('hk.own_tasks')) return '/tasks';
  if (can('maintenance.view')) return '/maintenance';
  if (can('guest.view')) return '/guests';
  if (can('cash.view')) return '/cash';
  if (can('staff.view')) return '/staff';
  return '/profile';
}
