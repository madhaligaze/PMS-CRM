import { useSyncExternalStore } from 'react';
import type { components } from '@/api/schema';
import { ApiError } from '@/api/errors';

export type Me = components['schemas']['Me'];
export type MyProperty = Me['properties'][number];

type State = {
  status: 'booting' | 'anonymous' | 'authenticated';
  me: Me | null;
  propertyId: string | null;
};

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const PROPERTY_KEY = 'ba.property';

/**
 * Сессия веб-клиента. Access-токен живёт только в памяти вкладки (XSS не
 * унесёт его из хранилища), refresh-токен - в httpOnly-cookie, JS его не видит.
 */
let access: { token: string; expiresAt: number } | null = null;
let state: State = { status: 'booting', me: null, propertyId: null };
const listeners = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

export function useSession(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const sessionState = () => state;

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_BASE}/api/v1${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
    body: JSON.stringify(body),
  });
}

type Tokens = { accessToken: string; accessTokenExpiresAt: string };

function accept(t: Tokens) {
  access = { token: t.accessToken, expiresAt: Date.parse(t.accessTokenExpiresAt) };
}

async function loadMe(): Promise<Me> {
  const res = await fetch(`${API_BASE}/api/v1/me`, { headers: { Authorization: `Bearer ${access!.token}` } });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return (await res.json()) as Me;
}

function pickProperty(me: Me): string | null {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PROPERTY_KEY);
  } catch {
    saved = null;
  }
  const found = me.properties.find((p) => p.id === saved) ?? me.properties[0];
  // Устройство помнит гостиницу: общий планшет отметок знает, где отмечать приход.
  try {
    if (found) localStorage.setItem(PROPERTY_KEY, found.id);
  } catch {
    /* приватный режим */
  }
  return found?.id ?? null;
}

/** Гостиница, с которой последний раз работали на этом устройстве (для планшета отметок). */
export function deviceProperty(): string | null {
  try {
    return localStorage.getItem(PROPERTY_KEY);
  } catch {
    return null;
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * Обновление токена. Refresh-токен одноразовый и общий для вкладок (cookie),
 * поэтому вкладки обновляются по очереди через Web Locks. Если вкладка всё же
 * опоздала (сервер ответил 409 refresh_retry), повтор с уже новым cookie.
 */
export function refresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await postJson('/auth/refresh', { client: 'web' });
        if (res.ok) {
          accept((await res.json()) as Tokens);
          return true;
        }
        if (res.status === 409) {
          await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          continue;
        }
        return false;
      }
      return false;
    };
    try {
      return navigator.locks ? await navigator.locks.request('ba-refresh', run) : await run();
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** Действующий access-токен; обновляет его заранее, за 30 секунд до истечения. */
export async function accessToken(): Promise<string | null> {
  if (access && access.expiresAt - Date.now() > 30_000) return access.token;
  const ok = await refresh();
  return ok && access ? access.token : null;
}

export async function boot(): Promise<void> {
  try {
    if (await refresh()) {
      const me = await loadMe();
      set({ status: 'authenticated', me, propertyId: pickProperty(me) });
      return;
    }
  } catch {
    /* сеть или сессия - в любом случае на вход */
  }
  set({ status: 'anonymous', me: null, propertyId: null });
}

export async function login(input: { login: string; password: string; totpCode?: string }): Promise<void> {
  const res = await postJson('/auth/login', { ...input, client: 'web' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body as Record<string, unknown>);
  accept(body as Tokens);
  const me = await loadMe();
  set({ status: 'authenticated', me, propertyId: pickProperty(me) });
}

/** Заведена ли гостиница: пока нет - вместо входа регистрация владельца. */
export async function setupNeeded(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/setup`);
    if (!res.ok) return false;
    return ((await res.json()) as { needed: boolean }).needed;
  } catch {
    return false;
  }
}

/** Регистрация гостиницы и её владельца; владелец сразу входит. */
export async function registerOwner(input: { hotelName: string; fullName: string; phone?: string | null; login: string; password: string }): Promise<void> {
  const res = await postJson('/setup', { ...input, client: 'web' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body as Record<string, unknown>);
  accept(body as Tokens);
  const me = await loadMe();
  set({ status: 'authenticated', me, propertyId: pickProperty(me) });
}

/** Свой пароль вместо выданного управляющим (или просто смена пароля). */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}/api/v1/me/password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
  const me = await loadMe();
  set({ me });
}

export async function logout(): Promise<void> {
  const token = access?.token;
  access = null;
  try {
    await fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: '{}',
    });
  } finally {
    set({ status: 'anonymous', me: null, propertyId: null });
  }
}

/** Сервер сказал, что сессии больше нет: на вход, без попыток угадать. */
export function sessionEnded(): void {
  access = null;
  if (state.status !== 'anonymous') set({ status: 'anonymous', me: null, propertyId: null });
}

export async function reloadMe(): Promise<void> {
  if (!access) return;
  const me = await loadMe();
  set({ me, propertyId: state.propertyId ?? pickProperty(me) });
}

export function selectProperty(id: string): void {
  try {
    localStorage.setItem(PROPERTY_KEY, id);
  } catch {
    /* приватный режим */
  }
  set({ propertyId: id });
}

export function currentProperty(): MyProperty | null {
  return state.me?.properties.find((p) => p.id === state.propertyId) ?? null;
}

export function useProperty(): MyProperty {
  const s = useSession();
  const p = s.me?.properties.find((x) => x.id === s.propertyId);
  if (!p) throw new Error('Нет выбранной гостиницы');
  return p;
}

/** Есть ли право у текущего сотрудника. Сервер проверяет сам, это - чтобы не показывать лишнего. */
export function useCan() {
  const p = useProperty();
  const set = new Set(p.permissions);
  return (...perms: string[]) => perms.some((x) => set.has(x));
}
