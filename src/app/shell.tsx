import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useCash, useDashboard } from '@/api/hooks';
import { logout, selectProperty, useCan, useProperty, useSession } from '@/auth/session';
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

/**
 * Оболочка рисуется только при живой сессии с выбранной гостиницей. В момент
 * выхода сессия уже пуста, а переход на вход ещё не случился: страницы под
 * оболочкой в этот кадр не рисуются вовсе, а не падают без гостиницы.
 */
export function AppShell() {
  const session = useSession();
  if (session.status !== 'authenticated' || !session.me) return <div className="boot" aria-busy="true" />;
  if (!session.me.properties.length) return <NoProperty />;
  if (!session.me.properties.some((p) => p.id === session.propertyId)) return <div className="boot" aria-busy="true" />;
  return <Shell />;
}

/** Учётная запись есть, а доступа ни к одной гостинице нет: сказать прямо, а не крутить загрузку. */
function NoProperty() {
  const navigate = useNavigate();
  return (
    <main className="page">
      <h1 className="page-title">Нет доступа к гостинице</h1>
      <p className="page-sub">Учётная запись работает, но ни одна гостиница вам не открыта. Обратитесь к управляющему.</p>
      <button type="button" className="btn btn-ghost" style={{ marginTop: 'var(--s-6)' }} onClick={() => void logout().then(() => navigate({ to: '/login' }))}>
        Выйти
      </button>
    </main>
  );
}

function Shell() {
  const session = useSession();
  const property = useProperty();
  const can = useCan();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [sheet, setSheet] = useState(false);
  const navigate = useNavigate();
  // Пока обязательный вход с кодом не настроен, разделы закрыты: в меню их нет вовсе.
  const locked = !!session.me?.totpSetupRequired;
  const nav = locked ? [] : visibleNav(can);
  const secondary = SECONDARY_NAV.filter((n) => allowed(can, n) && (!locked || n.to === '/profile'));
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
  /** Другая гостиница - другие права: начинаем с её главной страницы, открытые окна закрываются. */
  const switchTo = (id: string) => {
    if (id === property.id) return;
    selectProperty(id);
    void navigate({ to: '/' });
  };
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
          {!locked && can('booking.view', 'guest.view') ? (
            <button type="button" className="search-trigger" onClick={openPalette} aria-label="Поиск: гости, брони, номера">
              <span className="label">Поиск</span>
              <kbd>Ctrl K</kbd>
            </button>
          ) : null}
          {locked ? null : <ShiftLine />}
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
                {me.properties.length > 1 ? (
                  <>
                    <div className="menu-label">Гостиница</div>
                    {me.properties.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="menu-item" role="menuitem"
                        aria-current={p.id === property.id || undefined}
                        onClick={() => {
                          close();
                          switchTo(p.id);
                        }}
                      >
                        {p.name}
                      </button>
                    ))}
                    <div className="menu-sep" />
                  </>
                ) : (
                  <div className="menu-label">{property.name}</div>
                )}
                {secondary.map((n) => (
                  <Link key={n.to} to={n.to} className="menu-item" role="menuitem" onClick={close}>
                    {n.label}
                  </Link>
                ))}
                <div className="menu-sep" />
                <div style={{ padding: '6px 16px 10px' }}>
                  <ThemeSwitch />
                </div>
                <button
                  type="button"
                  className="menu-item" role="menuitem"
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
          {me.properties.length > 1 ? (
            <div className="sheet-properties">
              <div className="muted">Гостиница</div>
              <div className="choices" role="radiogroup" aria-label="Гостиница">
                {me.properties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    className="choice"
                    aria-checked={p.id === property.id}
                    onClick={() => {
                      setSheet(false);
                      switchTo(p.id);
                    }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
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
