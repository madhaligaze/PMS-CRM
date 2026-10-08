import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useInvalidate, usePropertyInfo, useRatePlans, useRooms, useRoomTypes, type S } from '@/api/hooks';
import { createProperty, useCan, useProperty, useSession } from '@/auth/session';
import { Empty, Field, Loading, Money } from '@/components/ui/bits';
import { Dialog, useHeld } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { amount, currencySign, dayShort, parseMoney, WEEKDAYS_SHORT } from '@/lib/format';
import './settings.css';

type Property = S['Property'];
type Settings = S['PropertySettings'];
type RoomType = S['RoomType'];
type Room = S['Room'];
type Plan = S['RatePlan'];
type Price = S['RatePrice'];
type Tab = 'hotel' | 'rules' | 'reasons' | 'rooms' | 'rates';

/** Сохранение настроек: с версией, чтобы правки двух управляющих не затирали друг друга. */
function useSaveProperty(property: Property | undefined) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (patch: { settings?: Partial<Settings>; checkInTime?: string; checkOutTime?: string; address?: string | null; phone?: string | null }) =>
      unwrap(api.PATCH('/api/v1/properties/{propertyId}/settings', { params: { path: pid() }, body: { ...patch, version: property!.version } })),
    onSuccess: () => {
      toast.info('Настройки сохранены');
      void invalidate('property');
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 412) {
        toast.error('Настройки только что изменил другой сотрудник', 'Страница обновлена: проверьте значения и сохраните ещё раз.');
        void invalidate('property');
      } else toast.fail(e);
    },
  });
}

/**
 * Настройки гостиницы: правила, по которым работает касса и ресепшен, номерной
 * фонд и тарифы. Вкладки - по тому, что открыто сотруднику: тарифы может
 * вести человек без доступа к остальному.
 */
export function SettingsPage() {
  const can = useCan();
  const info = usePropertyInfo();
  const tabs = useMemo(
    () =>
      (
        [
          ['hotel', 'Гостиница', can('settings.manage')],
          ['rules', 'Правила', can('settings.manage')],
          ['reasons', 'Причины', can('settings.manage')],
          ['rooms', 'Номера', can('settings.manage')],
          ['rates', 'Тарифы', can('rates.manage')],
        ] as [Tab, string, boolean][]
      ).filter(([, , ok]) => ok),
    [can],
  );
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'hotel');
  if (!tabs.length) return <div className="page"><Empty title="Настройки вам не открыты" /></div>;
  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <h1 className="page-title">Настройки гостиницы</h1>
        </div>
      </div>
      <div className="tabs page-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" className="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {info.isPending ? (
        <Loading />
      ) : !info.data ? (
        <Empty title="Настройки не загрузились">Обновите страницу.</Empty>
      ) : tab === 'hotel' ? (
        <HotelTab property={info.data} />
      ) : tab === 'rules' ? (
        <RulesTab property={info.data} />
      ) : tab === 'reasons' ? (
        <ReasonsTab property={info.data} />
      ) : tab === 'rooms' ? (
        <RoomsTab />
      ) : (
        <RatesTab />
      )}
    </div>
  );
}

function Block({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section set-block">
      <h2 className="section-title">
        {title}
        {aside}
      </h2>
      {children}
    </section>
  );
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="set-save">
      <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={onSave}>
        {busy ? 'Сохраняю' : 'Сохранить'}
      </button>
      {dirty ? (
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Вернуть как было
        </button>
      ) : (
        <span className="muted">Изменений нет</span>
      )}
    </div>
  );
}

