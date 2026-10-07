/** Ошибка API в формате problem+json: стабильный code для логики, title - для людей. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | undefined;
  readonly body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.title === 'string' ? body.title : `Ошибка ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = typeof body.code === 'string' ? body.code : 'unknown';
    this.detail = typeof body.detail === 'string' ? body.detail : undefined;
    this.body = body;
  }

  /** Ошибки проверки полей: путь поля -> сообщение. */
  get fieldErrors(): Record<string, string> {
    const list = (this.body.errors as { path: string; message: string }[] | undefined) ?? [];
    return Object.fromEntries(list.map((e) => [e.path.replace(/^body\./, ''), e.message]));
  }
}

export function isApiError(e: unknown, code?: string): e is ApiError {
  return e instanceof ApiError && (code === undefined || e.code === code);
}

/** Текст ошибки для уведомления. */
export function errorText(e: unknown): { title: string; detail?: string | undefined } {
  if (e instanceof ApiError) return { title: e.message, detail: e.detail };
  if (e instanceof TypeError) return { title: 'Нет связи с сервером', detail: 'Проверьте сеть и повторите.' };
  return { title: 'Что-то пошло не так', detail: e instanceof Error ? e.message : undefined };
}
