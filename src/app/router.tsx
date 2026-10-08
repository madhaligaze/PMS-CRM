import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { currentProperty, sessionState } from '@/auth/session';
import { LoginPage } from '@/features/auth/login';
import { AuditPage } from '@/features/audit/audit-page';
import { BookingsPage } from '@/features/bookings/bookings-page';
import { CashPage } from '@/features/cash/cash-page';
import { CompaniesPage } from '@/features/guests/companies-page';
import { GuestPage } from '@/features/guests/guest-page';
import { GuestsPage } from '@/features/guests/guests-page';
import { HousekeepingPage } from '@/features/housekeeping/housekeeping-page';
import { MaintenancePage } from '@/features/housekeeping/maintenance-page';
import { MyTasksPage } from '@/features/housekeeping/my-tasks';
import { KioskPage } from '@/features/kiosk/kiosk-page';
import { ProfilePage } from '@/features/profile/profile-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { PositionsPage } from '@/features/staff/positions-page';
import { StaffPage } from '@/features/staff/staff-page';
import { TimesheetPage } from '@/features/staff/timesheet-page';
import { TapePage } from '@/features/tape/tape-page';
import { TodayPage } from '@/features/today/today-page';
import { homePath } from './nav';
import { AppShell } from './shell';

type Ctx = { queryClient: QueryClient };

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

const rootRoute = createRootRouteWithContext<Ctx>()({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  beforeLoad: () => {
    const s = sessionState();
    if (s.status === 'authenticated' && !s.me?.mustChangePassword) throw redirect({ to: '/' });
  },
});

const kioskRoute = createRoute({ getParentRoute: () => rootRoute, path: '/kiosk', component: KioskPage });

/** Всё приложение за входом. ?booking=<id> открывает карточку брони поверх любой страницы. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  validateSearch: (s: Record<string, unknown>): { booking?: string | undefined } => ({ booking: str(s.booking) }),
  beforeLoad: ({ location }) => {
    const s = sessionState();
    if (s.status !== 'authenticated' || s.me?.mustChangePassword) throw redirect({ to: '/login' });
    // Обязательный вход с кодом не настроен: сервер закрыл гостиницу, работает только кабинет.
    if (s.me?.totpSetupRequired && location.pathname !== '/profile') throw redirect({ to: '/profile' });
  },
});

const permissionsSet = () => new Set(currentProperty()?.permissions ?? []);
const canNow = (...p: string[]) => {
  const set = permissionsSet();
  return p.some((x) => set.has(x));
};

/**
 * Раздел по прямой ссылке открывается только тому, кому он открыт: иначе -
 * на главную страницу роли, а не в пустой экран с отказом сервера.
 */
const only =
  (...perms: string[]) =>
  () => {
    if (!canNow(...perms)) throw redirect({ to: homePath(canNow) });
  };

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: homePath(canNow) });
  },
});

const todayRoute = createRoute({ getParentRoute: () => appRoute, path: '/today', component: TodayPage, beforeLoad: only('dashboard.view') });

const tapeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/tape',
  component: TapePage,
  beforeLoad: only('tape.view'),
  validateSearch: (s: Record<string, unknown>): { from?: string | undefined; span?: number | undefined } => ({
    from: str(s.from),
    span: typeof s.span === 'number' ? s.span : s.span ? Number(s.span) || undefined : undefined,
  }),
});

const bookingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/bookings',
  component: BookingsPage,
  beforeLoad: only('booking.view'),
  validateSearch: (s: Record<string, unknown>): { view?: string | undefined; q?: string | undefined } => ({ view: str(s.view), q: str(s.q) }),
});

const guestsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/guests',
  component: GuestsPage,
  beforeLoad: only('guest.view'),
  validateSearch: (s: Record<string, unknown>): { q?: string | undefined; filter?: string | undefined } => ({ q: str(s.q), filter: str(s.filter) }),
});
const guestRoute = createRoute({ getParentRoute: () => appRoute, path: '/guests/$guestId', component: GuestPage, beforeLoad: only('guest.view') });
const companiesRoute = createRoute({ getParentRoute: () => appRoute, path: '/companies', component: CompaniesPage, beforeLoad: only('company.view') });
const cashRoute = createRoute({ getParentRoute: () => appRoute, path: '/cash', component: CashPage, beforeLoad: only('cash.view') });
const hkRoute = createRoute({ getParentRoute: () => appRoute, path: '/housekeeping', component: HousekeepingPage, beforeLoad: only('hk.view') });
const tasksRoute = createRoute({ getParentRoute: () => appRoute, path: '/tasks', component: MyTasksPage, beforeLoad: only('hk.own_tasks', 'hk.view') });
const maintenanceRoute = createRoute({ getParentRoute: () => appRoute, path: '/maintenance', component: MaintenancePage, beforeLoad: only('maintenance.view') });
const reportsRoute = createRoute({ getParentRoute: () => appRoute, path: '/reports', component: ReportsPage, beforeLoad: only('reports.view') });
const auditRoute = createRoute({ getParentRoute: () => appRoute, path: '/audit', component: AuditPage, beforeLoad: only('audit.view') });
const staffRoute = createRoute({ getParentRoute: () => appRoute, path: '/staff', component: StaffPage, beforeLoad: only('staff.view') });
const positionsRoute = createRoute({ getParentRoute: () => appRoute, path: '/positions', component: PositionsPage, beforeLoad: only('staff.view') });
const timesheetRoute = createRoute({ getParentRoute: () => appRoute, path: '/timesheet', component: TimesheetPage, beforeLoad: only('attendance.view') });
const settingsRoute = createRoute({ getParentRoute: () => appRoute, path: '/settings', component: SettingsPage, beforeLoad: only('settings.manage', 'rates.manage') });
const profileRoute = createRoute({ getParentRoute: () => appRoute, path: '/profile', component: ProfilePage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  kioskRoute,
  appRoute.addChildren([
    indexRoute,
    todayRoute,
    tapeRoute,
    bookingsRoute,
    guestsRoute,
    guestRoute,
    companiesRoute,
    cashRoute,
    hkRoute,
    tasksRoute,
    maintenanceRoute,
    reportsRoute,
    auditRoute,
    staffRoute,
    positionsRoute,
    timesheetRoute,
    settingsRoute,
    profileRoute,
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
    defaultNotFoundComponent: () => (
      <div className="page">
        <h1 className="page-title">Такой страницы нет</h1>
        <p className="page-sub">Проверьте адрес или вернитесь на главную.</p>
      </div>
    ),
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
