import { useSyncExternalStore } from 'react';
import { errorText } from '@/api/errors';

type Toast = { id: number; kind: 'info' | 'error'; title: string; detail?: string | undefined };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(t: Omit<Toast, 'id'>, ms: number) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { ...t, id }];
  emit();
  window.setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  info: (title: string, detail?: string) => push({ kind: 'info', title, detail }, 4500),
  error: (title: string, detail?: string) => push({ kind: 'error', title, detail }, 9000),
  /** Ошибка API или сети: текст берётся из ответа сервера. */
  fail: (e: unknown) => {
    const t = errorText(e);
    push({ kind: 'error', title: t.title, detail: t.detail }, 9000);
  },
};

export function Toasts() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast${t.kind === 'error' ? ' toast-error' : ''}`} onClick={() => dismiss(t.id)}>
          <div className="t-body">
            <div className="t-title">{t.title}</div>
            {t.detail ? <div className="t-detail">{t.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
