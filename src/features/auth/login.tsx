import { useEffect, useRef, useState, type FormEvent } from 'react';
import { isApiError } from '@/api/errors';
import { changePassword, login, logout, registerOwner, setupNeeded, useSession } from '@/auth/session';
import { Mark } from '@/components/brand/mark';
import { gsap, prefersReducedMotion, useGSAP } from '@/components/motion/gsap';
import { SkyStage } from '@/components/motion/sky-stage';
import { ThemeSwitch } from '@/components/theme/theme-switch';
import './auth.css';

const DEMO: [string, string][] = [
  ['owner', 'Владелец'],
  ['senior', 'Старший администратор'],
  ['reception', 'Ресепшен'],
  ['callcenter', 'Колл-центр'],
  ['maid', 'Горничная'],
  ['supervisor', 'Супервайзер'],
  ['tech', 'Техник'],
  ['accountant', 'Бухгалтер'],
];
const showDemo = import.meta.env.DEV || import.meta.env.VITE_DEMO === 'true';

/** Деталь шаңырақа: отрезок с центром, длиной и углом - так её удобно вести по экрану. */
type Piece = { x: number; y: number; len: number; rot: number; angle: number };

const deg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Шаңырақ в центре экрана: обод из 24 хорд и шесть перекладин, каждая из двух
 * половин. Хорды на таком радиусе неотличимы от окружности, поэтому обод
 * рисуется кругом, а в момент распада подменяется ими незаметно.
 */
function shanyrak(cx: number, cy: number, r: number) {
  const pieces: Piece[] = [];
  const chords = 24;
  for (let k = 0; k < chords; k++) {
    const a0 = (k / chords) * Math.PI * 2;
    const a1 = ((k + 1) / chords) * Math.PI * 2;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const x = (x0 + x1) / 2;
    const y = (y0 + y1) / 2;
    pieces.push({ x, y, len: Math.hypot(x1 - x0, y1 - y0), rot: deg(Math.atan2(y1 - y0, x1 - x0)), angle: Math.atan2(y - cy, x - cx) });
  }
  const laths: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const d of [-8.5 / 26, 0, 8.5 / 26]) {
    const off = d * r;
    const half = Math.sqrt(r * r - off * off);
    laths.push({ x1: cx - half, y1: cy + off, x2: cx + half, y2: cy + off });
    laths.push({ x1: cx + off, y1: cy - half, x2: cx + off, y2: cy + half });
  }
  for (const l of laths) {
    const mx = (l.x1 + l.x2) / 2;
    const my = (l.y1 + l.y2) / 2;
    for (const [ax, ay, bx, by] of [
      [l.x1, l.y1, mx, my],
      [mx, my, l.x2, l.y2],
    ] as const) {
      const x = (ax + bx) / 2;
      const y = (ay + by) / 2;
      pieces.push({ x, y, len: Math.hypot(bx - ax, by - ay), rot: deg(Math.atan2(by - ay, bx - ax)), angle: Math.atan2(y - cy, x - cx) });
    }
  }
  return { pieces, laths };
}

/** Рамка окна входа, разбитая на столько же реек, по часовой стрелке от верхнего левого угла. */
function frame(rect: DOMRect, count: number): Piece[] {
  const { left, top, width: w, height: h } = rect;
  const perimeter = 2 * (w + h);
  const nW = Math.max(2, Math.round((count * w) / perimeter));
  const nH = Math.max(2, Math.floor((count - 2 * nW) / 2));
  const extra = count - 2 * nW - 2 * nH;
  const out: Piece[] = [];
  const cx = left + w / 2;
  const cy = top + h / 2;
  const edge = (n: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n;
      const ay = y0 + ((y1 - y0) * i) / n;
      const bx = x0 + ((x1 - x0) * (i + 1)) / n;
      const by = y0 + ((y1 - y0) * (i + 1)) / n;
      const x = (ax + bx) / 2;
      const y = (ay + by) / 2;
      out.push({ x, y, len: Math.hypot(bx - ax, by - ay), rot: deg(Math.atan2(by - ay, bx - ax)), angle: Math.atan2(y - cy, x - cx) });
    }
  };
  edge(nW + extra, left, top, left + w, top);
  edge(nH, left + w, top, left + w, top + h);
  edge(nW, left + w, top + h, left, top + h);
  edge(nH, left, top + h, left, top);
  return out;
}

/** Угол от верхнего левого направления по часовой стрелке: так рейки и места рамки сопоставляются без перекрёстков. */
const clockwise = (a: number) => (a + (3 * Math.PI) / 4 + Math.PI * 4) % (Math.PI * 2);

