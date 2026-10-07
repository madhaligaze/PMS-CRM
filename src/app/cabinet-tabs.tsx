import { Link, useRouterState } from '@tanstack/react-router';
import { useCan } from '@/auth/session';

/** Личный кабинет: профиль, люди и их права, табель, журнал. Видно только то, что открыто. */
export const CABINET: { to: string; label: string; any: string[] }[] = [
  { to: '/profile', label: 'Профиль', any: [] },
  { to: '/staff', label: 'Сотрудники', any: ['staff.view'] },
  { to: '/positions', label: 'Должности', any: ['staff.view'] },
  { to: '/timesheet', label: 'Табель', any: ['attendance.view'] },
  { to: '/audit', label: 'Журнал действий', any: ['audit.view'] },
];

export function CabinetTabs() {
  const can = useCan();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const tabs = CABINET.filter((t) => !t.any.length || can(...t.any));
  if (tabs.length < 2) return null;
  return (
    <nav className="tabs page-tabs" aria-label="Кабинет">
      {tabs.map((t) => (
        <Link key={t.to} to={t.to} className="tab" data-active={path === t.to}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
