import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useAccessCatalog, useInvalidate, usePositions, useStaff, type S } from '@/api/hooks';
import { CabinetTabs } from '@/app/cabinet-tabs';
import { useCan, useProperty, useSession } from '@/auth/session';
import { Choices, Empty, Field, Loading } from '@/components/ui/bits';
import { Combobox } from '@/components/ui/combobox';
import { Menu } from '@/components/ui/menu';
import { Dialog, Modal } from '@/components/ui/overlay';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { History } from '@/features/bookings/history';
import { dateTime, phone as fmtPhone } from '@/lib/format';
import { suggestLogin } from '@/lib/translit';
import { RightsMatrix, rightsSummary, sameRights, type Catalog, type Rights } from './rights-matrix';
import './staff.css';

type Staff = S['Staff'];
type Position = S['Position'];
export type Secrets = { name: string; login: string; password: string | null; pin: string | null };

const NO_RIGHTS: Rights = { sections: {}, powers: [] };

/** Состояние одной строкой: словом, цвет - только для отказа. */
function stateOf(s: Staff, tz: string): { text: string; fail?: boolean } {
  if (s.archivedAt) return { text: `уволен ${dateTime(s.archivedAt, tz)}` };
  if (!s.isActive) return { text: 'вход заблокирован', fail: true };
  if (s.mustChangePassword) return { text: 'ещё не задал свой пароль' };
  if (s.totpRequired && !s.totpEnabled) return { text: 'не настроен второй фактор', fail: true };
  if (s.clockedIn) return { text: 'на работе' };
  return { text: s.lastLoginAt ? `входил ${dateTime(s.lastLoginAt, tz)}` : 'ещё не входил' };
}

function accessText(s: Staff): string {
  return s.access === 'staff' ? rightsSummary(s.rights) : 'всё открыто';
}

