import createClient from 'openapi-fetch';
import { accessToken, API_BASE, refresh, sessionEnded, sessionState } from '@/auth/session';
import { ApiError } from './errors';
import type { paths } from './schema';

/**
 * Типизированный клиент API: пути, параметры и ответы - из openapi.json
 * бэкенда (pnpm api:sync). Тот же контракт получат мобильные приложения.
 */
async function authedFetch(input: Request): Promise<Response> {
  const retry = input.clone();
  const token = await accessToken();
  if (token) input.headers.set('Authorization', `Bearer ${token}`);
  let res = await fetch(input);
  if (res.status === 401) {
    const body = (await res.clone().json().catch(() => ({}))) as { code?: string };
    if (body.code === 'auth.token_expired' || body.code === 'auth.token_invalid') {
      if (await refresh()) {
        const fresh = await accessToken();
        if (fresh) retry.headers.set('Authorization', `Bearer ${fresh}`);
        res = await fetch(retry);
      }
    }
    if (res.status === 401) sessionEnded();
  }
  return res;
}

export const api = createClient<paths>({ baseUrl: `${API_BASE}`, fetch: authedFetch });

type Result<T> = { data?: T; error?: unknown; response: Response };

/** Данные или исключение ApiError с code и текстом от сервера. */
export async function unwrap<T>(p: Promise<Result<T>>): Promise<T> {
  const { data, error, response } = await p;
  if (error !== undefined || !response.ok) {
    const body = (error && typeof error === 'object' ? error : {}) as Record<string, unknown>;
    throw new ApiError(response.status, body);
  }
  return data as T;
}

/** Параметр пути текущей гостиницы. */
export function pid(): { propertyId: string } {
  const id = sessionState().propertyId;
  if (!id) throw new Error('Гостиница не выбрана');
  return { propertyId: id };
}

/**
 * Скачать выгрузку (CSV табеля, платежей): ссылкой нельзя - нужен заголовок
 * входа. Имя файла - из Content-Disposition сервера.
 */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await authedFetch(new Request(`${API_BASE}${path}`));
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))) as Record<string, unknown>);
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Ключ идемпотентности для создания брони, оплаты, начисления. */
export const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
export const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
