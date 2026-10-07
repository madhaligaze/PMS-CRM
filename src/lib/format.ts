import { diffDays } from './dates';

/** Сумма из минимальных единиц (тиын для тенге) в число с пробелами-разделителями. */
const intFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CURRENCY_SIGN: Record<string, string> = { KZT: '₸', RUB: '₽', USD: '$', EUR: '€' };

/** Знак валюты гостиницы: «₸»; незнакомый код ISO показывается как есть. */
export const currencySign = (code: string) => CURRENCY_SIGN[code] ?? code;

export function amount(minor: number): string {
  const units = minor / 100;
  return Number.isInteger(units) ? intFmt.format(units) : decFmt.format(units);
}

export function money(minor: number, currency: string): string {
  return `${amount(minor)} ${currencySign(currency)}`;
}

/** Ввод суммы человеком («12 400», «12400,50») в тиыны. null - не число. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/\s+/g, '').replace(',', '.');
  if (!clean) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export const nights = (n: number) => `${n} ${plural(n, 'ночь', 'ночи', 'ночей')}`;

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const parts = (d: string) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)) - 1, day: Number(d.slice(8, 10)) });
const weekday = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w === 0 ? 6 : w - 1;
};

/** «7 окт» */
export function dayShort(d: string): string {
  const p = parts(d);
  return `${p.day} ${MONTHS_SHORT[p.m]}`;
}

/** «7 октября» или «7 октября 2027», если год не текущий. */
export function dayLong(d: string, currentYear = new Date().getFullYear()): string {
  const p = parts(d);
  return p.y === currentYear ? `${p.day} ${MONTHS_GEN[p.m]}` : `${p.day} ${MONTHS_GEN[p.m]} ${p.y}`;
}

/** «Среда, 7 октября» */
export function dayTitle(d: string): string {
  const w = WEEKDAYS[weekday(d)]!;
  return `${w[0]!.toUpperCase()}${w.slice(1)}, ${dayLong(d)}`;
}

export const weekdayShort = (d: string) => WEEKDAYS_SHORT[weekday(d)]!;
export const monthName = (d: string) => MONTHS_NOM[parts(d).m]!;

/** «7 - 10 окт» или «30 сен - 2 окт», с числом ночей по желанию. */
export function stayRange(arrival: string, departure: string, withNights = false): string {
  const a = parts(arrival);
  const b = parts(departure);
  const range = a.m === b.m && a.y === b.y ? `${a.day} - ${b.day} ${MONTHS_SHORT[b.m]}` : `${dayShort(arrival)} - ${dayShort(departure)}`;
  return withNights ? `${range} · ${nights(diffDays(arrival, departure))}` : range;
}

/** Время момента в часовом поясе гостиницы: «14:05». */
export function time(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** «7 окт, 14:05» в часовом поясе гостиницы. */
export function dateTime(iso: string, tz: string): string {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return `${dayShort(date)}, ${time(iso, tz)}`;
}

/** Дата момента в часовом поясе гостиницы, 'YYYY-MM-DD'. */
export function localDate(iso: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/**
 * Телефон для глаз: +7 701 123 45 67. Хранится как ввели: «8 701...» и
 * «701...» приводятся к +7. Городские коды Казахстана, кроме Алматы (727),
 * четырёхзначные: +7 7172 57 12 34.
 */
export function phone(raw: string | null | undefined): string {
  if (!raw) return '-';
  let d = raw.replace(/\D+/g, '');
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  if (d.length === 10 && d.startsWith('7')) d = `7${d}`;
  if (d.length !== 11 || !d.startsWith('7')) return raw;
  const cityCode4 = /^7[123]/.test(d.slice(1)) && !d.startsWith('7727');
  return cityCode4
    ? `+7 ${d.slice(1, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)} ${d.slice(9)}`
    : `+7 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
}

/** Пустое значение в интерфейсе - дефис. */
export const dash = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? '-' : String(v));

export function minutesToHours(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}