/** Ближайший к исходному угол того же направления: рейка не крутится лишние полоборота. */
function nearRot(from: number, to: number) {
  let r = to;
  while (r - from > 90) r -= 180;
  while (from - r > 90) r += 180;
  return r;
}

/**
 * Вход. Порядок задан продуктом: небо проявляется, рисуется шаңырақ, распадается
 * на рейки, и из них по центру собирается окно входа. Клик или клавиша сразу
 * доводят сборку до конца; нажатая буква не теряется - уходит в поле логина.
 */
export function LoginPage() {
  const session = useSession();
  const root = useRef<HTMLDivElement>(null);
  const loginRef = useRef<HTMLInputElement>(null);
  const finishRef = useRef<() => void>(() => {});
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [setup, setSetup] = useState<boolean | null>(null);
  const [loginValue, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void setupNeeded().then(setSetup);
  }, []);

  const mustChange = session.status === 'authenticated' && !!session.me?.mustChangePassword;
  const mode: 'login' | 'setup' | 'change' = mustChange ? 'change' : setup ? 'setup' : 'login';

  const cx = view.w / 2;
  const cy = view.h / 2;
  const radius = Math.min(view.w, view.h) * (view.w < 700 ? 0.27 : 0.19);
  const geo = shanyrak(cx, cy, radius);

  useGSAP(
    () => {
      const el = root.current!;
      const sky = el.querySelector('.sky');
      const card = el.querySelector('.auth-card');
      const build = el.querySelector('.auth-build');
      const ring = el.querySelector('.build-ring');
      const laths = el.querySelectorAll('.build-lath');
      const pieces = gsap.utils.toArray<SVGLineElement>('.build-piece', el);
      const content = el.querySelectorAll('.auth-brand, .auth-form > *');
      let done = false;
      let assembled: gsap.core.Timeline | null = null;

      const reveal = () => {
        done = true;
        gsap.set([sky, card], { autoAlpha: 1 });
        gsap.set(build, { autoAlpha: 0 });
        gsap.set(content, { clearProps: 'all' });
        loginRef.current?.focus({ preventScroll: true });
      };

      if (prefersReducedMotion()) {
        reveal();
        return;
      }

      gsap.set(sky, { autoAlpha: 0 });
      gsap.set(card, { autoAlpha: 0 });
      gsap.set(build, { autoAlpha: 1 });
      gsap.set(pieces, { autoAlpha: 0 });
      geo.pieces.forEach((p, i) => gsap.set(pieces[i]!, { x: p.x, y: p.y, rotation: p.rot, scaleX: 1, transformOrigin: '50% 50%' }));

      // Распад и сборка: места рамки известны, только когда окно уже свёрстано.
      const assemble = () => {
        if (assembled) return assembled;
        const rect = (card as HTMLElement).getBoundingClientRect();
        const targets = frame(rect, geo.pieces.length).sort((a, b) => clockwise(a.angle) - clockwise(b.angle));
        const order = geo.pieces.map((p, i) => ({ p, i })).sort((a, b) => clockwise(a.p.angle) - clockwise(b.p.angle));
        const tl = gsap.timeline({ onComplete: reveal });
        tl.set([ring, laths], { autoAlpha: 0 }, 0).set(pieces, { autoAlpha: 1 }, 0);
        // Шаңырақ расходится: каждая рейка отходит от центра и поворачивается.
        order.forEach(({ p, i }, k) => {
          const push = 14 + ((k * 37) % 23);
          tl.to(
            pieces[i]!,
            { x: p.x + Math.cos(p.angle) * push, y: p.y + Math.sin(p.angle) * push, rotation: p.rot + (((k * 53) % 31) - 15), duration: 0.38, ease: 'power2.out' },
            ((k * 7) % 9) * 0.004,
          );
        });
        // Рейки летят на свои места в рамке - по дуге, по часовой, одна за другой.
        order.forEach(({ p, i }, k) => {
          const t = targets[k]!;
          const push = 14 + ((k * 37) % 23);
          const sx = p.x + Math.cos(p.angle) * push;
          const sy = p.y + Math.sin(p.angle) * push;
          // Дуга выгибается наружу: середина пути отнесена от центра экрана.
          const mx = (sx + t.x) / 2 + Math.cos(t.angle) * 40;
          const my = (sy + t.y) / 2 + Math.sin(t.angle) * 40;
          tl.to(
            pieces[i]!,
            {
              motionPath: { path: [{ x: sx, y: sy }, { x: mx, y: my }, { x: t.x, y: t.y }], curviness: 1.1 },
              rotation: nearRot(p.rot, t.rot),
              scaleX: t.len / p.len,
              duration: 0.85,
              ease: 'power2.inOut',
            },
            0.42 + k * 0.014,
          );
        });
        tl.to(card, { autoAlpha: 1, duration: 0.45, ease: 'power2.out' }, '>-0.15')
          .from(content, { y: 10, autoAlpha: 0, duration: 0.45, stagger: 0.045, ease: 'power2.out' }, '<0.05')
          .to(build, { autoAlpha: 0, duration: 0.4, ease: 'power1.out' }, '<0.1');
        assembled = tl;
        return tl;
      };

      const intro = gsap.timeline({ defaults: { ease: 'power2.inOut' }, onComplete: () => void assemble() });
      intro
        .to(sky, { autoAlpha: 1, duration: 1.0, ease: 'power1.out' }, 0)
        .fromTo(ring, { drawSVG: '0%' }, { drawSVG: '100%', duration: 1.0 }, 0.25)
        .fromTo(laths, { drawSVG: '50% 50%' }, { drawSVG: '0% 100%', duration: 0.7, stagger: 0.06, ease: 'power3.out' }, 0.8)
        .to({}, { duration: 0.15 });

      finishRef.current = () => {
        if (done) return;
        intro.progress(1);
        assemble().progress(1);
      };
      // Покадровая проверка сборки в Playwright (pw-finmap/bizdin/login-frames.cjs): только в разработке.
      if (import.meta.env.DEV) Object.assign(window, { __authIntro: { intro, assemble } });
      // Размер окна поменялся посреди сборки - места рамки устарели: сразу к концу.
      const onResize = () => finishRef.current();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    },
    { scope: root },
  );

  useEffect(() => {
    const onResize = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Клик или клавиша во время сборки - сразу к окну; буква уходит в логин.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = root.current?.querySelector<HTMLElement>('.auth-card');
      if (!el || getComputedStyle(el).visibility === 'visible') return;
      finishRef.current();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && mode === 'login') {
        e.preventDefault();
        setLogin((v) => v + e.key);
        loginRef.current?.focus();
      }
    };
    const onPointer = () => finishRef.current();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [mode]);

  async function submit(e?: FormEvent, preset?: { login: string; password: string }) {
    e?.preventDefault();
    const creds = preset ?? { login: loginValue.trim(), password };
    if (!creds.login || !creds.password) {
      setError('Введите логин и пароль');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (preset) setPassword(preset.password);
      await login({ ...creds, ...(needCode && code ? { totpCode: code } : {}) });
    } catch (err) {
      if (isApiError(err, 'auth.totp_required')) {
        setNeedCode(true);
        setError(null);
      } else if (isApiError(err)) {
        setError(err.detail ? `${err.message}. ${err.detail}` : err.message);
      } else {
        setError('Нет связи с сервером. Проверьте сеть.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={root} className="auth">
      <SkyStage />
      <svg className="auth-build" viewBox={`0 0 ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden="true">
        <circle className="build-ring" cx={cx} cy={cy} r={radius} />
        {geo.laths.map((l, i) => (
          <line key={i} className="build-lath" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
        ))}
        {geo.pieces.map((p, i) => (
          <line key={i} className="build-piece" x1={-p.len / 2} y1={0} x2={p.len / 2} y2={0} />
        ))}
      </svg>
      <div className="auth-corner">
        <ThemeSwitch />
      </div>
      <main className="auth-center">
        <section className="auth-card" aria-label={mode === 'setup' ? 'Регистрация гостиницы' : mode === 'change' ? 'Новый пароль' : 'Вход'}>
          <header className="auth-brand">
            <Mark className="auth-brand-mark" />
            <span>Bizdin Auyl</span>
          </header>
          {mode === 'setup' ? (
            <SetupForm />
          ) : mode === 'change' ? (
            <ChangeForm knownPassword={password} name={session.me?.fullName ?? ''} />
          ) : (
            <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
              <div className="field">
                <label className="field-label" htmlFor="login">
                  Логин
                </label>
                <input
                  ref={loginRef}
                  id="login"
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={loginValue}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="password">
                  Пароль
                </label>
                <input id="password" type="password" className="input" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              {needCode ? (
                <div className="field">
                  <label className="field-label" htmlFor="totp">
                    Код из приложения
                  </label>
                  <input
                    id="totp"
                    className="input num"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </div>
              ) : null}
              {error ? (
                <p className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}
              <button type="submit" className="btn btn-primary btn-block auth-go" disabled={busy}>
                {busy ? 'Входим' : 'Войти'}
              </button>
              <a className="btn-quiet auth-kiosk" href="/kiosk">
                Отметить приход по PIN
              </a>
              {showDemo ? (
                <div className="auth-demo">
                  <label className="auth-demo-title" htmlFor="demo-as">
                    Демо: войти как
                  </label>
                  <select
                    id="demo-as"
                    className="select"
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && void submit(undefined, { login: e.target.value, password: 'demo12345' })}
                  >
                    <option value="">Выберите сотрудника</option>
                    {DEMO.map(([l, label]) => (
                      <option key={l} value={l}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </form>
          )}
        </section>
      </main>
    </div>
  );
}

/** Регистрация: первая гостиница и её владелец. Работает, пока в системе нет ни одной гостиницы. */
function SetupForm() {
  const [form, setForm] = useState({ hotelName: '', fullName: '', phone: '', login: '', password: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.password !== form.repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerOwner({
        hotelName: form.hotelName.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || null,
        login: form.login.trim(),
        password: form.password,
      });
    } catch (err) {
      if (isApiError(err, 'validation')) setError(Object.values(err.fieldErrors).join('; ') || err.message);
      else if (isApiError(err)) setError(err.detail ? `${err.message}. ${err.detail}` : err.message);
      else setError('Нет связи с сервером. Проверьте сеть.');
    } finally {
      setBusy(false);
    }
  }

  const valid = form.hotelName.trim().length >= 2 && form.fullName.trim().length >= 3 && form.login.trim().length >= 3 && form.password.length >= 8;
  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="auth-title">Регистрация гостиницы</h1>
      <div className="field">
        <label className="field-label" htmlFor="su-hotel">
          Название гостиницы
        </label>
        <input id="su-hotel" className="input" value={form.hotelName} onChange={(e) => set({ hotelName: e.target.value })} autoComplete="organization" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="su-name">
          Ваши имя и фамилия
        </label>
        <input id="su-name" className="input" value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} autoComplete="name" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="su-phone">
          Телефон <span className="opt">- необязательно</span>
        </label>
        <input id="su-phone" className="input" inputMode="tel" placeholder="+7 701 123 45 67" value={form.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="tel" />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="su-login">
          Логин
        </label>
        <input id="su-login" className="input" autoCapitalize="none" spellCheck={false} value={form.login} onChange={(e) => set({ login: e.target.value })} autoComplete="username" />
        <div className="field-hint">Латиница, цифры, точка или дефис</div>
      </div>
      <div className="auth-pair">
        <div className="field">
          <label className="field-label" htmlFor="su-pass">
            Пароль
          </label>
          <input id="su-pass" type="password" className="input" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="su-repeat">
            Ещё раз
          </label>
          <input id="su-repeat" type="password" className="input" value={form.repeat} onChange={(e) => set({ repeat: e.target.value })} autoComplete="new-password" />
        </div>
      </div>
      <div className="field-hint">Пароль - не короче 8 знаков</div>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block auth-go" disabled={busy || !valid}>
        {busy ? 'Регистрируем' : 'Зарегистрировать'}
      </button>
    </form>
  );
}

/** Пароль выдан управляющим: до работы - свой. Временный уже введён при входе - второй раз его не спрашиваем. */
function ChangeForm({ knownPassword, name }: { knownPassword: string; name: string }) {
  const [current, setCurrent] = useState(knownPassword);
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) {
      setError('Пароль - не короче 8 знаков');
      return;
    }
    if (next !== repeat) {
      setError('Пароли не совпадают');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
    } catch (err) {
      if (isApiError(err, 'validation')) setError(Object.values(err.fieldErrors).join('; ') || err.message);
      else if (isApiError(err)) setError(err.message);
      else setError('Нет связи с сервером. Проверьте сеть.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={(e) => void submit(e)} noValidate>
      <h1 className="auth-title">{name.split(' ')[0] ? `${name.split(' ')[0]}, придумайте пароль` : 'Придумайте пароль'}</h1>
      <p className="auth-lead">Пароль выдал управляющий - дальше вы входите со своим.</p>
      {!knownPassword ? (
        <div className="field">
          <label className="field-label" htmlFor="ch-current">
            Временный пароль
          </label>
          <input id="ch-current" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
      ) : null}
      <div className="field">
        <label className="field-label" htmlFor="ch-next">
          Новый пароль
        </label>
        <input id="ch-next" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" autoFocus />
        <div className="field-hint">Не короче 8 знаков</div>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="ch-repeat">
          Ещё раз
        </label>
        <input id="ch-repeat" type="password" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
      </div>
      {error ? (
        <p className="auth-error" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block auth-go" disabled={busy || !next || !repeat || !current}>
        {busy ? 'Сохраняем' : 'Сохранить и войти'}
      </button>
      <button type="button" className="btn-quiet auth-kiosk" onClick={() => void logout()}>
        Выйти
      </button>
    </form>
  );
}
