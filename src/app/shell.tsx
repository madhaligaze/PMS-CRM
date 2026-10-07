import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCash, useDashboard } from '@/api/hooks';
import { logout, useCan, useProperty, useSession } from '@/auth/session';
import { Mark } from '@/components/brand/mark';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import { Menu } from '@/components/ui/menu';
import { CloseGlyph } from '@/components/ui/overlay';
import { BookingCard } from '@/features/bookings/booking-card';
import { NewBookingModal } from '@/features/bookings/new-booking';
import { CommandPalette, openPalette } from './palette';
import { allowed, PAGE_TITLES, SECONDARY_NAV, visibleNav } from './nav';

function ShiftLine() {
  const can = useCan();
  const cash = useCash(can('cash.view'));
  if (!can('cash.view') || !cash.data) return null;
  const s = cash.data.shift;
  return (
    <Link to="/cash" className="shift-line" data-state={s ? 'open' : 'closed'}>
      {s ? `Смена ${s.number} · ${s.openedBy.name.split(' ')[0]}` : 'Смена закрыта'}
    </Link>
  );
}

function AttentionCount() {
  const can = useCan();
  const d = useDashboard();
  if (!can('dashboard.view') || !d.data) return null;
  const n = d.data.overduePrepayments.length + d.data.arrivalsNotReady + d.data.overdueTasks;
  return n ? <span className="count" aria-label={`требует внимания: ${n}`}>{n}</span> : null;
}

export function AppShell() {
  const session = useSession();
  const property = useProperty();
  const can = useCan();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [sheet, setSheet] = useState(false);
  const navigate = useNavigate();
  const nav = visibleNav(can);
  const secondary = SECONDARY_NAV.filter((n) => allowed(can, n));
  const active = (to: string) => path === to || path.startsWith(`${to}/`);
  const current = [...nav, ...secondary, ...PAGE_TITLES].find((n) => active(n.to));

  useEffect(() => setSheet(false), [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const me = session.me!;
  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Bizdin Auyl, на главную">
          <Mark />
          <span className="brand-name only-desktop">Bizdin Auyl</span>
        </Link>
        <span className="mobile-title only-mobile truncate">{current?.short ?? current?.label ?? ''}</span>
        <nav className="nav" aria-label="Разделы">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className="nav-item" data-active={active(n.to)}>
              {n.label}
              {n.to === '/today' ? <AttentionCount /> : null}
            </Link>
          ))}
        </nav>
        <div className="topbar-right">
          {can('booking.view', 'guest.view') ? (
            <button type="button" className="search-trigger" onClick={openPalette} aria-label="Поиск: гости, брони, номера">
              <span className="label">Поиск</span>
              <kbd>Ctrl K</kbd>
            </button>
          ) : null}
          <ShiftLine />
          <Menu
            label="Профиль"
            trigger={(p) => (
              <button type="button" className="user-btn" {...p}>
                <span className="name">{me.fullName}</span>
                <span className="role">{property.position ?? property.accessLabel}</span>
              </button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">{property.name}</div>
                {secondary.map((n) => (
                  <Link key={n.to} to={n.to} className="menu-item" onClick={close}>
                    {n.label}
                  </Link>
                ))}
                <div className="menu-sep" />
                <div style={{ padding: '6px 16px 10px' }}>
                  <ThemeSwitch />
                </div>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    void logout().then(() => navigate({ to: '/login' }));
                  }}
                >
                  Выйти
                </button>
              </>
            )}
          </Menu>
          <button type="button" className="btn btn-ghost btn-sm only-mobile" onClick={() => setSheet(true)} aria-expanded={sheet}>
            Меню
          </button>
        </div>
      </header>

      {sheet ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="sheet-head">
            <span className="brand">
              <Mark />
              Bizdin Auyl
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setSheet(false)} aria-label="Закрыть меню">
              <CloseGlyph />
            </button>
          </div>
          <nav className="sheet-nav" aria-label="Разделы">
            {[...nav, ...secondary].map((n) => (
              <Link key={n.to} to={n.to} data-active={active(n.to)}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="row-between" style={{ marginTop: 'var(--s-6)' }}>
            <div>
              <div style={{ fontWeight: 500 }}>{me.fullName}</div>
              <div className="muted">{property.position ?? property.accessLabel}</div>
            </div>
            <ThemeSwitch />
          </div>
          <button type="button" className="btn btn-ghost btn-block" style={{ marginTop: 'var(--s-6)' }} onClick={() => void logout().then(() => navigate({ to: '/login' }))}>
            Выйти
          </button>
        </div>
      ) : null}

      <main id="main">
        <Outlet />
      </main>

      <BookingCard />
      <NewBookingModal />
      <CommandPalette />
    </>
  );
}
