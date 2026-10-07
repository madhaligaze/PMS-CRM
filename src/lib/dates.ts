/**
 * Даты проживания - строки 'YYYY-MM-DD' без времени и часового пояса, как в API.
 * Арифметика - через UTC: сдвиг часового пояса браузера на них не влияет.
 */

const DAY = 86_400_000;

const toMs = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const diffDays = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DAY);

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 1 - понедельник ... 7 - воскресенье. */
export function isoWeekday(d: string): number {
  const w = new Date(toMs(d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const isWeekend = (d: string) => isoWeekday(d) >= 6;

export function startOfWeek(d: string): string {
  return addDays(d, 1 - isoWeekday(d));
}

export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const minDate = (a: string, b: string) => (a < b ? a : b);

/** Местные дата и время момента в поясе гостиницы: { date: '2026-10-07', time: '14:05' }. */
export function zonedParts(iso: string | Date, timeZone: string): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * Момент для местных даты и времени гостиницы - строкой ISO с поясом, как ждёт
 * API: '2026-10-07' + '14:00' в Asia/Almaty → '2026-10-07T09:00:00.000Z'. Тот же
 * расчёт, что на сервере (lib/dates.ts zonedToUtc): от смещения пояса в этот момент.
 */
export function zonedToIso(date: string, time: string, timeZone: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const guess = toMs(date) + h * 3_600_000 + m * 60_000;
  const offset = (ms: number) => {
    const p = zonedParts(new Date(ms), timeZone);
    const [ph = 0, pm = 0] = p.time.split(':').map(Number);
    return Math.round((toMs(p.date) + ph * 3_600_000 + pm * 60_000 - Math.floor(ms / 60_000) * 60_000) / 60_000);
  };
  const o1 = offset(guess);
  const result = guess - o1 * 60_000;
  const o2 = offset(result);
  return new Date(o2 === o1 ? result : guess - o2 * 60_000).toISOString();
}
