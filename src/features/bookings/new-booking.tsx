import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useCompanies, useDirectory, useInvalidate, usePropertyInfo, useRatePlans, useTape, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Field, Money } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { addDays, diffDays } from '@/lib/dates';
import { currencySign, dayShort, nights as nightsLabel, parseMoney } from '@/lib/format';
import { BOOKING_SOURCE, HK_STATUS } from '@/lib/labels';
import { emptyGuest, GuestPicker, type GuestChoice } from './guest-picker';
import { useOpenBooking } from './open';
import './bookings.css';

type Prefill = { roomId?: string; arrival?: string; departure?: string; guest?: S['GuestListItem'] };

let store = { open: false, prefill: {} as Prefill, key: 0 };
const listeners = new Set<() => void>();

/** Открыть форму новой брони откуда угодно: с шахматки, из сводки, из карточки гостя. */
export function openNewBooking(prefill: Prefill) {
  store = { open: true, prefill, key: store.key + 1 };
  listeners.forEach((l) => l());
}
function closeNewBooking() {
  store = { ...store, open: false };
  listeners.forEach((l) => l());
}

export function NewBookingModal() {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
  return (
    <Modal open={s.open} onClose={closeNewBooking} title="Новая бронь" wide>
      {s.open ? <NewBookingForm key={s.key} prefill={s.prefill} /> : null}
    </Modal>
  );
}

const SOURCES = ['phone', 'walk_in', 'website', 'whatsapp', 'instagram', 'booking_com', 'ota_other', 'email'] as const;

