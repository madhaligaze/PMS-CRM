import { useSyncExternalStore } from 'react';

/**
 * Тема: выбор человека и то, что стоит на экране.
 *
 * Выбор - «день», «ночь» или «как в системе» (в хранилище пусто). Что стоит на
 * экране - атрибут data-theme на <html>: первым его ставит скрипт в index.html
 * до загрузки приложения, дальше - этот модуль, в том числе вслед за системой,
 * пока человек не выбрал сам.
 *
 * Смена темы - одно растворение всей страницы через View Transitions: браузер
 * снимает кадр в старой теме, тема под ним меняется сразу, и два кадра
 * растворяются на видеокарте. Поэлементных переходов цвета нет. Небо на входе
 * меняется своим ходом (облака рассеиваются, небо уходит в закат) - кадр новой
 * темы живой, и это движение видно сквозь растворение.
 *
 * Пока идёт растворение, на <html> висит .theme-vt: по нему тумблер выходит из
 * общего кадра, и его черта едет своим ходом, а не двоится.
 */
export type Theme = 'light' | 'dark';
export type ThemeChoice = Theme | 'system';

const KEY = 'ba.theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

export function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : 'system';
  } catch {
    return 'system';
  }
}

const systemTheme = (): Theme => (media.matches ? 'dark' : 'light');
const readTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

let shifting: { finished: Promise<unknown> } | null = null;

/** Поставить тему на экран - одним растворением всей страницы. */
export function applyTheme(next: Theme): void {
  const html = document.documentElement;
  if (readTheme() === next) return;
  const swap = () => {
    html.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]:not([media])')?.setAttribute('content', next === 'dark' ? '#0e100f' : '#f3f1ea');
    listeners.forEach((l) => l());
  };
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  type Transition = { finished: Promise<unknown>; ready?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
  const start = (document as Document & { startViewTransition?: (cb: () => void) => Transition }).startViewTransition;
  // Скрытая вкладка (тема сменилась вслед за системой) кадр не снимет.
  if (reduced || !start || document.visibilityState !== 'visible') {
    swap();
    return;
  }
  html.classList.add('theme-vt');
  const transition = start.call(document, swap);
  shifting = transition;
  // Поворот телефона или смена размера окна посреди растворения срывает его:
  // тема к этому моменту уже стоит, просто без растворения. Это не ошибка.
  transition.ready?.catch(() => undefined);
  transition.updateCallbackDone?.catch(() => undefined);
  void transition.finished.catch(() => undefined).finally(() => {
    // Новое нажатие посреди растворения обрывает прежнее - класс снимает последнее.
    if (shifting !== transition) return;
    shifting = null;
    html.classList.remove('theme-vt');
  });
}

export function setChoice(next: ThemeChoice): void {
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* приватный режим - выбор не запомнится, но экран переключится */
  }
  applyTheme(next === 'system' ? systemTheme() : next);
  listeners.forEach((l) => l());
}

/** Пока человек не выбрал тему сам, страница идёт за системой - тем же растворением. */
media.addEventListener('change', (e) => {
  if (readChoice() === 'system') applyTheme(e.matches ? 'dark' : 'light');
});

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/** Что стоит на экране сейчас. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme);
}

/** Подписка без React: небо на входе меняет свет вслед за темой. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  const l = () => listener(readTheme());
  listeners.add(l);
  return () => listeners.delete(l);
}

export const currentTheme = readTheme;