function HotelTab({ property }: { property: Property }) {
  const save = useSaveProperty(property);
  const initial = useMemo(() => ({ checkInTime: property.checkInTime, checkOutTime: property.checkOutTime, address: property.address ?? '', phone: property.phone ?? '' }), [property]);
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const kiosk = `${window.location.origin}/kiosk?p=${property.id}`;
  return (
    <>
      <Block title="Гостиница">
        <dl className="facts set-facts">
          <dt>Название</dt>
          <dd>{property.name}</dd>
          <dt>Часовой пояс</dt>
          <dd>{property.timezone === 'Asia/Almaty' ? 'Алматы, Астана (UTC+5)' : property.timezone}</dd>
          <dt>Валюта</dt>
          <dd>{property.currency === 'KZT' ? 'Тенге, ₸' : property.currency}</dd>
        </dl>
      </Block>
      <Block title="Заезд, выезд, контакты">
        <div className="grid-2 set-grid">
          <Field label="Заезд с" htmlFor="h-in">
            <input id="h-in" type="time" className="input" value={form.checkInTime} onChange={(e) => setForm({ ...form, checkInTime: e.target.value })} />
          </Field>
          <Field label="Выезд до" htmlFor="h-out">
            <input id="h-out" type="time" className="input" value={form.checkOutTime} onChange={(e) => setForm({ ...form, checkOutTime: e.target.value })} />
          </Field>
          <Field label="Адрес" htmlFor="h-addr" optional>
            <input id="h-addr" className="input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={300} />
          </Field>
          <Field label="Телефон ресепшена" htmlFor="h-phone" optional>
            <input id="h-phone" className="input" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={50} />
          </Field>
        </div>
        <SaveBar
          dirty={dirty}
          busy={save.isPending}
          onReset={() => setForm(initial)}
          onSave={() =>
            save.mutate({ checkInTime: form.checkInTime, checkOutTime: form.checkOutTime, address: form.address.trim() || null, phone: form.phone.trim() || null })
          }
        />
      </Block>
      <NetworkBlock current={property} />
      <Block title="Планшет прихода">
        <p className="ink-2 set-text">
          Откройте эту ссылку на общем планшете у ресепшена: сотрудники будут отмечать приход и уход своим логином и PIN, без входа в систему.
        </p>
        <div className="row">
          <input className="input mono set-link" readOnly value={kiosk} onFocus={(e) => e.target.select()} aria-label="Ссылка для планшета" />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void navigator.clipboard.writeText(kiosk).then(
                () => toast.info('Ссылка скопирована'),
                () => toast.error('Не удалось скопировать', 'Выделите ссылку и скопируйте вручную.'),
              )
            }
          >
            Скопировать
          </button>
        </div>
      </Block>
    </>
  );
}

/**
 * Гостиницы сети: видны владельцу. Новая гостиница получает свою кассу, свои
 * номера и тарифы; гости и компании у сети общие.
 */
function NetworkBlock({ current }: { current: Property }) {
  const me = useSession().me;
  const mine = useProperty();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (mine.access !== 'owner' || !me) return null;
  const submit = () => {
    setBusy(true);
    setError(null);
    createProperty({ name: name.trim(), copyFrom: copy ? current.id : null })
      .then(() => {
        toast.info(`Гостиница «${name.trim()}» добавлена`, 'Заведите в ней типы номеров, номера и тарифы.');
        setOpen(false);
        void navigate({ to: '/settings' });
      })
      .catch((e: unknown) => (isApiError(e) ? setError(e.message) : toast.fail(e)))
      .finally(() => setBusy(false));
  };
  return (
    <Block
      title="Гостиницы сети"
      aside={
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setName('');
            setCopy(true);
            setError(null);
            setOpen(true);
          }}
        >
          Добавить гостиницу
        </button>
      }
    >
      <ul role="list" className="set-reason-list set-network">
        {me.properties.map((p) => (
          <li key={p.id}>
            <span className={p.id === current.id ? 'strong' : undefined}>{p.name}</span>
            <span className="muted">{p.id === current.id ? 'вы сейчас здесь' : (p.position ?? p.accessLabel)}</span>
          </li>
        ))}
      </ul>
      <p className="muted set-text">Гости и компании у гостиниц сети общие. Номера, тарифы, касса и сотрудники - у каждой свои; переключаться между гостиницами - в меню под вашим именем.</p>
      <Dialog open={open} onClose={() => setOpen(false)} title="Новая гостиница сети">
        <div className="stack">
          <Field label="Название" htmlFor="np-name">
            <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} data-autofocus />
          </Field>
          <label className="check">
            <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            <span>Взять правила, лимиты и причины из «{current.name}»</span>
          </label>
          {error ? <p className="field-error">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" disabled={name.trim().length < 2 || busy} onClick={submit}>
            {busy ? 'Добавляю' : 'Добавить'}
          </button>
        </div>
      </Dialog>
    </Block>
  );
}

const WEEKDAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

