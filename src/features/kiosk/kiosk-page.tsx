import { useEffect, useRef, useState } from 'react';
import { ApiError, errorText } from '@/api/errors';
import { API_BASE, deviceProperty } from '@/auth/session';
import { Mark } from '@/components/brand/mark';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import './kiosk.css';

const RECENT_KEY = 'ba.kiosk.recent';
const PROPERTY_KEY = 'ba.property';

/** Последние логины на этом планшете: чтобы не набирать свой каждый день. */
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}
function remember(login: string) {
  try {
    const next = [login, ...readRecent().filter((x) => x !== login)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* приватный режим: просто без подсказок */
  }
}

/**
 * Гостиница планшета: из ссылки ?p=<id> (её даёт страница настроек), иначе
 * та, в которой на этом устройстве последний раз работали.
 */
function kioskProperty(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get('p');
  if (fromUrl && /^[0-9a-f-]{36}$/i.test(fromUrl)) {
    try {
      localStorage.setItem(PROPERTY_KEY, fromUrl);
    } catch {
      /* приватный режим */
    }
    return fromUrl;
  }
  return deviceProperty();
}

type Result = { name: string; kind: 'in' | 'out'; at: string };

/**
 * Общий планшет прихода и ухода. Входа в систему здесь нет: сотрудник
 * набирает логин и PIN, отметка пишется на сервере. Неверная пара не
 * раскрывает, что именно неверно, а частые попытки сервер притормозит.
 */
export function KioskPage() {
  const [propertyId] = useState(kioskProperty);
  const [login, setLogin] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [recent, setRecent] = useState(readRecent);
  const [now, setNow] = useState(() => new Date());
  const pinRef = useRef<HTMLInputElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(t);
  }, []);

  // Результат висит несколько секунд и уступает место следующему сотруднику.
  useEffect(() => {
    if (!result) return;
    const t = window.setTimeout(() => {
      setResult(null);
      loginRef.current?.focus();
    }, 5000);
    return () => window.clearTimeout(t);
  }, [result]);

  const submit = async () => {
    if (!propertyId || busy || !login.trim() || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/kiosk/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyId, login: login.trim(), pin }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new ApiError(res.status, body);
      remember(login.trim());
      setRecent(readRecent());
      setResult(body as Result);
      setLogin('');
      setPin('');
    } catch (e) {
      setPin('');
      if (e instanceof ApiError && e.status === 429) setError(e.detail ? `${e.message}. ${e.detail}` : 'Слишком много попыток. Подождите минуту.');
      else setError(errorText(e).title);
      pinRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    setError(null);
    setPin((p) => (p.length < 6 ? p + d : p));
  };

  const clock = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="kiosk">
      <header className="kiosk-top">
        <span className="kiosk-brand">
          <Mark className="kiosk-mark" />
          Отметка прихода
        </span>
        <ThemeSwitch />
      </header>

      <div className="kiosk-body">
        <div className="kiosk-time" aria-live="off">
          <span className="kiosk-clock">{clock}</span>
          <span className="kiosk-date">{date}</span>
        </div>

        {!propertyId ? (
          <div className="kiosk-panel">
            <h1 className="kiosk-title">Планшет ещё не знает гостиницу</h1>
            <p className="ink-2">
              Откройте ссылку для планшета из «Настроек гостиницы» или один раз войдите здесь под своей учётной записью и выйдите: планшет запомнит гостиницу.
            </p>
            <a className="btn btn-primary" href="/login">
              Войти
            </a>
          </div>
        ) : result ? (
          <div className="kiosk-panel kiosk-done" role="status">
            <span className="kiosk-kind">{result.kind === 'in' ? 'Приход отмечен' : 'Уход отмечен'}</span>
            <span className="kiosk-name">{result.name}</span>
            <span className="kiosk-at">{new Date(result.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>
              Следующий
            </button>
          </div>
        ) : (
          <form
            className="kiosk-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="k-login">
                Логин
              </label>
              <input
                ref={loginRef}
                id="k-login"
                className="input kiosk-input"
                value={login}
                onChange={(e) => {
                  setLogin(e.target.value);
                  setError(null);
                }}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              {recent.length ? (
                <div className="kiosk-recent" aria-label="Недавние логины">
                  {recent.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="choice"
                      aria-pressed={login === r}
                      onClick={() => {
                        setLogin(r);
                        setError(null);
                        pinRef.current?.focus();
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="k-pin">
                PIN
              </label>
              <input
                ref={pinRef}
                id="k-pin"
                className="input kiosk-input kiosk-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                  setError(null);
                }}
              />
            </div>
            <div className="kiosk-pad" aria-label="Цифры PIN">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" className="kiosk-key" onClick={() => press(d)}>
                  {d}
                </button>
              ))}
              <button type="button" className="kiosk-key kiosk-key-quiet" onClick={() => setPin('')} aria-label="Стереть PIN">
                Стереть
              </button>
              <button type="button" className="kiosk-key" onClick={() => press('0')}>
                0
              </button>
              <button type="button" className="kiosk-key kiosk-key-quiet" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Удалить цифру">
                ←
              </button>
            </div>
            {error ? (
              <p className="field-error kiosk-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary btn-block kiosk-go" disabled={busy || !login.trim() || pin.length < 4}>
              {busy ? 'Отмечаю' : 'Отметиться'}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