function NewBookingForm({ prefill }: { prefill: Prefill }) {
  const can = useCan();
  const property = useProperty();
  const info = usePropertyInfo();
  const plans = useRatePlans();
  const today = info.data?.businessDate ?? '';
  const openBooking = useOpenBooking();
  const invalidate = useInvalidate();

  const [guest, setGuest] = useState<GuestChoice>(prefill.guest ? { kind: 'existing', guest: prefill.guest } : { kind: 'new', draft: emptyGuest });
  const [arrival, setArrival] = useState(prefill.arrival ?? today);
  const [departure, setDeparture] = useState(prefill.departure ?? (today ? addDays(today, 1) : ''));
  const [roomId, setRoomId] = useState(prefill.roomId ?? '');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [ratePlanId, setRatePlanId] = useState('');
  const [meal, setMeal] = useState<'none' | 'breakfast'>('none');
  const [source, setSource] = useState<(typeof SOURCES)[number]>('phone');
  const [paymentType, setPaymentType] = useState<'cash' | 'cashless'>('cash');
  const [priceMode, setPriceMode] = useState<'rate' | 'discount' | 'special'>('rate');
  const [discount, setDiscount] = useState('10');
  const [special, setSpecial] = useState('');
  const [reason, setReason] = useState('');
  const [approver, setApprover] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState<'tentative' | 'confirmed'>('tentative');
  const [comment, setComment] = useState('');
  const [overrideBlacklist, setOverrideBlacklist] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);

  useEffect(() => {
    if (!arrival && today) setArrival(today);
    if (!departure && today) setDeparture(addDays(today, 1));
  }, [today, arrival, departure]);

  useEffect(() => {
    if (!ratePlanId && plans.data?.length) setRatePlanId(plans.data.find((p) => p.isActive && p.code === 'BAR')?.id ?? plans.data.find((p) => p.isActive)!.id);
  }, [plans.data, ratePlanId]);

  const validDates = !!arrival && !!departure && departure > arrival;
  const nightsCount = validDates ? diffDays(arrival, departure) : 0;

  // Свободные номера на даты - из той же шахматки, без отдельного запроса.
  const tape = useTape(validDates ? arrival : today || '2000-01-01', validDates ? departure : addDays(today || '2000-01-01', 1));
  const freeRooms = useMemo(() => {
    const t = tape.data;
    if (!t || !validDates) return [];
    // Занимают номер все брони на шахматке (и выехавшие - для истории) и ремонт.
    const busy = new Set([
      ...t.bookings.filter((b) => b.arrival < departure && b.departure > arrival).map((b) => b.roomId),
      ...t.blocks.filter((k) => k.startsOn < departure && k.endsOn > arrival).map((k) => k.roomId),
    ]);
    return t.rooms
      .filter((r) => r.isActive && !busy.has(r.id))
      .map((r) => ({ ...r, typeName: t.roomTypes.find((x) => x.id === r.roomTypeId)?.name ?? '' }));
  }, [tape.data, validDates, arrival, departure]);
  const allRooms = tape.data?.rooms ?? [];
  const room = allRooms.find((r) => r.id === roomId);
  const roomFree = freeRooms.some((r) => r.id === roomId);
  const plan = plans.data?.find((p) => p.id === ratePlanId);

  const priceReady =
    priceMode === 'rate' ||
    (priceMode === 'discount' && Number(discount) > 0) ||
    (priceMode === 'special' && parseMoney(special) !== null);
  const quote = useQuery({
    queryKey: ['quote', pid().propertyId, room?.roomTypeId, ratePlanId, arrival, departure, adults, meal, priceMode, discount, special],
    queryFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/quotes', {
          params: { path: pid() },
          body: {
            roomTypeId: room!.roomTypeId,
            ratePlanId,
            arrival,
            departure,
            adults,
            meal,
            priceMode,
            discountPercent: priceMode === 'discount' ? Number(discount) : null,
            specialNightly: priceMode === 'special' ? parseMoney(special) : null,
          },
        }),
      ),
    enabled: !!room && !!ratePlanId && validDates && priceReady,
    retry: false,
  });

  const directory = useDirectory(priceMode === 'special');
  const companies = useCompanies();
  const bases = info.data?.settings.specialPriceBases ?? [];

  const create = useMutation({
    mutationFn: () => {
      const g = guest.kind === 'existing' ? { guestId: guest.guest.id } : { guest: { lastName: guest.draft.lastName.trim(), firstName: guest.draft.firstName.trim(), phone: guest.draft.phone.trim() || null, email: guest.draft.email.trim() || null } };
      return unwrap(
        api.POST('/api/v1/properties/{propertyId}/bookings', {
          params: { path: pid() },
          headers: idem(),
          body: {
            ...g,
            roomId,
            arrival,
            departure,
            adults,
            children,
            ratePlanId,
            meal,
            source,
            paymentType: priceMode === 'special' ? 'special' : paymentType,
            priceMode,
            discountPercent: priceMode === 'discount' ? Number(discount) : null,
            specialNightly: priceMode === 'special' ? parseMoney(special) : null,
            priceReason: priceMode === 'rate' ? null : reason.trim(),
            priceApprovedBy: priceMode === 'special' ? approver || null : null,
            companyId: companyId || null,
            status,
            comment: comment.trim() || null,
            overrideBlacklist,
          },
        }),
      );
    },
    onSuccess: (b) => {
      toast.info(`Бронь ${b.number} создана`, `${b.guest.fullName}, номер ${b.roomNumber}`);
      closeNewBooking();
      void invalidate('tape', 'bookings', 'dashboard', 'guests');
      openBooking(b.id);
    },
    onError: (e) => {
      if (isApiError(e, 'room.occupied') || isApiError(e, 'room.blocked')) setConflict(`${e.message}${e.detail ? `. ${e.detail}` : ''}`);
      else if (isApiError(e, 'guest.blacklisted')) setConflict(`Гость в чёрном списке: ${e.detail ?? 'причина не указана'}`);
      else toast.fail(e);
    },
  });

  const guestOk = guest.kind === 'existing' || (guest.draft.lastName.trim() && guest.draft.firstName.trim());
  const reasonOk = priceMode === 'rate' || reason.trim().length > 0;
  const approverOk = priceMode !== 'special' || !!approver;
  const canSubmit = guestOk && validDates && !!roomId && !!ratePlanId && reasonOk && approverOk && priceReady && !create.isPending;

  return (
    <form
      className="nb"
      onSubmit={(e) => {
        e.preventDefault();
        setConflict(null);
        if (canSubmit) create.mutate();
      }}
    >
      <section className="section">
        <h3 className="section-title">Гость</h3>
        <GuestPicker value={guest} onChange={setGuest} />
        {guest.kind === 'existing' && guest.guest.blacklisted ? (
          <div className="alert" style={{ marginTop: 'var(--s-3)' }}>
            <strong>Гость в чёрном списке.</strong> Бронь оформляет старший администратор, осознанно.
            {can('guest.blacklist') ? (
              <label className="check" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={overrideBlacklist} onChange={(e) => setOverrideBlacklist(e.target.checked)} />
                <span>Всё равно оформить</span>
              </label>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="section">
        <h3 className="section-title">
          Проживание <span className="aside">{nightsCount ? nightsLabel(nightsCount) : ''}</span>
        </h3>
        <div className="grid-3">
          <Field label="Заезд" htmlFor="nb-arr">
            <input
              id="nb-arr"
              type="date"
              className="input"
              min={today}
              value={arrival}
              onChange={(e) => {
                setArrival(e.target.value);
                if (e.target.value >= departure) setDeparture(addDays(e.target.value, 1));
              }}
            />
          </Field>
          <Field label="Выезд" htmlFor="nb-dep">
            <input id="nb-dep" type="date" className="input" min={arrival ? addDays(arrival, 1) : today} value={departure} onChange={(e) => setDeparture(e.target.value)} />
          </Field>
          <Field label="Гостей" htmlFor="nb-adults" hint={children ? `и ${children} ${children === 1 ? 'ребёнок' : 'детей'}` : undefined}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <select id="nb-adults" className="select" value={adults} onChange={(e) => setAdults(Number(e.target.value))} aria-label="Взрослых">
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} взр.
                  </option>
                ))}
              </select>
              <select className="select" value={children} onChange={(e) => setChildren(Number(e.target.value))} aria-label="Детей">
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} дет.
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>

        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <span className="field-label">Номер</span>
          {!validDates ? (
            <div className="field-hint">Выберите даты - покажем свободные номера.</div>
          ) : tape.isPending ? (
            <div className="field-hint">Ищем свободные номера</div>
          ) : (
            <div className="room-pick" role="radiogroup" aria-label="Свободные номера">
              {freeRooms.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={roomId === r.id} className="choice room-choice" onClick={() => setRoomId(r.id)}>
                  <span className="rc-num">{r.number}</span>
                  <span className="rc-type">{r.typeName}</span>
                  {arrival === today && r.hkStatus !== 'inspected' ? <span className="rc-state danger">{HK_STATUS[r.hkStatus]?.toLowerCase()}</span> : null}
                </button>
              ))}
              {!freeRooms.length ? <div className="field-error">На эти даты свободных номеров нет.</div> : null}
            </div>
          )}
          {roomId && room && !roomFree && validDates ? <div className="field-error">Номер {room.number} занят на эти даты - выберите другой.</div> : null}
        </div>
      </section>

      <section className="section">
        <h3 className="section-title">Цена</h3>
        <div className="grid-2">
          <Field label="Тариф" htmlFor="nb-plan">
            <select id="nb-plan" className="select" value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)}>
              {(plans.data ?? [])
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.includesBreakfast ? ', с завтраком' : ''}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Питание">
            {plan?.includesBreakfast ? (
              <div className="field-hint" style={{ paddingTop: 10 }}>
                Завтрак включён в тариф
              </div>
            ) : (
              <Choices
                label="Питание"
                value={meal}
                onChange={setMeal}
                options={[
                  ['none', 'Без питания'],
                  ['breakfast', 'Завтрак'],
                ]}
              />
            )}
          </Field>
        </div>
        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <span className="field-label">Как считать</span>
          <Choices
            label="Режим цены"
            value={priceMode}
            onChange={setPriceMode}
            options={[
              ['rate', 'По тарифу'],
              ...(can('booking.discount') ? ([['discount', 'Скидка']] as ['discount', string][]) : []),
              ...(can('booking.special_price') ? ([['special', 'Спеццена']] as ['special', string][]) : []),
            ]}
          />
        </div>
        {priceMode === 'discount' ? (
          <div className="grid-2" style={{ marginTop: 'var(--s-4)' }}>
            <Field
              label="Скидка"
              htmlFor="nb-disc"
              hint={can('booking.discount.unlimited') ? 'Без ограничения' : `До ${info.data?.settings.discountLimitPercent ?? 0}% - больше только управляющий`}
            >
              <div className="input-affix">
                <input id="nb-disc" className="input num" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value.replace(/\D/g, '').slice(0, 3))} />
                <span className="affix">%</span>
              </div>
            </Field>
            <Field label="Причина скидки" htmlFor="nb-reason">
              <input id="nb-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: постоянный гость" />
            </Field>
          </div>
        ) : null}
        {priceMode === 'special' ? (
          <div className="grid-3" style={{ marginTop: 'var(--s-4)' }}>
            <Field label="Цена за ночь" htmlFor="nb-special">
              <div className="input-affix">
                <input id="nb-special" className="input num" inputMode="decimal" value={special} onChange={(e) => setSpecial(e.target.value)} />
                <span className="affix">{currencySign(property.currency)}</span>
              </div>
            </Field>
            <Field label="Основание" htmlFor="nb-basis">
              <select id="nb-basis" className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Выберите</option>
                {bases.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Кто утвердил" htmlFor="nb-approver">
              <select id="nb-approver" className="select" value={approver} onChange={(e) => setApprover(e.target.value)}>
                <option value="">Выберите</option>
                {(directory.data ?? [])
                  .filter((u) => u.canApproveSpecialPrice)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
        ) : null}

        <QuotePreview quote={quote.data} error={quote.error} currency={property.currency} loading={quote.isFetching} />
      </section>

      <section className="section">
        <h3 className="section-title">Оформление</h3>
        <div className="stack">
          <Field label="Откуда бронь">
            <Choices label="Источник" value={source} onChange={setSource} options={SOURCES.map((s) => [s, BOOKING_SOURCE[s]!] as [typeof s, string])} />
          </Field>
          <div className="grid-2">
            <Field label="Тип оплаты" hint={priceMode === 'special' ? 'Спеццена идёт отдельной строкой в X- и Z-отчётах' : undefined}>
              {priceMode === 'special' ? (
                <div style={{ paddingTop: 8, fontWeight: 600 }}>Спеццена</div>
              ) : (
                <Choices
                  label="Тип оплаты"
                  value={paymentType}
                  onChange={setPaymentType}
                  options={[
                    ['cash', 'Наличные'],
                    ['cashless', 'Безналичные'],
                  ]}
                />
              )}
            </Field>
            <Field label="Компания-плательщик" htmlFor="nb-company" optional>
              <select id="nb-company" className="select" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
                <option value="">Гость платит сам</option>
                {(companies.data?.items ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {can('booking.confirm') ? (
            <Field
              label="Статус"
              hint={
                status === 'tentative'
                  ? `Без предоплаты в течение ${info.data?.settings.prepaymentHours ?? 24} ч бронь снимется сама`
                  : 'Подтверждённая бронь не снимается автоматически'
              }
            >
              <Choices
                label="Статус"
                value={status}
                onChange={setStatus}
                options={[
                  ['tentative', 'Предварительная'],
                  ['confirmed', 'Подтверждена'],
                ]}
              />
            </Field>
          ) : null}
          <Field label="Комментарий" htmlFor="nb-comment" optional>
            <textarea id="nb-comment" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Пожелания гостя, время приезда" />
          </Field>
        </div>
      </section>

      {conflict ? (
        <div className="alert" role="alert">
          <strong>Не получилось.</strong> {conflict}
        </div>
      ) : null}

      <div className="nb-submit">
        <div className="nb-total">
          {quote.data ? (
            <>
              <span className="muted">Итого</span> <Money value={quote.data.total} currency={property.currency} />
              {validDates ? (
                <span className="muted">
                  {' '}
                  · {dayShort(arrival)} - {dayShort(departure)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="muted">Выберите номер и тариф</span>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
          {create.isPending ? 'Создаём' : 'Создать бронь'}
        </button>
      </div>
    </form>
  );
}

function QuotePreview({ quote, error, currency, loading }: { quote: S['Quote'] | undefined; error: unknown; currency: string; loading: boolean }) {
  if (error) return <div className="field-error" style={{ marginTop: 'var(--s-3)' }}>{isApiError(error) ? error.message : 'Не удалось посчитать цену'}</div>;
  if (!quote) return null;
  const uniq = new Set(quote.nights.map((n) => n.amount));
  return (
    <div className="quote" data-loading={loading}>
      <div className="quote-nights">
        {uniq.size === 1 ? (
          <span>
            {nightsLabel(quote.nights.length)} × <Money value={quote.nights[0]!.amount} currency={currency} />
          </span>
        ) : (
          quote.nights.map((n) => (
            <span key={n.date} className="qn">
              <span className="muted">{dayShort(n.date)}</span> <Money value={n.amount} currency={currency} />
            </span>
          ))
        )}
      </div>
      <dl className="quote-sum">
        {quote.discountTotal ? (
          <>
            <dt>По тарифу</dt>
            <dd>
              <Money value={quote.baseTotal} currency={currency} />
            </dd>
            <dt>Скидка</dt>
            <dd>
              <Money value={-quote.discountTotal} currency={currency} />
            </dd>
          </>
        ) : null}
        <dt>Проживание</dt>
        <dd>
          <Money value={quote.accommodationTotal} currency={currency} />
        </dd>
        {quote.mealTotal ? (
          <>
            <dt>Завтраки</dt>
            <dd>
              <Money value={quote.mealTotal} currency={currency} />
            </dd>
          </>
        ) : null}
        <dt className="strong">Итого</dt>
        <dd className="strong">
          <Money value={quote.total} currency={currency} />
        </dd>
      </dl>
    </div>
  );
}