function RulesTab({ property }: { property: Property }) {
  const save = useSaveProperty(property);
  const s = property.settings;
  const cur = currencySign(property.currency);
  const initial = useMemo(
    () => ({
      discountLimitPercent: String(s.discountLimitPercent),
      refundLimit: amount(s.refundLimit),
      breakfastPrice: amount(s.breakfastPrice),
      prepaymentHours: String(s.prepaymentHours),
      autoCancelUnpaid: s.autoCancelUnpaid,
      requireInspectedForCheckIn: s.requireInspectedForCheckIn,
      dailyCleaningDue: s.dailyCleaningDue,
      generalCleaningWeekday: String(s.generalCleaningWeekday),
      scanRetentionDays: String(s.scanRetentionDays),
    }),
    [s],
  );
  const [f, setF] = useState(initial);
  useEffect(() => setF(initial), [initial]);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const int = (v: string, min: number, max: number) => (/^\d+$/.test(v.trim()) && Number(v) >= min && Number(v) <= max ? Number(v) : null);
  const errors = {
    discountLimitPercent: int(f.discountLimitPercent, 0, 100) === null ? 'От 0 до 100' : undefined,
    refundLimit: parseMoney(f.refundLimit) === null ? 'Сумма числом' : undefined,
    breakfastPrice: parseMoney(f.breakfastPrice) === null ? 'Сумма числом' : undefined,
    prepaymentHours: int(f.prepaymentHours, 1, 720) === null ? 'От 1 до 720 часов' : undefined,
    scanRetentionDays: int(f.scanRetentionDays, 1, 3650) === null ? 'От 1 до 3650 дней' : undefined,
    dailyCleaningDue: /^([01]\d|2[0-3]):[0-5]\d$/.test(f.dailyCleaningDue) ? undefined : 'Время ЧЧ:ММ',
  };
  const valid = Object.values(errors).every((e) => !e);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  return (
    <>
      <Block title="Цены и скидки">
        <div className="grid-3 set-grid">
          <Field label="Скидка без согласования, до" htmlFor="r-disc" error={errors.discountLimitPercent} hint="Больше - только спеццена с утверждением.">
            <div className="input-affix">
              <input id="r-disc" className="input num" inputMode="numeric" value={f.discountLimitPercent} onChange={(e) => set({ discountLimitPercent: e.target.value })} />
              <span className="affix">%</span>
            </div>
          </Field>
          <Field label="Возврат без согласования, до" htmlFor="r-refund" error={errors.refundLimit} hint="Больший возврат делает тот, у кого есть право на крупный возврат.">
            <div className="input-affix">
              <input id="r-refund" className="input num" inputMode="decimal" value={f.refundLimit} onChange={(e) => set({ refundLimit: e.target.value })} />
              <span className="affix">{cur}</span>
            </div>
          </Field>
          <Field label="Завтрак за гостя в сутки" htmlFor="r-bf" error={errors.breakfastPrice}>
            <div className="input-affix">
              <input id="r-bf" className="input num" inputMode="decimal" value={f.breakfastPrice} onChange={(e) => set({ breakfastPrice: e.target.value })} />
              <span className="affix">{cur}</span>
            </div>
          </Field>
        </div>
      </Block>
      <Block title="Предоплата">
        <div className="grid-3 set-grid">
          <Field label="Срок предоплаты" htmlFor="r-pre" error={errors.prepaymentHours} hint="С момента брони. Просроченные видны на «Сегодня».">
            <div className="input-affix">
              <input id="r-pre" className="input num" inputMode="numeric" value={f.prepaymentHours} onChange={(e) => set({ prepaymentHours: e.target.value })} />
              <span className="affix">ч</span>
            </div>
          </Field>
        </div>
        <label className="check set-check">
          <input type="checkbox" checked={f.autoCancelUnpaid} onChange={(e) => set({ autoCancelUnpaid: e.target.checked })} />
          <span>Снимать бронь без предоплаты, когда срок прошёл (с причиной в журнале)</span>
        </label>
      </Block>
      <Block title="Заселение и уборка">
        <label className="check set-check">
          <input type="checkbox" checked={f.requireInspectedForCheckIn} onChange={(e) => set({ requireInspectedForCheckIn: e.target.checked })} />
          <span>Заселять только в номер, который проверил супервайзер</span>
        </label>
        <div className="grid-3 set-grid">
          <Field label="Ежедневная уборка до" htmlFor="r-due" error={errors.dailyCleaningDue}>
            <input id="r-due" type="time" className="input" value={f.dailyCleaningDue} onChange={(e) => set({ dailyCleaningDue: e.target.value })} />
          </Field>
          <Field label="Генеральная уборка" htmlFor="r-gen">
            <select id="r-gen" className="select" value={f.generalCleaningWeekday} onChange={(e) => set({ generalCleaningWeekday: e.target.value })}>
              {WEEKDAY_NAMES.map((d, i) => (
                <option key={d} value={String(i + 1)}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </Block>
      <Block title="Документы гостей">
        <div className="grid-3 set-grid">
          <Field label="Хранить сканы документов" htmlFor="r-scan" error={errors.scanRetentionDays} hint="Потом сканы удаляются; данные карточки остаются.">
            <div className="input-affix">
              <input id="r-scan" className="input num" inputMode="numeric" value={f.scanRetentionDays} onChange={(e) => set({ scanRetentionDays: e.target.value })} />
              <span className="affix">дн.</span>
            </div>
          </Field>
        </div>
      </Block>
      <SaveBar
        dirty={dirty}
        busy={save.isPending}
        onReset={() => setF(initial)}
        onSave={() =>
          valid &&
          save.mutate({
            settings: {
              discountLimitPercent: Number(f.discountLimitPercent),
              refundLimit: parseMoney(f.refundLimit)!,
              breakfastPrice: parseMoney(f.breakfastPrice)!,
              prepaymentHours: Number(f.prepaymentHours),
              autoCancelUnpaid: f.autoCancelUnpaid,
              requireInspectedForCheckIn: f.requireInspectedForCheckIn,
              dailyCleaningDue: f.dailyCleaningDue,
              generalCleaningWeekday: Number(f.generalCleaningWeekday),
              scanRetentionDays: Number(f.scanRetentionDays),
            },
          })
        }
      />
    </>
  );
}

const REASON_LISTS: { key: 'specialPriceBases' | 'cancelReasons' | 'noShowReasons' | 'stornoReasons'; title: string; hint: string }[] = [
  { key: 'cancelReasons', title: 'Причины отмены брони', hint: 'Предлагаются при отмене; можно написать и свою.' },
  { key: 'noShowReasons', title: 'Причины незаезда', hint: 'Когда гость не приехал.' },
  { key: 'stornoReasons', title: 'Причины сторно', hint: 'При отмене оплаты или начисления.' },
  { key: 'specialPriceBases', title: 'Основания спеццены', hint: 'Почему гостю дана особая цена: попадают в Z-отчёт.' },
];

function ReasonsTab({ property }: { property: Property }) {
  const save = useSaveProperty(property);
  const initial = useMemo(
    () => ({
      specialPriceBases: property.settings.specialPriceBases,
      cancelReasons: property.settings.cancelReasons,
      noShowReasons: property.settings.noShowReasons,
      stornoReasons: property.settings.stornoReasons,
    }),
    [property],
  );
  const [lists, setLists] = useState(initial);
  useEffect(() => setLists(initial), [initial]);
  const dirty = JSON.stringify(lists) !== JSON.stringify(initial);
  return (
    <>
      {REASON_LISTS.map(({ key, title, hint }) => (
        <Block key={key} title={title}>
          <p className="muted set-text">{hint}</p>
          <ReasonList items={lists[key]} onChange={(items) => setLists((l) => ({ ...l, [key]: items }))} />
        </Block>
      ))}
      <SaveBar dirty={dirty} busy={save.isPending} onReset={() => setLists(initial)} onSave={() => save.mutate({ settings: lists })} />
    </>
  );
}

function ReasonList({ items, onChange }: { items: string[]; onChange: (items: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const value = draft.trim();
  const duplicate = items.some((i) => i.toLowerCase() === value.toLowerCase());
  const add = () => {
    if (!value || duplicate || items.length >= 30) return;
    onChange([...items, value]);
    setDraft('');
  };
  return (
    <div className="set-reasons">
      {items.length ? (
        <ul role="list" className="set-reason-list">
          {items.map((item, i) => (
            <li key={item}>
              <span>{item}</span>
              <button type="button" className="btn-quiet" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Убрать: ${item}`}>
                Убрать
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Список пуст: сотрудники будут писать причину сами.</p>
      )}
      <div className="row set-reason-add">
        <input
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Новая причина"
          maxLength={120}
          aria-label="Новая причина"
        />
        <button type="button" className="btn btn-ghost" disabled={!value || duplicate || items.length >= 30} onClick={add}>
          Добавить
        </button>
      </div>
      {duplicate && value ? <div className="field-hint">Такая причина уже есть</div> : null}
    </div>
  );
}

// ── Номерной фонд ─────────────────────────────────────────────────────────

function RoomsTab() {
  const types = useRoomTypes();
  const rooms = useRooms();
  const [typeEdit, setTypeEdit] = useState<RoomType | 'new' | null>(null);
  const [roomEdit, setRoomEdit] = useState<Room | 'new' | null>(null);
  if (types.isPending || rooms.isPending) return <Loading />;
  const typeName = (id: string) => types.data?.find((t) => t.id === id)?.name ?? '-';
  const list = [...(rooms.data ?? [])].sort((a, b) => a.number.localeCompare(b.number, 'ru', { numeric: true }));
  return (
    <>
      <Block
        title="Типы номеров"
        aside={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTypeEdit('new')}>
            Добавить тип
          </button>
        }
      >
        {!types.data?.length ? (
          <Empty title="Типов номеров нет">Начните с типа: «Стандарт», «Люкс».</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Название</th>
                  <th className="r">Мест</th>
                  <th className="r">Номеров</th>
                  <th>В продаже</th>
                </tr>
              </thead>
              <tbody>
                {types.data.map((t) => (
                  <tr key={t.id} data-clickable onClick={() => setTypeEdit(t)}>
                    <td className="mono">{t.code}</td>
                    <td>
                      {t.name}
                      {t.description ? <span className="sub">{t.description}</span> : null}
                    </td>
                    <td className="r num">
                      {t.baseOccupancy}
                      {t.maxOccupancy > t.baseOccupancy ? ` + ${t.maxOccupancy - t.baseOccupancy}` : ''}
                    </td>
                    <td className="r num">{list.filter((r) => r.roomTypeId === t.id && r.isActive).length}</td>
                    <td className={t.isActive ? undefined : 'muted'}>{t.isActive ? 'да' : 'нет'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
      <Block
        title={`Номера · ${list.filter((r) => r.isActive).length}`}
        aside={
          <button type="button" className="btn btn-ghost btn-sm" disabled={!types.data?.length} onClick={() => setRoomEdit('new')}>
            Добавить номер
          </button>
        }
      >
        {!list.length ? (
          <Empty title="Номеров нет" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Тип</th>
                  <th>Этаж</th>
                  <th>Примечание</th>
                  <th>В продаже</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id} data-clickable onClick={() => setRoomEdit(r)}>
                    <td className="strong num">{r.number}</td>
                    <td>{typeName(r.roomTypeId)}</td>
                    <td className="num">{r.floor ?? '-'}</td>
                    <td className="ink-2">{r.note ?? '-'}</td>
                    <td className={r.isActive ? undefined : 'muted'}>{r.isActive ? 'да' : 'выведен из фонда'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
      <RoomTypeDialog value={typeEdit} onClose={() => setTypeEdit(null)} />
      <RoomDialog value={roomEdit} types={types.data ?? []} onClose={() => setRoomEdit(null)} />
    </>
  );
}

function RoomTypeDialog({ value, onClose }: { value: RoomType | 'new' | null; onClose: () => void }) {
  const held = useHeld(value);
  const editing = held && held !== 'new' ? held : null;
  const invalidate = useInvalidate();
  const [f, setF] = useState({ code: '', name: '', description: '', base: '2', max: '2', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const t = value === 'new' ? null : value;
    setF({ code: t?.code ?? '', name: t?.name ?? '', description: t?.description ?? '', base: String(t?.baseOccupancy ?? 2), max: String(t?.maxOccupancy ?? 2), isActive: t?.isActive ?? true });
    setError(null);
  }, [value]);
  const base = Number(f.base);
  const max = Number(f.max);
  const okNums = Number.isInteger(base) && Number.isInteger(max) && base >= 1 && max >= base && max <= 12;
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.PATCH('/api/v1/properties/{propertyId}/room-types/{id}', {
              params: { path: { ...pid(), id: editing.id } },
              body: { name: f.name.trim(), description: f.description.trim() || null, baseOccupancy: base, maxOccupancy: max, isActive: f.isActive },
            }),
          )
        : unwrap(
            api.POST('/api/v1/properties/{propertyId}/room-types', {
              params: { path: pid() },
              body: { code: f.code.trim().toUpperCase(), name: f.name.trim(), description: f.description.trim() || null, baseOccupancy: base, maxOccupancy: max, sort: 0 },
            }),
          ),
    onSuccess: (t) => {
      toast.info(editing ? `Тип «${t.name}» сохранён` : `Тип «${t.name}» добавлен`);
      void invalidate('room-types', 'rooms', 'tape', 'hk');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  return (
    <Dialog open={!!value} onClose={onClose} title={editing ? `Тип номера · ${editing.name}` : 'Новый тип номера'} wide>
      <div className="stack">
        <div className="grid-2">
          <Field label="Название" htmlFor="rt-name">
            <input id="rt-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Например: Стандарт двухместный" maxLength={80} data-autofocus />
          </Field>
          <Field label="Код" htmlFor="rt-code" hint={editing ? 'Код не меняется: по нему тип узнают выгрузки.' : 'Коротко латиницей: STD, LUX.'}>
            <input id="rt-code" className="input mono" value={f.code} disabled={!!editing} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={12} />
          </Field>
          <Field label="Основных мест" htmlFor="rt-base">
            <input id="rt-base" className="input num" inputMode="numeric" value={f.base} onChange={(e) => setF({ ...f, base: e.target.value })} />
          </Field>
          <Field label="Всего мест с доп. кроватями" htmlFor="rt-max" error={!okNums ? 'Не меньше основных и не больше 12' : undefined}>
            <input id="rt-max" className="input num" inputMode="numeric" value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} />
          </Field>
        </div>
        <Field label="Описание" htmlFor="rt-desc" optional>
          <textarea id="rt-desc" className="textarea" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={500} />
        </Field>
        {editing ? (
          <label className="check">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            <span>Тип в продаже</span>
          </label>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!f.name.trim() || (!editing && !f.code.trim()) || !okNums || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Сохранить' : 'Добавить тип'}
        </button>
      </div>
    </Dialog>
  );
}

function RoomDialog({ value, types, onClose }: { value: Room | 'new' | null; types: RoomType[]; onClose: () => void }) {
  const held = useHeld(value);
  const editing = held && held !== 'new' ? held : null;
  const invalidate = useInvalidate();
  const [f, setF] = useState({ number: '', roomTypeId: '', floor: '', note: '', isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const r = value === 'new' ? null : value;
    setF({ number: r?.number ?? '', roomTypeId: r?.roomTypeId ?? types.find((t) => t.isActive)?.id ?? '', floor: r?.floor != null ? String(r.floor) : '', note: r?.note ?? '', isActive: r?.isActive ?? true });
    setError(null);
  }, [value, types]);
  const floor = f.floor.trim() === '' ? null : Number(f.floor);
  const floorOk = floor === null || (Number.isInteger(floor) && floor >= -5 && floor <= 100);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(
            api.PATCH('/api/v1/properties/{propertyId}/rooms/{id}', {
              params: { path: { ...pid(), id: editing.id } },
              body: { number: f.number.trim(), roomTypeId: f.roomTypeId, floor, note: f.note.trim() || null, isActive: f.isActive, version: editing.version },
            }),
          )
        : unwrap(
            api.POST('/api/v1/properties/{propertyId}/rooms', {
              params: { path: pid() },
              headers: idem(),
              body: { number: f.number.trim(), roomTypeId: f.roomTypeId, floor, note: f.note.trim() || null, sort: 0 },
            }),
          ),
    onSuccess: (r) => {
      toast.info(editing ? `Номер ${r.number} сохранён` : `Номер ${r.number} добавлен`);
      void invalidate('rooms', 'tape', 'hk', 'dashboard');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.status === 412 ? 'Номер уже изменил другой сотрудник: закройте окно и откройте снова.' : e.message) : toast.fail(e)),
  });
  return (
    <Dialog open={!!value} onClose={onClose} title={editing ? `Номер ${editing.number}` : 'Новый номер'} wide>
      <div className="stack">
        <div className="grid-3">
          <Field label="Номер" htmlFor="rm-num">
            <input id="rm-num" className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} maxLength={12} data-autofocus />
          </Field>
          <Field label="Тип" htmlFor="rm-type">
            <select id="rm-type" className="select" value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isActive ? '' : ' (не продаётся)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Этаж" htmlFor="rm-floor" optional error={!floorOk ? 'Целое число' : undefined}>
            <input id="rm-floor" className="input num" inputMode="numeric" value={f.floor} onChange={(e) => setF({ ...f, floor: e.target.value })} />
          </Field>
        </div>
        <Field label="Примечание" htmlFor="rm-note" optional hint="Видно на шахматке и в хозслужбе: «вид на горы», «рядом с лифтом».">
          <input id="rm-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={300} />
        </Field>
        {editing ? (
          <label className="check">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            <span>Номер в фонде гостиницы (снимите, если номер выведен навсегда; на время ремонта - заявка в «Ремонте»)</span>
          </label>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!f.number.trim() || !f.roomTypeId || !floorOk || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Сохранить' : 'Добавить номер'}
        </button>
      </div>
    </Dialog>
  );
}

// ── Тарифы ────────────────────────────────────────────────────────────────

const PLAN_KIND: Record<Plan['kind'], string> = { standard: 'для всех', corporate: 'для компаний', group: 'для групп' };

const weekdaysText = (w: number[]) => (w.length === 7 ? 'все дни' : [...w].sort().map((d) => WEEKDAYS_SHORT[d - 1]).join(' '));

function RatesTab() {
  const plans = useRatePlans();
  const types = useRoomTypes();
  const property = useProperty();
  const [planEdit, setPlanEdit] = useState<Plan | 'new' | null>(null);
  const [priceEdit, setPriceEdit] = useState<{ plan: Plan; price: Price | null } | null>(null);
  if (plans.isPending || types.isPending) return <Loading />;
  const typeName = (id: string) => types.data?.find((t) => t.id === id)?.name ?? '-';
  return (
    <>
      <div className="row-between set-rates-head">
        <p className="muted set-text">
          Цена ночи берётся из самой приоритетной подходящей строки: базовая цена - приоритет 0, сезон - выше, выходные - ещё выше.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => setPlanEdit('new')}>
          Новый тариф
        </button>
      </div>
      {!plans.data?.length ? (
        <Empty title="Тарифов нет">Без тарифа бронь не посчитает цену: заведите хотя бы один.</Empty>
      ) : (
        plans.data.map((plan) => (
          <Block
            key={plan.id}
            title={plan.name}
            aside={
              <span className="row">
                <span className="muted">
                  {plan.code} · {PLAN_KIND[plan.kind]}
                  {plan.includesBreakfast ? ' · с завтраком' : ''}
                  {plan.isActive ? '' : ' · не используется'}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlanEdit(plan)}>
                  Изменить
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPriceEdit({ plan, price: null })}>
                  Добавить цену
                </button>
              </span>
            }
          >
            {!plan.prices.length ? (
              <p className="muted">Цен нет: по этому тарифу бронь не посчитается.</p>
            ) : (
              <div className="table-wrap">
                <table className="table set-prices">
                  <thead>
                    <tr>
                      <th>Тип номера</th>
                      <th>Цена</th>
                      <th>Период</th>
                      <th>Дни</th>
                      <th className="r">Приоритет</th>
                      <th className="r">За ночь</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...plan.prices]
                      .sort((a, b) => typeName(a.roomTypeId).localeCompare(typeName(b.roomTypeId), 'ru') || a.priority - b.priority || a.validFrom.localeCompare(b.validFrom))
                      .map((p) => (
                        <tr key={p.id} data-clickable onClick={() => setPriceEdit({ plan, price: p })}>
                          <td>{typeName(p.roomTypeId)}</td>
                          <td>{p.label}</td>
                          <td className="nowrap">
                            {dayShort(p.validFrom)} {p.validFrom.slice(0, 4)} - {dayShort(p.validTo)} {p.validTo.slice(0, 4)}
                          </td>
                          <td>{weekdaysText(p.weekdays)}</td>
                          <td className="r num">{p.priority}</td>
                          <td className="r">
                            <Money value={p.amount} currency={property.currency} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </Block>
        ))
      )}
      <PlanDialog value={planEdit} onClose={() => setPlanEdit(null)} />
      <PriceDialog value={priceEdit} types={types.data ?? []} onClose={() => setPriceEdit(null)} />
    </>
  );
}

function PlanDialog({ value, onClose }: { value: Plan | 'new' | null; onClose: () => void }) {
  const held = useHeld(value);
  const editing = held && held !== 'new' ? held : null;
  const invalidate = useInvalidate();
  const [f, setF] = useState({ code: '', name: '', kind: 'standard' as Plan['kind'], includesBreakfast: false, isActive: true });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const p = value === 'new' ? null : value;
    setF({ code: p?.code ?? '', name: p?.name ?? '', kind: p?.kind ?? 'standard', includesBreakfast: p?.includesBreakfast ?? false, isActive: p?.isActive ?? true });
    setError(null);
  }, [value]);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(api.PATCH('/api/v1/properties/{propertyId}/rate-plans/{id}', { params: { path: { ...pid(), id: editing.id } }, body: { name: f.name.trim(), includesBreakfast: f.includesBreakfast, isActive: f.isActive } }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/rate-plans', { params: { path: pid() }, body: { code: f.code.trim().toUpperCase(), name: f.name.trim(), kind: f.kind, includesBreakfast: f.includesBreakfast, sort: 0 } })),
    onSuccess: (p) => {
      toast.info(editing ? `Тариф «${p.name}» сохранён` : `Тариф «${p.name}» создан`, editing ? undefined : 'Добавьте ему цены по типам номеров.');
      void invalidate('rate-plans');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  return (
    <Dialog open={!!value} onClose={onClose} title={editing ? `Тариф · ${editing.name}` : 'Новый тариф'} wide>
      <div className="stack">
        <div className="grid-2">
          <Field label="Название" htmlFor="pl-name">
            <input id="pl-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Например: Корпоративный" maxLength={80} data-autofocus />
          </Field>
          <Field label="Код" htmlFor="pl-code" hint={editing ? 'Код не меняется.' : 'Латиницей: BAR, CORP.'}>
            <input id="pl-code" className="input mono" value={f.code} disabled={!!editing} onChange={(e) => setF({ ...f, code: e.target.value })} maxLength={16} />
          </Field>
        </div>
        {editing ? null : (
          <Field label="Для кого">
            <div className="choices" role="radiogroup" aria-label="Для кого">
              {(Object.keys(PLAN_KIND) as Plan['kind'][]).map((k) => (
                <button key={k} type="button" role="radio" className="choice" aria-checked={f.kind === k} onClick={() => setF({ ...f, kind: k })}>
                  {PLAN_KIND[k]}
                </button>
              ))}
            </div>
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={f.includesBreakfast} onChange={(e) => setF({ ...f, includesBreakfast: e.target.checked })} />
          <span>Завтрак входит в цену</span>
        </label>
        {editing ? (
          <label className="check">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            <span>Тариф предлагается в новой брони</span>
          </label>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!f.name.trim() || (!editing && !f.code.trim()) || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Сохранить' : 'Создать тариф'}
        </button>
      </div>
    </Dialog>
  );
}

function PriceDialog({ value, types, onClose }: { value: { plan: Plan; price: Price | null } | null; types: RoomType[]; onClose: () => void }) {
  const held = useHeld(value);
  const property = useProperty();
  const info = usePropertyInfo();
  const invalidate = useInvalidate();
  const editing = held?.price ?? null;
  const [f, setF] = useState({ roomTypeId: '', label: '', validFrom: '', validTo: '', weekdays: [1, 2, 3, 4, 5, 6, 7], amount: '', priority: '0' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!value) return;
    const p = value.price;
    const today = info.data?.businessDate ?? '';
    setF({
      roomTypeId: p?.roomTypeId ?? types.find((t) => t.isActive)?.id ?? '',
      label: p?.label ?? 'Базовая',
      validFrom: p?.validFrom ?? today,
      validTo: p?.validTo ?? (today ? `${Number(today.slice(0, 4)) + 1}-12-31` : ''),
      weekdays: p?.weekdays ?? [1, 2, 3, 4, 5, 6, 7],
      amount: p ? amount(p.amount) : '',
      priority: String(p?.priority ?? 0),
    });
    setError(null);
  }, [value, types, info.data?.businessDate]);
  const sum = parseMoney(f.amount);
  const prio = Number(f.priority);
  const periodOk = !!f.validFrom && !!f.validTo && f.validTo >= f.validFrom;
  const ok = !!f.roomTypeId && !!f.label.trim() && periodOk && sum !== null && f.weekdays.length > 0 && Number.isInteger(prio) && prio >= 0 && prio <= 100;
  const body = { roomTypeId: f.roomTypeId, label: f.label.trim(), validFrom: f.validFrom, validTo: f.validTo, weekdays: [...f.weekdays].sort(), amount: sum ?? 0, priority: prio };
  const save = useMutation({
    mutationFn: () =>
      editing
        ? unwrap(api.PATCH('/api/v1/properties/{propertyId}/rate-prices/{id}', { params: { path: { ...pid(), id: editing.id } }, body }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/rate-plans/{id}/prices', { params: { path: { ...pid(), id: held!.plan.id } }, body })),
    onSuccess: () => {
      toast.info(editing ? 'Цена сохранена' : 'Цена добавлена', 'Новые брони считаются по ней; уже созданные не пересчитываются.');
      void invalidate('rate-plans');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  const toggleDay = (d: number) => setF((x) => ({ ...x, weekdays: x.weekdays.includes(d) ? x.weekdays.filter((w) => w !== d) : [...x.weekdays, d] }));
  return (
    <Dialog open={!!value} onClose={onClose} title={held ? `${held.plan.name} · ${editing ? 'цена' : 'новая цена'}` : ''} wide>
      <div className="stack">
        <div className="grid-2">
          <Field label="Тип номера" htmlFor="pr-type">
            <select id="pr-type" className="select" value={f.roomTypeId} onChange={(e) => setF({ ...f, roomTypeId: e.target.value })}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Название цены" htmlFor="pr-label" hint="Базовая, Высокий сезон, Выходные.">
            <input id="pr-label" className="input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} maxLength={80} />
          </Field>
          <Field label="С" htmlFor="pr-from">
            <input id="pr-from" type="date" className="input" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
          </Field>
          <Field label="По" htmlFor="pr-to" error={f.validFrom && f.validTo && !periodOk ? 'Конец раньше начала' : undefined}>
            <input id="pr-to" type="date" className="input" min={f.validFrom || undefined} value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
          </Field>
        </div>
        <Field label="Дни недели">
          <div className="choices" role="group" aria-label="Дни недели">
            {WEEKDAYS_SHORT.map((d, i) => (
              <button key={d} type="button" className="choice" aria-pressed={f.weekdays.includes(i + 1)} onClick={() => toggleDay(i + 1)}>
                {d}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid-2">
          <Field label="Цена за ночь" htmlFor="pr-amount" error={f.amount && sum === null ? 'Сумма числом' : undefined}>
            <div className="input-affix">
              <input id="pr-amount" className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
              <span className="affix">{currencySign(property.currency)}</span>
            </div>
          </Field>
          <Field label="Приоритет" htmlFor="pr-prio" hint="0 - базовая; сезон, например, 10; выходные 20.">
            <input id="pr-prio" className="input num" inputMode="numeric" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} />
          </Field>
        </div>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!ok || save.isPending} onClick={() => save.mutate()}>
          {editing ? 'Сохранить' : 'Добавить цену'}
        </button>
      </div>
    </Dialog>
  );
}
