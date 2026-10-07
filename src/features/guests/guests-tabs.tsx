import { Link, useRouterState } from '@tanstack/react-router';
import { useCan } from '@/auth/session';

/** Гости и компании - одна база клиентов, две вкладки. */
export function GuestsTabs() {
  const can = useCan();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!can('company.view') || !can('guest.view')) return null;
  return (
    <nav className="tabs page-tabs" aria-label="База клиентов">
      <Link to="/guests" className="tab" data-active={path === '/guests'}>
        Гости
      </Link>
      <Link to="/companies" className="tab" data-active={path === '/companies'}>
        Компании
      </Link>
    </nav>
  );
}