/** Сотрудники: нанять, открыть права, заблокировать, уволить. Себя и владельца отсюда не меняют. */
export function StaffPage() {
  const can = useCan();
  const property = useProperty();
  const [archived, setArchived] = useState<'active' | 'archived'>('active');
  const [q, setQ] = useState('');
  const staff = useStaff(archived === 'archived');
  const [openId, setOpenId] = useState<string | null>(null);
  const [hiring, setHiring] = useState(false);
  const [secrets, setSecrets] = useState<Secrets | null>(null);

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (staff.data ?? []).filter((s) => !t || s.fullName.toLowerCase().includes(t) || s.login.toLowerCase().includes(t) || (s.position?.name ?? '').toLowerCase().includes(t));
  }, [staff.data, q]);

  return (
    <div className="page">
      <CabinetTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Сотрудники</h1>
        </div>
        <div className="page-actions">
          <input className="input" style={{ width: 240 }} placeholder="Имя, логин или должность" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск сотрудника" />
          {can('staff.manage') ? (
            <button type="button" className="btn btn-primary" onClick={() => setHiring(true)}>
              Нанять
            </button>
          ) : null}
        </div>
      </div>
      <div className="list-filter">
        <Choices
          label="Кого показать"
          value={archived}
          onChange={setArchived}
          options={[
            ['active', 'Работают'],
            ['archived', 'Уволенные'],
          ]}
        />
      </div>
      {staff.isPending ? (
        <Loading />
      ) : staff.isError ? (
        <Empty title="Список не загрузился">Обновите страницу.</Empty>
      ) : !rows.length ? (
        <Empty title={q ? 'Никого не нашли' : archived === 'archived' ? 'Уволенных нет' : 'Сотрудников пока нет'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Должность</th>
                <th>Права</th>
                <th>Состояние</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const st = stateOf(s, property.timezone);
                return (
                  <tr key={s.id} data-clickable onClick={() => setOpenId(s.id)}>
                    <td>
                      {s.fullName}
                      <span className="sub">{s.login}</span>
                    </td>
                    <td>
                      {s.position?.name ?? <span className="muted">-</span>}
                      {s.access !== 'staff' ? <span className="sub">{s.accessLabel}</span> : null}
                    </td>
                    <td>{accessText(s)}</td>
                    <td className={st.fail ? 'danger' : undefined}>{st.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <EmployeeModal id={openId} onClose={() => setOpenId(null)} onSecrets={setSecrets} />
      <HireModal
        open={hiring}
        onClose={() => setHiring(false)}
        onDone={(s, id) => {
          setHiring(false);
          setSecrets(s);
          setOpenId(id);
        }}
      />
      <SecretsDialog data={secrets} onClose={() => setSecrets(null)} />
    </div>
  );
}

/** Временный пароль и PIN - один раз: их передают человеку, при первом входе он задаёт свой пароль. */
export function SecretsDialog({ data: incoming, onClose }: { data: Secrets | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  // Пока окно гаснет, в нём остаются прежние данные, а не пустота.
  const [data, setData] = useState<Secrets | null>(incoming);
  useEffect(() => {
    setCopied(false);
    if (incoming) setData(incoming);
  }, [incoming]);
  if (!data) return null;
  const text = [`Вход в Bizdin Auyl: ${window.location.origin}`, `Логин: ${data.login}`, data.password ? `Временный пароль: ${data.password}` : null, data.pin ? `PIN для отметки прихода: ${data.pin}` : null]
    .filter(Boolean)
    .join('\n');
  return (
    <Dialog open={!!incoming} onClose={onClose} title={`Передайте: ${data.name}`}>
      <dl className="facts secrets">
        <dt>Логин</dt>
        <dd className="mono">{data.login}</dd>
        {data.password ? (
          <>
            <dt>Временный пароль</dt>
            <dd className="mono">{data.password}</dd>
          </>
        ) : null}
        {data.pin ? (
          <>
            <dt>PIN прихода</dt>
            <dd className="mono">{data.pin}</dd>
          </>
        ) : null}
      </dl>
      <p className="field-hint">Показывается один раз. При первом входе сотрудник задаст свой пароль.</p>
      <div className="dialog-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              toast.info('Скопировать не получилось', 'Браузер не дал доступ к буферу - перепишите вручную.');
            }
          }}
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Готово
        </button>
      </div>
    </Dialog>
  );
}

function positionOptions(list: Position[] | undefined) {
  return (list ?? []).map((p) => ({ value: p.id, label: p.name, hint: rightsSummary(p.rights) }));
}

/** Нанять: имя, логин, должность; права подставляются из должности и правятся тут же. */
function HireModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (s: Secrets, id: string) => void }) {
  const property = useProperty();
  const positions = usePositions(open);
  const catalog = useAccessCatalog(open);
  const invalidate = useInvalidate();
  const owner = property.access === 'owner';
  const cap = property.access === 'staff' ? property.rights : null;

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [login, setLogin] = useState('');
  const [loginTouched, setLoginTouched] = useState(false);
  const [positionName, setPositionName] = useState('');
  const [position, setPosition] = useState<Position | null>(null);
  const [access, setAccess] = useState<'staff' | 'admin'>('staff');
  const [rights, setRights] = useState<Rights>(NO_RIGHTS);
  const [requireTotp, setRequireTotp] = useState(false);
  const [editRights, setEditRights] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFullName('');
    setPhone('');
    setLogin('');
    setLoginTouched(false);
    setPositionName('');
    setPosition(null);
    setAccess('staff');
    setRights(NO_RIGHTS);
    setRequireTotp(false);
    setEditRights(false);
    setError(null);
  }, [open]);

  const hire = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/staff', {
          params: { path: pid() },
          headers: idem(),
          body: {
            fullName: fullName.trim(),
            phone: phone.trim() || null,
            login: login.trim(),
            ...(position ? { positionId: position.id } : positionName.trim() ? { positionName: positionName.trim() } : {}),
            access,
            ...(access === 'staff' ? { rights } : {}),
            requireTotp,
          },
        }),
      ),
    onSuccess: (r) => {
      void invalidate('staff');
      toast.info(`${r.employee.fullName} - в сотрудниках`);
      onDone({ name: r.employee.fullName, login: r.employee.login, password: r.secrets.temporaryPassword, pin: r.secrets.pin }, r.employee.id);
    },
    onError: (e) => {
      if (isApiError(e, 'validation')) setError(Object.values(e.fieldErrors).join('; ') || e.message);
      else if (isApiError(e)) setError(e.detail ? `${e.message}. ${e.detail}` : e.message);
      else toast.fail(e);
    },
  });

  const valid = fullName.trim().length >= 3 && login.trim().length >= 3;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Новый сотрудник"
      wide
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!valid || hire.isPending} onClick={() => hire.mutate()}>
            {hire.isPending ? 'Нанимаем' : 'Нанять'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-3">
          <Field label="Имя и фамилия" htmlFor="h-name">
            <input
              id="h-name"
              className="input"
              value={fullName}
              autoComplete="off"
              onChange={(e) => {
                setFullName(e.target.value);
                if (!loginTouched) setLogin(suggestLogin(e.target.value));
              }}
            />
          </Field>
          <Field label="Логин" htmlFor="h-login" hint="Латиница, цифры, точка или дефис">
            <input
              id="h-login"
              className="input"
              autoCapitalize="none"
              spellCheck={false}
              value={login}
              onChange={(e) => {
                setLoginTouched(true);
                setLogin(e.target.value.replace(/\s+/g, ''));
              }}
            />
          </Field>
          <Field label="Телефон" htmlFor="h-phone" optional>
            <input id="h-phone" className="input" inputMode="tel" placeholder="+7 701 123 45 67" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field label="Должность" htmlFor="h-position" hint="Выберите из списка или впишите новую">
            <Combobox
              id="h-position"
              value={positionName}
              options={positionOptions(positions.data)}
              newLabel={(v) => `Новая должность: «${v}»`}
              onChange={(v, opt) => {
                setPositionName(v);
                const p = opt ? (positions.data ?? []).find((x) => x.id === opt.value) ?? null : null;
                setPosition(p);
                if (p) {
                  setRights(p.rights);
                  setRequireTotp(p.requireTotp);
                }
              }}
            />
          </Field>
          {owner ? (
            <Field label="Доступ">
              <Choices
                label="Доступ"
                value={access}
                onChange={setAccess}
                options={[
                  ['staff', 'По правам'],
                  ['admin', 'Администратор'],
                ]}
              />
            </Field>
          ) : null}
          <Field label="Вход">
            <label className="check">
              <input type="checkbox" checked={requireTotp || access === 'admin'} disabled={access === 'admin'} onChange={(e) => setRequireTotp(e.target.checked)} />
              <span>Только с кодом из приложения</span>
            </label>
          </Field>
        </div>

        {access === 'admin' ? (
          <p className="note">Администратор видит и правит всё и нанимает сотрудников. Снять его может только владелец.</p>
        ) : catalog.data ? (
          <section>
            <div className="row-between rights-head">
              <h3 className="section-title">Права</h3>
              <span className="muted">
                {rightsSummary(rights)}
                {position ? ` - как у должности «${position.name}»` : ''}
              </span>
            </div>
            {editRights || !position ? (
              <RightsMatrix catalog={catalog.data as Catalog} value={rights} onChange={setRights} cap={cap} />
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditRights(true)}>
                Изменить права
              </button>
            )}
          </section>
        ) : (
          <Loading />
        )}
        {error ? (
          <div className="alert" role="alert">
            <strong>Не нанят.</strong> {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

type Tab = 'profile' | 'rights' | 'history';

/**
 * Карточка сотрудника. Главная кнопка - сохранить изменённое; опасное - через
 * подтверждение, текст которого заранее говорит последствие.
 */
function EmployeeModal({ id, onClose, onSecrets }: { id: string | null; onClose: () => void; onSecrets: (s: Secrets) => void }) {
  const session = useSession();
  const property = useProperty();
  const can = useCan();
  const invalidate = useInvalidate();
  const positions = usePositions(!!id);
  const catalog = useAccessCatalog(!!id);
  const one = useQuery({
    queryKey: ['staff', property.id, 'one', id],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/staff/{id}', { params: { path: { ...pid(), id: id! } } })),
    enabled: !!id,
  });
  const s = one.data;
  const [tab, setTab] = useState<Tab>('profile');
  const [form, setForm] = useState({ fullName: '', phone: '', positionName: '', positionId: null as string | null, access: 'staff' as 'staff' | 'admin', requireTotp: false });
  const [rights, setRights] = useState<Rights>(NO_RIGHTS);
  const [applyPosition, setApplyPosition] = useState(false);
  const [confirm, setConfirm] = useState<'block' | 'end' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setTab('profile'), [id]);
  useEffect(() => {
    if (!s) return;
    setForm({
      fullName: s.fullName,
      phone: s.phone ?? '',
      positionName: s.position?.name ?? '',
      positionId: s.position?.id ?? null,
      access: s.access === 'admin' ? 'admin' : 'staff',
      requireTotp: s.totpRequired,
    });
    setRights(s.rights);
    setApplyPosition(false);
    setError(null);
  }, [s]);

  const self = s?.id === session.me?.id;
  const ownerTarget = s?.access === 'owner';
  const adminTarget = s?.access === 'admin';
  const manage = can('staff.manage') && !!s && !s.archivedAt;
  const touchable = manage && !self && !ownerTarget && (!adminTarget || property.access === 'owner');
  const cap = property.access === 'staff' ? property.rights : null;
  const pickedPosition = (positions.data ?? []).find((p) => p.id === form.positionId) ?? null;
  const positionChanged = !!s && (form.positionId ?? null) !== (s.position?.id ?? null);

  const dirty =
    !!s &&
    (form.fullName.trim() !== s.fullName ||
      (form.phone.trim() || null) !== s.phone ||
      positionChanged ||
      (!form.positionId && form.positionName.trim() !== (s.position?.name ?? '')) ||
      form.access !== (s.access === 'admin' ? 'admin' : 'staff') ||
      form.requireTotp !== s.totpRequired ||
      (s.access === 'staff' && !sameRights(rights, s.rights)));

  const done = (msg: string) => {
    toast.info(msg);
    void invalidate('staff');
  };
  const fail = (e: unknown) => {
    if (isApiError(e)) setError(e.detail ? `${e.message}. ${e.detail}` : e.message);
    else toast.fail(e);
  };

  const save = useMutation({
    mutationFn: () => {
      const positionBody = form.positionId ? { positionId: form.positionId } : form.positionName.trim() ? { positionName: form.positionName.trim() } : { positionId: null };
      return unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/staff/{id}', {
          params: { path: { ...pid(), id: s!.id } },
          body: {
            ...(form.fullName.trim() !== s!.fullName ? { fullName: form.fullName.trim() } : {}),
            ...((form.phone.trim() || null) !== s!.phone ? { phone: form.phone.trim() || null } : {}),
            ...(positionChanged || form.positionName.trim() !== (s!.position?.name ?? '') ? positionBody : {}),
            ...(touchable && form.access !== (s!.access === 'admin' ? 'admin' : 'staff') ? { access: form.access } : {}),
            ...(touchable && form.requireTotp !== s!.totpRequired ? { requireTotp: form.requireTotp } : {}),
            ...(touchable && form.access === 'staff' && !sameRights(rights, s!.rights) ? { rights } : {}),
          },
        }),
      );
    },
    onSuccess: (r) => done(`${r.fullName}: сохранено`),
    onError: fail,
  });
  const resetPassword = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/staff/{id}/password', { params: { path: { ...pid(), id: s!.id } } })),
    onSuccess: (r) => {
      done('Пароль сброшен, сеансы закрыты');
      onSecrets({ name: s!.fullName, login: s!.login, password: r.temporaryPassword, pin: null });
    },
    onError: fail,
  });
  const newPin = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/staff/{id}/pin', { params: { path: { ...pid(), id: s!.id } }, body: {} })),
    onSuccess: (r) => {
      done('Новый PIN выдан');
      onSecrets({ name: s!.fullName, login: s!.login, password: null, pin: r.pin });
    },
    onError: fail,
  });
  const setActive = useMutation({
    mutationFn: (isActive: boolean) => unwrap(api.PATCH('/api/v1/properties/{propertyId}/staff/{id}', { params: { path: { ...pid(), id: s!.id } }, body: { isActive } })),
    onSuccess: (r) => {
      done(r.isActive ? `${r.fullName}: вход открыт` : `${r.fullName}: вход заблокирован`);
      setConfirm(null);
    },
    onError: fail,
  });
  const endSessions = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/staff/{id}/sessions/end', { params: { path: { ...pid(), id: s!.id } } })),
    onSuccess: () => {
      done('Все сеансы сотрудника завершены');
      setConfirm(null);
    },
    onError: fail,
  });
  const archive = useMutation({
    mutationFn: (reason: string) => unwrap(api.DELETE('/api/v1/properties/{propertyId}/staff/{id}', { params: { path: { ...pid(), id: s!.id } }, body: { reason } })),
    onSuccess: () => {
      done(`${s!.fullName} уволен`);
      setConfirm(null);
      onClose();
    },
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/staff/{id}/restore', { params: { path: { ...pid(), id: s!.id } } })),
    onSuccess: (r) => {
      done(`${r.employee.fullName} снова в сотрудниках`);
      onSecrets({ name: r.employee.fullName, login: r.employee.login, password: r.secrets.temporaryPassword, pin: null });
    },
    onError: fail,
  });

  const st = s ? stateOf(s, property.timezone) : null;
  const why = !s
    ? null
    : self
      ? 'Это вы: имя, телефон, пароль и PIN - в Профиле. Свои права меняет владелец.'
      : ownerTarget
        ? 'Учёткой владельца управляет только он сам.'
        : adminTarget && property.access !== 'owner'
          ? 'Администратором управляет владелец.'
          : null;

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      title={s?.fullName ?? 'Сотрудник'}
      subtitle={s ? [s.position?.name ?? s.accessLabel, s.login, s.phone ? fmtPhone(s.phone) : null].filter(Boolean).join(' · ') : undefined}
      wide
      tall
      footer={
        s ? (
          s.archivedAt ? (
            can('staff.manage') ? (
              <button type="button" className="btn btn-primary" disabled={restore.isPending} onClick={() => restore.mutate()}>
                Вернуть на работу
              </button>
            ) : undefined
          ) : (
            <>
              {manage && !self ? (
                <button type="button" className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? 'Сохраняем' : 'Сохранить'}
                </button>
              ) : null}
              {touchable && !s.isActive ? (
                <button type="button" className="btn btn-ghost" disabled={setActive.isPending} onClick={() => setActive.mutate(true)}>
                  Разблокировать
                </button>
              ) : null}
              <span className="spacer" />
              {touchable ? (
                <Menu
                  label="Действия с сотрудником"
                  side="top"
                  trigger={(p) => (
                    <button type="button" className="btn btn-ghost" {...p}>
                      Действия
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <button type="button" className="menu-item" onClick={() => (close(), resetPassword.mutate())}>
                        Сбросить пароль
                      </button>
                      <button type="button" className="menu-item" onClick={() => (close(), newPin.mutate())}>
                        Выдать новый PIN
                      </button>
                      <button type="button" className="menu-item" onClick={() => (close(), setConfirm('end'))}>
                        Завершить сеансы
                      </button>
                      {s.isActive ? (
                        <button type="button" className="menu-item" onClick={() => (close(), setConfirm('block'))}>
                          Заблокировать вход
                        </button>
                      ) : null}
                      <div className="menu-sep" />
                      <button type="button" className="menu-item danger" onClick={() => (close(), setConfirm('archive'))}>
                        Уволить
                      </button>
                    </>
                  )}
                </Menu>
              ) : null}
            </>
          )
        ) : undefined
      }
    >
      {one.isPending ? (
        <Loading />
      ) : !s ? (
        <Empty title="Сотрудник не найден" />
      ) : (
        <div className="stack">
          {st ? <p className={`employee-state${st.fail ? ' danger' : ''}`}>{st.text}</p> : null}
          {why ? <p className="note">{why}</p> : null}
          {error ? (
            <div className="alert" role="alert">
              <strong>Не сохранено.</strong> {error}
            </div>
          ) : null}
          <div className="tabs card-tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === 'profile'} onClick={() => setTab('profile')}>
              Профиль
            </button>
            <button type="button" role="tab" className="tab" aria-selected={tab === 'rights'} onClick={() => setTab('rights')}>
              Права
            </button>
            <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
              История
            </button>
          </div>

          {tab === 'profile' ? (
            <div className="grid-2">
              <Field label="Имя и фамилия" htmlFor="e-name">
                <input id="e-name" className="input" value={form.fullName} disabled={!manage || self} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
              </Field>
              <Field label="Телефон" htmlFor="e-phone" optional>
                <input id="e-phone" className="input" inputMode="tel" value={form.phone} disabled={!manage || self} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </Field>
              <Field label="Должность" htmlFor="e-position" hint={touchable ? 'Перевод на другую должность - выберите её здесь' : undefined}>
                <Combobox
                  id="e-position"
                  value={form.positionName}
                  options={positionOptions(positions.data)}
                  newLabel={(v) => `Новая должность: «${v}»`}
                  disabled={!manage || self || ownerTarget}
                  onChange={(v, opt) => setForm((f) => ({ ...f, positionName: v, positionId: opt?.value ?? null }))}
                />
              </Field>
              <Field label="Логин">
                <input className="input" value={s.login} disabled />
              </Field>
              {property.access === 'owner' && !self && !ownerTarget ? (
                <Field label="Доступ">
                  <Choices
                    label="Доступ"
                    value={form.access}
                    onChange={(v) => setForm((f) => ({ ...f, access: v }))}
                    options={[
                      ['staff', 'По правам'],
                      ['admin', 'Администратор'],
                    ]}
                  />
                </Field>
              ) : null}
              <Field label="Вход">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.requireTotp || form.access === 'admin' || ownerTarget}
                    disabled={!touchable || form.access === 'admin'}
                    onChange={(e) => setForm((f) => ({ ...f, requireTotp: e.target.checked }))}
                  />
                  <span>Только с кодом из приложения{s.totpEnabled ? ' · настроен' : ''}</span>
                </label>
              </Field>
              {positionChanged && pickedPosition && touchable && form.access === 'staff' ? (
                <label className="check grid-span">
                  <input
                    type="checkbox"
                    checked={applyPosition}
                    onChange={(e) => {
                      setApplyPosition(e.target.checked);
                      setRights(e.target.checked ? pickedPosition.rights : s.rights);
                    }}
                  />
                  <span>Права - как у должности «{pickedPosition.name}»: {rightsSummary(pickedPosition.rights)}</span>
                </label>
              ) : null}
            </div>
          ) : tab === 'rights' ? (
            form.access === 'admin' || s.access !== 'staff' ? (
              <p className="note">{ownerTarget ? 'Владелец' : 'Администратор'} видит и правит всё: права ему не записываются.</p>
            ) : catalog.data ? (
              <>
                {pickedPosition && touchable ? (
                  <div className="row rights-presets">
                    <span className="muted">Быстро:</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRights(pickedPosition.rights)}>
                      Как у должности «{pickedPosition.name}»
                    </button>
                    <button type="button" className="btn btn-quiet" onClick={() => setRights(NO_RIGHTS)}>
                      Закрыть всё
                    </button>
                  </div>
                ) : null}
                <RightsMatrix catalog={catalog.data as Catalog} value={rights} onChange={setRights} cap={cap} readOnly={!touchable} />
              </>
            ) : (
              <Loading />
            )
          ) : (
            <History entityType="user" entityId={s.id} />
          )}
        </div>
      )}

      <Dialog open={confirm === 'block' || confirm === 'end'} onClose={() => setConfirm(null)} title={confirm === 'block' ? `Заблокировать вход · ${s?.fullName ?? ''}` : `Завершить сеансы · ${s?.fullName ?? ''}`}>
        <p>{confirm === 'block' ? 'Сеансы закроются, войти будет нельзя, пока вход не откроют снова. Права и история сохранятся.' : 'Все сеансы на всех устройствах закроются. Пароль останется прежним.'}</p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={setActive.isPending || endSessions.isPending}
            onClick={() => (confirm === 'block' ? setActive.mutate(false) : endSessions.mutate())}
          >
            {confirm === 'block' ? 'Заблокировать' : 'Завершить'}
          </button>
        </div>
      </Dialog>
      <ReasonDialog
        open={confirm === 'archive'}
        onClose={() => setConfirm(null)}
        title={`Уволить · ${s?.fullName ?? ''}`}
        text="Вход закроется, сотрудник уйдёт из списков. Имя останется в бронях, сменах и журнале. Вернуть можно из «Уволенных»."
        presets={['По собственному желанию', 'По соглашению сторон', 'Окончание сезона']}
        confirmLabel="Уволить"
        danger
        busy={archive.isPending}
        onConfirm={(reason) => archive.mutate(reason)}
      />
    </Modal>
  );
}
