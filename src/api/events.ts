import type { QueryClient } from '@tanstack/react-query';
import { accessToken, API_BASE, sessionState } from '@/auth/session';

/**
 * Поток событий сервера (SSE). Изменения других сотрудников - новая бронь с
 * колл-центра, убранный номер, оплата на ресепшене - появляются на открытых
 * экранах сами. Читаем через fetch: EventSource не умеет заголовок Authorization.
 */
const TOPIC_SECTIONS: [prefix: string, sections: string[]][] = [
  ['booking.', ['tape', 'bookings', 'booking', 'folio', 'readiness', 'dashboard', 'hk', 'guest']],
  ['room.', ['tape', 'rooms', 'hk', 'dashboard', 'booking', 'readiness']],
  ['hk.task.', ['hk', 'dashboard']],
  ['payment.', ['cash', 'folio', 'booking', 'bookings', 'dashboard', 'tape']],
  ['shift.', ['cash', 'dashboard']],
  ['maintenance.', ['maintenance', 'hk', 'tape', 'dashboard']],
  ['guest.', ['guests', 'guest']],
  ['attendance.', ['attendance', 'cash', 'staff']],
];

export function startEvents(qc: QueryClient): () => void {
  let stopped = false;
  let ctrl: AbortController | null = null;
  const pending = new Set<string>();
  let flushTimer = 0;

  const schedule = (topic: string) => {
    for (const [prefix, sections] of TOPIC_SECTIONS) if (topic.startsWith(prefix)) sections.forEach((s) => pending.add(s));
    // Пачка событий за 150 мс - одно обновление: не дёргаем сервер на каждую строку.
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      const sections = [...pending];
      pending.clear();
      sections.forEach((s) => void qc.invalidateQueries({ queryKey: [s] }));
    }, 150);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const run = async () => {
    let backoff = 1000;
    let connectedBefore = false;
    while (!stopped) {
      const propertyId = sessionState().propertyId;
      const token = await accessToken();
      if (!propertyId || !token) {
        await sleep(3000);
        continue;
      }
      try {
        ctrl = new AbortController();
        const res = await fetch(`${API_BASE}/api/v1/properties/${propertyId}/events`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        backoff = 1000;
        // После переподключения перечитываем всё: пока связи не было, могло измениться что угодно.
        if (connectedBefore) void qc.invalidateQueries();
        connectedBefore = true;
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const event = chunk.split('\n').find((l) => l.startsWith('event: '));
            if (event) schedule(event.slice(7).trim());
          }
        }
      } catch {
        if (stopped) break;
      }
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15_000);
    }
  };
  void run();
  return () => {
    stopped = true;
    ctrl?.abort();
    window.clearTimeout(flushTimer);
  };
}
