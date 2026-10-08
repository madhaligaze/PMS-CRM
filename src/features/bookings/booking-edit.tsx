import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useInvalidate, usePropertyInfo, useRatePlans, useTape, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Field } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';
import { addDays, diffDays } from '@/lib/dates';
import { money, nights as nightsLabel } from '@/lib/format';
import { HK_STATUS } from '@/lib/labels';

type Booking = S['Booking'];

/**
 * Изменение брони: продление, ранний заезд, поздний выезд, перенос в другой
 * номер. Живущему гостю дату заезда не меняют - только выезд и номер.
 */
export function BookingEdit({ b, onDone }: { b: Booking; onDone: () => void }) {
  const can = useCan();
  const property = useProperty();
  const info = usePropertyInfo();
  const plans = useRatePlans();
  const invalidate = useInvalidate();
  const today = info.data?.businessDate ?? b.arrival;
  const inHouse = b.status === 'checked_in';

  const [arrival, setArrival] = useState(b.arrival);
  const [departure, setDeparture] = useState(b.departure);
  const [roomId, setRoomId] = useState(b.roomId);
  const [adults, setAdults] = useState(b.adults);
  const [children, setChildren] = useState(b.children);
  const [ratePlanId, setRatePlanId] = useState(b.ratePlanId);
  const [meal, setMeal] = useState(b.meal);
  const [comment, setComment] = useState(b.comment ?? '');
  const [repriceAll, setRepriceAll] = useState(false);
  const [overrideRoom, setOverrideRoom] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = departure > arrival;
  const tape = useTape(valid ? arrival : b.arrival, valid ? departure : b.departure);
  const rooms = useMemo(() => {
    const t = tape.data;
    if (!t) return [];
    const busy = new Set([
      ...t.bookings.filter((x) => x.id !== b.id && x.arrival < departure && x.departure > arrival).map((x) => x.roomId),
      ...t.blocks.filter((k) => k.startsOn < departure && k.endsOn > arrival).map((k) => k.roomId),
    ]);
    return t.rooms.filter((r) => r.isActive).map((r) => ({ ...r, free: !busy.has(r.id), typeName: t.roomTypes.find((x) => x.id === r.roomTypeId)?.name ?? '' }));
  }, [tape.data, arrival, departure, b.id]);
  const target = rooms.find((r) => r.id === roomId);
  const roomChanged = roomId !== b.roomId;

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/bookings/{id}', {
          params: { path: { ...pid(), id: b.id } },
          headers: ifMatch(b.version),
          body: {
            ...(arrival !== b.arrival ? { arrival } : {}),
            ...(departure !== b.departure ? { departure } : {}),
            ...(roomChanged ? { roomId } : {}),
            ...(adults !== b.adults ? { adults } : {}),
            ...(children !== b.children ? { children } : {}),
            ...(ratePlanId !== b.ratePlanId ? { ratePlanId } : {}),
            ...(meal !== b.meal ? { meal } : {}),
            ...((comment.trim() || null) !== b.comment ? { comment: comment.trim() || null } : {}),
            reprice: repriceAll ? 'all' : 'keep',
            overrideRoomStatus: overrideRoom,
          },
        }),
      ),
    onSuccess: (nb) => {
      const diff = nb.accommodationTotal + nb.mealTotal - (b.accommodationTotal + b.mealTotal);
      toast.info(`Бронь ${nb.number} изменена`, diff ? `Стоимость ${diff > 0 ? 'выросла' : 'уменьшилась'} на ${money(Math.abs(diff), property.currency)}` : undefined);
      void invalidate('booking', 'bookings', 'tape', 'folio', 'dashboard', 'hk');
      onDone();
    },
    onError: (e) => {
      if (isApiError(e, 'version.conflict')) setError('Бронь уже изменил другой сотрудник. Закройте форму и откройте бронь заново.');
      else if (isApiError(e, 'room.not_ready')) setError(`${e.message}. ${e.detail ?? ''}`);
      else if (isApiError(e)) setError(`${e.message}${e.detail ? `. ${e.detail}` : ''}`);
      else toast.fail(e);
    },
  });

  const nightsNow = valid ? diffDays(arrival, departure) : 0;
  const nightsWas = diffDays(b.arrival, b.departure);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        save.mutate();
      }}
    >
      <section className="section">
        <h3 className="section-title">
          Даты <span className="aside">{nightsNow !== nightsWas ? `${nightsLabel(nightsWas)} → ${nightsLabel(nightsNow)}` : nightsLabel(nightsNow)}</span>
        </h3>
        <div className="grid-2">
          <Field label="Заезд" htmlFor="be-arr" hint={inHouse ? 'Заселение уже оформлено' : undefined}>
            <input
              id="be-arr"
              type="date"
              className="input"
              value={arrival}
              disabled={inHouse}
              min={today < b.arrival ? today : b.arrival}
              onChange={(e) => {
                setArrival(e.target.value);
                if (e.target.value >= departure) setDeparture(addDays(e.target.value, 1));
              }}
            />
          </Field>
          <Field label="Выезд" htmlFor="be-dep" hint={inHouse ? 'Продление или ранний выезд' : undefined}>
            <input id="be-dep" type="date" className="input" value={departure} min={addDays(inHouse ? (today > arrival ? today : arrival) : arrival, inHouse && today > arrival ? 0 : 1)} onChange={(e) => setDeparture(e.target.value)} />
          </Field>
        </div>
        {inHouse ? (
          <div className="row" style={{ marginTop: 'var(--s-3)' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeparture(addDays(departure, 1))}>
              Продлить на ночь
            </button>
            {departure > addDays(arrival, 1) && departure > today ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeparture(today > arrival ? today : addDays(arrival, 1))}>
                Выезд сегодня
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="section">
        <h3 className="section-title">{inHouse ? 'Переселение' : 'Номер'}</h3>
        <div className="room-pick" role="radiogroup" aria-label="Номер">
          {rooms.map((r) => (
            <button
              key={r.id}
              type="button"
              role="radio"
              aria-checked={roomId === r.id}
              className="choice room-choice"
              disabled={!r.free && r.id !== b.roomId}
              onClick={() => setRoomId(r.id)}
            >
              <span className="rc-num">{r.number}</span>
              <span className="rc-type">{r.typeName}</span>
              {!r.free && r.id !== b.roomId ? <span className="rc-state">занят</span> : inHouse && r.id !== b.roomId && r.hkStatus !== 'inspected' ? <span className="rc-state danger">{HK_STATUS[r.hkStatus]?.toLowerCase()}</span> : null}
            </button>
          ))}
        </div>
        {inHouse && roomChanged && target && target.hkStatus !== 'inspected' ? (
          <label className="check" style={{ marginTop: 'var(--s-3)' }}>
            <input type="checkbox" checked={overrideRoom} onChange={(e) => setOverrideRoom(e.target.checked)} />
            <span>Номер {target.number} не проверен хозслужбой - всё равно переселить</span>
          </label>
        ) : null}
        {inHouse && roomChanged ? <p className="field-hint" style={{ marginTop: 6 }}>Старый номер уйдёт в уборку автоматически.</p> : null}
      </section>

      <section className="section">
        <h3 className="section-title">Гости и тариф</h3>
        <div className="grid-3">
          <Field label="Взрослых" htmlFor="be-ad">
            <select id="be-ad" className="select" value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Детей" htmlFor="be-ch">
            <select id="be-ch" className="select" value={children} onChange={(e) => setChildren(Number(e.target.value))}>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Тариф" htmlFor="be-plan">
            <select id="be-plan" className="select" value={ratePlanId} onChange={(e) => setRatePlanId(e.target.value)} disabled={!can('booking.edit')}>
              {(plans.data ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={!p.isActive}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="field" style={{ marginTop: 'var(--s-4)' }}>
          <span className="field-label">Питание</span>
          <Choices
            label="Питание"
            value={meal}
            onChange={setMeal}
            options={[
              ['none', 'Без питания'],
              ['breakfast', 'Завтрак'],
            ]}
          />
        </div>
        <label className="check" style={{ marginTop: 'var(--s-4)' }}>
          <input type="checkbox" checked={repriceAll} onChange={(e) => setRepriceAll(e.target.checked)} />
          <span>Пересчитать все ночи по текущему тарифу (обычно ночи сохраняют цену брони)</span>
        </label>
      </section>

      <section className="section">
        <Field label="Комментарий" htmlFor="be-comment" optional>
          <textarea id="be-comment" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </section>

      {error ? (
        <div className="alert" role="alert">
          <strong>Не сохранено.</strong> {error}
        </div>
      ) : null}

      <div className="row form-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid || save.isPending}>
          {save.isPending ? 'Сохраняю' : 'Сохранить'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}
