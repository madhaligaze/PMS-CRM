import { useMutation } from '@tanstack/react-query';
import qrcode from 'qrcode-generator';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useAttendanceMe, useInvalidate } from '@/api/hooks';
import { CabinetTabs } from '@/app/cabinet-tabs';
import { changePassword, reloadMe, useCan, useProperty, useSession } from '@/auth/session';
import { Field } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';
import { phone as fmtPhone, time } from '@/lib/format';
import './profile.css';

/** Ошибка сервера словами - под формой, а не всплывашкой: её надо прочитать и исправить. */
const message = (e: unknown) => (isApiError(e) ? (e.detail ? `${e.message}. ${e.detail}` : e.message) : 'Нет связи с сервером');

/**
 * Профиль: своё имя и телефон, пароль, PIN для планшета прихода, вход с кодом
 * из приложения и своя отметка прихода. Каждый блок сохраняется сам по себе.
 */
export function ProfilePage() {
  const session = useSession();
  const property = useProperty();
  const can = useCan();
  const me = session.me!;
  // Вход с кодом обязателен, а не настроен: сервер закрыл гостиницу до настройки.
  // Поэтому здесь только то, что работает без неё, и блок с кодом - первым.
  const locked = me.totpSetupRequired;
  return (
    <div className="page profile">
      {locked ? null : <CabinetTabs />}
      <div className="page-head">
        <div>
          <h1 className="page-title">{me.fullName}</h1>
          <p className="page-sub">
            {[property.position ?? property.accessLabel, me.login, me.phone ? fmtPhone(me.phone) : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {locked ? (
        <div className="alert profile-lock" role="alert">
          <strong>Настройте вход с кодом из приложения.</strong> Для вашей учётной записи он обязателен: разделы гостиницы откроются сразу после настройки.
        </div>
      ) : null}
      <div className="profile-grid">
        {locked ? <Totp /> : null}
        <Personal />
        {can('attendance.self') && !locked ? <Attendance /> : null}
        <Password />
        <Pin />
        {locked ? null : <Totp />}
      </div>
    </div>
  );
}

function Block({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="profile-block">
      <div className="row-between">
        <h2 className="section-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Personal() {
  const me = useSession().me!;
  const [fullName, setFullName] = useState(me.fullName);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => unwrap(api.PATCH('/api/v1/me', { body: { fullName: fullName.trim(), phone: phone.trim() || null } })),
    onSuccess: async () => {
      setError(null);
      await reloadMe();
      toast.info('Сохранено');
    },
    onError: (e) => setError(message(e)),
  });
  const dirty = fullName.trim() !== me.fullName || (phone.trim() || null) !== me.phone;
  return (
    <Block title="Имя и телефон">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Имя и фамилия" htmlFor="p-name">
          <input id="p-name" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Телефон" htmlFor="p-phone" optional>
          <input id="p-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </Field>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || fullName.trim().length < 3 || save.isPending}>
            Сохранить
          </button>
        </div>
      </form>
    </Block>
  );
}

function Attendance() {
  const status = useAttendanceMe();
  const property = useProperty();
  const invalidate = useInvalidate();
  const clock = useMutation({
    mutationFn: (kind: 'in' | 'out') => unwrap(api.POST('/api/v1/properties/{propertyId}/attendance/clock', { params: { path: pid() }, body: { kind } })),
    onSuccess: (s) => {
      toast.info(s.clockedIn ? 'Приход отмечен' : 'Уход отмечен');
      void invalidate('attendance', 'cash', 'dashboard', 'staff');
    },
    onError: toast.fail,
  });
  const s = status.data;
  return (
    <Block title="Рабочий день">
      {s ? (
        <div className="stack">
          <p>{s.clockedIn && s.since ? `На работе с ${time(s.since, property.timezone)}` : 'Приход не отмечен'}</p>
          <div className="row">
            <button type="button" className={`btn btn-sm ${s.clockedIn ? 'btn-ghost' : 'btn-primary'}`} disabled={clock.isPending} onClick={() => clock.mutate(s.clockedIn ? 'out' : 'in')}>
              {s.clockedIn ? 'Отметить уход' : 'Отметить приход'}
            </button>
          </div>
        </div>
      ) : null}
    </Block>
  );
}

function Password() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setError('Новый пароль - не короче 8 знаков');
    if (next !== repeat) return setError('Пароли не совпадают');
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      toast.info('Пароль изменён');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Block title="Пароль">
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="Текущий пароль" htmlFor="pw-current">
          <input id="pw-current" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <div className="grid-2">
          <Field label="Новый пароль" htmlFor="pw-next" hint="Не короче 8 знаков">
            <input id="pw-next" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Ещё раз" htmlFor="pw-repeat">
            <input id="pw-repeat" type="password" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
          </Field>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={!current || !next || !repeat || busy}>
            Сменить пароль
          </button>
        </div>
      </form>
    </Block>
  );
}

