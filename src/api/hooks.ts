import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSession } from '@/auth/session';
import { api, pid, unwrap } from './client';
import type { components } from './schema';

export type S = components['schemas'];

/** Ключи запросов начинаются с раздела и гостиницы: события сервера гасят разделы целиком. */
function usePid() {
  return useSession().propertyId ?? '';
}

export function useInvalidate() {
  const qc = useQueryClient();
  return useCallback((...sections: string[]) => Promise.all(sections.map((s) => qc.invalidateQueries({ queryKey: [s] }))), [qc]);
}

/** Гостиница с операционной датой и настройками (для формы брони, причин, лимитов). */
export function usePropertyInfo() {
  const p = usePid();
  return useQuery({
    queryKey: ['property', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}', { params: { path: pid() } })),
    staleTime: 60_000,
  });
}

export function useRooms() {
  const p = usePid();
  return useQuery({
    queryKey: ['rooms', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/rooms', { params: { path: pid() } })),
    staleTime: 30_000,
  });
}

export function useRoomTypes() {
  const p = usePid();
  return useQuery({
    queryKey: ['room-types', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/room-types', { params: { path: pid() } })),
    staleTime: 300_000,
  });
}

export function useRatePlans(enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['rate-plans', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/rate-plans', { params: { path: pid() } })),
    staleTime: 300_000,
    enabled,
  });
}

export function useTape(from: string, to: string) {
  const p = usePid();
  return useQuery({
    queryKey: ['tape', p, from, to],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/tape-chart', { params: { path: pid(), query: { from, to } } })),
    placeholderData: keepPreviousData,
  });
}

export function useDashboard() {
  const p = usePid();
  return useQuery({
    queryKey: ['dashboard', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/dashboard', { params: { path: pid() } })),
    refetchInterval: 120_000,
  });
}

type BookingQuery = {
  view?: 'arrivals' | 'departures' | 'inhouse' | 'all';
  q?: string;
  status?: S['BookingStatus'][];
  from?: string;
  to?: string;
  guestId?: string;
  cursor?: string;
  limit?: number;
};

export function useBookings(query: BookingQuery) {
  const p = usePid();
  return useQuery({
    queryKey: ['bookings', p, query],
    queryFn: () =>
      unwrap(
        api.GET('/api/v1/properties/{propertyId}/bookings', {
          params: { path: pid(), query: { limit: 50, ...query } as never },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

export function useBooking(id: string | null) {
  const p = usePid();
  return useQuery({
    queryKey: ['booking', p, id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/bookings/{id}', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
}

export function useFolio(id: string | null, enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['folio', p, id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/bookings/{id}/folio', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id && enabled,
  });
}

export function useReadiness(id: string | null) {
  const p = usePid();
  return useQuery({
    queryKey: ['readiness', p, id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/bookings/{id}/check-in', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
}

export function useGuests(query: { q?: string; filter?: 'vip' | 'blacklisted' | 'regular' | 'corporate'; cursor?: string }) {
  const p = usePid();
  return useQuery({
    queryKey: ['guests', p, query],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests', { params: { path: pid(), query: { limit: 50, ...query } } })),
    placeholderData: keepPreviousData,
  });
}

/** Гости страницами: «Показать ещё» дописывает следующую, а не уводит на неё. */
export function useGuestPages(query: { q?: string; filter?: 'vip' | 'blacklisted' | 'regular' | 'corporate' }) {
  const p = usePid();
  return useInfiniteQuery({
    queryKey: ['guests', p, 'pages', query],
    queryFn: ({ pageParam }) =>
      unwrap(api.GET('/api/v1/properties/{propertyId}/guests', { params: { path: pid(), query: { limit: 50, ...query, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useGuest(id: string | null) {
  const p = usePid();
  return useQuery({
    queryKey: ['guest', p, id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests/{id}', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
}

export function useGuestStays(id: string | null) {
  const p = usePid();
  return useQuery({
    queryKey: ['guest', p, id, 'stays'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests/{id}/stays', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
}

export function useGuestDocuments(id: string | null, enabled: boolean) {
  const p = usePid();
  return useQuery({
    queryKey: ['guest', p, id, 'documents'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests/{id}/documents', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id && enabled,
  });
}

export function useCompanies(q?: string) {
  const p = usePid();
  return useQuery({
    queryKey: ['companies', p, q ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/companies', { params: { path: pid(), query: { limit: 100, ...(q ? { q } : {}) } } })),
    placeholderData: keepPreviousData,
  });
}

export function useCash(enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['cash', p],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/cash', { params: { path: pid() } })),
    enabled,
  });
}

export function useShifts() {
  const p = usePid();
  return useQuery({
    queryKey: ['cash', p, 'shifts'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/cash/shifts', { params: { path: pid(), query: { limit: 30 } } })),
  });
}

export function useShiftReport(id: string | null) {
  const p = usePid();
  return useQuery({
    queryKey: ['cash', p, 'report', id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/cash/shifts/{id}/report', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
}

export function usePayments(query: { shiftId?: string; from?: string; to?: string }, enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['cash', p, 'payments', query],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/payments', { params: { path: pid(), query } })),
    enabled,
  });
}

export function useHkBoard() {
  const p = usePid();
  return useQuery({
    queryKey: ['hk', p, 'board'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/housekeeping/board', { params: { path: pid() } })),
    refetchInterval: 60_000,
  });
}

export function useHkTasks(query: { date?: string; assignee?: string } = {}) {
  const p = usePid();
  return useQuery({
    queryKey: ['hk', p, 'tasks', query],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/housekeeping/tasks', { params: { path: pid(), query } })),
    refetchInterval: 60_000,
  });
}

export function useMaintenance(query: { status?: S['MaintenanceStatus'][]; roomId?: string } = {}) {
  const p = usePid();
  return useQuery({
    queryKey: ['maintenance', p, query],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/maintenance', { params: { path: pid(), query: query as never } })),
  });
}

export function useAttendanceMe() {
  const p = usePid();
  return useQuery({
    queryKey: ['attendance', p, 'me'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/attendance/me', { params: { path: pid() } })),
  });
}

export function useAttendance(query: { from?: string; to?: string; userId?: string }) {
  const p = usePid();
  return useQuery({
    queryKey: ['attendance', p, 'list', query],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/attendance', { params: { path: pid(), query } })),
  });
}

export function useTimesheet(month: string) {
  const p = usePid();
  return useQuery({
    queryKey: ['attendance', p, 'timesheet', month],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/attendance/timesheet', { params: { path: pid(), query: { month } } })),
  });
}

export function useStaff(archived = false, enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['staff', p, archived ? 'archived' : 'active'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/staff', { params: { path: pid(), query: { archived: String(archived) } } })),
    enabled,
  });
}

export function usePositions(enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['staff', p, 'positions'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/positions', { params: { path: pid() } })),
    enabled,
  });
}

export function useDirectory(enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['staff', p, 'directory'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/staff/directory', { params: { path: pid() } })),
    staleTime: 300_000,
    enabled,
  });
}

/** Разделы и полномочия для экрана прав: словарь не меняется, пока не обновится сервер. */
export function useAccessCatalog(enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['staff', p, 'catalog'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/access/catalog', { params: { path: pid() } })),
    staleTime: Infinity,
    enabled,
  });
}

export function useDailyReport(date?: string) {
  const p = usePid();
  return useQuery({
    queryKey: ['reports', p, 'daily', date ?? ''],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/reports/daily', { params: { path: pid(), query: date ? { date } : {} } })),
  });
}

export function usePeriodReport(from: string, to: string) {
  const p = usePid();
  return useQuery({
    queryKey: ['reports', p, 'period', from, to],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/reports/period', { params: { path: pid(), query: { from, to } } })),
    placeholderData: keepPreviousData,
  });
}

export function useAuditPages(query: { q?: string; entityType?: string; actorId?: string; action?: string; from?: string; to?: string }) {
  const p = usePid();
  return useInfiniteQuery({
    queryKey: ['audit', p, 'pages', query],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/properties/{propertyId}/audit', { params: { path: pid(), query: { limit: 60, ...query, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export type HistoryEntity = 'booking' | 'guest' | 'room' | 'shift' | 'maintenance' | 'hk_task' | 'user' | 'position';

export function useEntityHistory(entityType: HistoryEntity, entityId: string | null, enabled = true) {
  const p = usePid();
  return useQuery({
    queryKey: ['audit', p, 'entity', entityType, entityId],
    queryFn: () =>
      unwrap(api.GET('/api/v1/properties/{propertyId}/audit/entity/{entityType}/{entityId}', { params: { path: { ...pid(), entityType, entityId: entityId! } } })),
    enabled: !!entityId && enabled,
  });
}