function Pin() {
  const me = useSession().me!;
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/me/pin', { body: { pin } })),
    onSuccess: async () => {
      setPin('');
      setRepeat('');
      setError(null);
      await reloadMe();
      toast.info('PIN сохранён');
    },
    onError: (e) => setError(message(e)),
  });
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <Block title="PIN для планшета прихода" aside={<span className="muted">{me.hasPin ? 'задан' : 'не задан'}</span>}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (pin !== repeat) return setError('PIN не совпадает');
          save.mutate();
        }}
      >
        <div className="grid-2">
          <Field label="Новый PIN" htmlFor="pin-new" hint="От 4 до 6 цифр">
            <input id="pin-new" type="password" inputMode="numeric" className="input num" value={pin} onChange={(e) => setPin(digits(e.target.value))} autoComplete="off" />
          </Field>
          <Field label="Ещё раз" htmlFor="pin-repeat">
            <input id="pin-repeat" type="password" inputMode="numeric" className="input num" value={repeat} onChange={(e) => setRepeat(digits(e.target.value))} autoComplete="off" />
          </Field>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
        <div className="row">
          <button type="submit" className="btn btn-primary btn-sm" disabled={pin.length < 4 || !repeat || save.isPending}>
            Сохранить PIN
          </button>
        </div>
      </form>
    </Block>
  );
}

/** QR-код ключа для приложения-аутентификатора: рисуется здесь же, ключ никуда не уходит. */
function QrCode({ text }: { text: string }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [text]);
  return <div className="qr" role="img" aria-label="QR-код для приложения-аутентификатора" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function Totp() {
  const me = useSession().me!;
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [setup]);
  const start = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/me/totp/setup')),
    onSuccess: (r) => {
      setSetup(r);
      setCode('');
    },
    onError: (e) => setError(message(e)),
  });
  const enable = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/me/totp/enable', { body: { code } })),
    onSuccess: async () => {
      setSetup(null);
      setCode('');
      await reloadMe();
      toast.info('Вход с кодом из приложения включён');
    },
    onError: (e) => setError(message(e)),
  });
  const disable = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/me/totp/disable', { body: { code } })),
    onSuccess: async () => {
      setCode('');
      await reloadMe();
      toast.info('Вход с кодом выключен');
    },
    onError: (e) => setError(message(e)),
  });
  const codeInput = (
    <Field label="Код из приложения" htmlFor="totp-code">
      <input id="totp-code" className="input num totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
    </Field>
  );
  return (
    <Block title="Вход с кодом из приложения" aside={<span className={me.totpSetupRequired ? 'danger' : 'muted'}>{me.totpEnabled ? 'включён' : me.totpRequired ? 'обязателен, не настроен' : 'выключен'}</span>}>
      {me.totpEnabled ? (
        <div className="stack">
          <p className="muted">При входе после пароля нужен шестизначный код из приложения (Google Authenticator, Яндекс Ключ, Microsoft Authenticator).</p>
          {me.totpRequired ? (
            <p className="muted">Для вашей учётной записи он обязателен - выключить нельзя.</p>
          ) : (
            <>
              {codeInput}
              {error ? <p className="field-error">{error}</p> : null}
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" disabled={code.length < 6 || disable.isPending} onClick={() => disable.mutate()}>
                  Выключить
                </button>
              </div>
            </>
          )}
        </div>
      ) : setup ? (
        <div className="totp-setup">
          <QrCode text={setup.otpauthUrl} />
          <div className="stack">
            <p>Отсканируйте код приложением-аутентификатором и введите шесть цифр, которые оно покажет.</p>
            <p className="muted">
              Без камеры: ключ <span className="mono totp-secret">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</span>
            </p>
            {codeInput}
            {error ? <p className="field-error">{error}</p> : null}
            <div className="row">
              <button type="button" className="btn btn-primary btn-sm" disabled={code.length < 6 || enable.isPending} onClick={() => enable.mutate()}>
                Включить
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setSetup(null)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Второй шаг входа: даже узнав пароль, без вашего телефона не войти.</p>
          {error ? <p className="field-error">{error}</p> : null}
          <div className="row">
            <button type="button" className="btn btn-primary btn-sm" disabled={start.isPending} onClick={() => start.mutate()}>
              Настроить
            </button>
          </div>
        </div>
      )}
    </Block>
  );
}
