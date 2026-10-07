import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useBookings } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Empty, Loading, Money, Status } from '@/components/ui/bits';
import { dayShort, stayRange } from '@/lib/format';
import { BOOKING_SOURCE, HK_STATUS, PAYMENT_TYPE } from '@/lib/labels';
import { openNewBooking } from './new-booking';
import { useOpenBooking } from './open';
import './bookings.css';

type View = 'arrivals' | 'departures' | 'inhouse' | 'all';
const VIEWS: [View, string][] = [
  ['arrivals', 'Заезды сегодня'],
  ['departures', 'Выезды сегодня'],
  ['inhouse', 'Живут'],
  ['all', 'Все брони'],
];

export function BookingsPage() {
  const search = useSearch({ strict: false }) as { view?: View; q?: string };
  const navigate = useNavigate();
  const can = useCan();
  const property = useProperty();
  const openBooking = useOpenBooking();
  const view: View = search.view && VIEWS.some(([v]) => v === search.view) ? search.view : 'arrivals';
  const [q, setQ] = useState(search.q ?? '');
  const [cursor, setCursor] = useState<string | undefined>();
  const [term, setTerm] = useState(search.q ?? '');

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => setCursor(undefined), [term, view]);

  const effectiveView = term ? 'all' : view;
  const list = useBookings({ view: effectiveView, ...(term ? { q: term } : {}), ...(cursor ? { cursor } : {}) });
  const setView = (v: View) => void navigate({ to: '/bookings', search: (prev: Record<string, unknown>) => ({ ...prev, view: v }) } as never);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Брони</h1>
          <p className="page-sub">Поиск по фамилии, телефону или номеру брони</p>
        </div>
        <div className="page-actions">
          <input className="input" style={{ width: 280 }} placeholder="Найти бронь" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск брони" />
          {can('booking.create') ? (
            <button type="button" className="btn btn-primary" onClick={() => openNewBooking({})}>
              Новая бронь
            </button>
          ) : null}
        </div>
      </div>

      {!term ? (
        <div className="tabs" role="tablist" style={{ marginBottom: 'var(--s-4)' }}>
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" role="tab" className="tab" aria-selected={view === v} onClick={() => setView(v)}>
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ marginBottom: 'var(--s-4)' }}>
          Результаты поиска «{term}»
        </p>
      )}

      {list.isPending ? (
        <Loading />
      ) : !list.data?.items.length ? (
        <Empty title={term ? 'Ничего не нашли' : view === 'arrivals' ? 'Сегодня заездов нет' : view === 'departures' ? 'Сегодня выездов нет' : view === 'inhouse' ? 'Никто не живёт' : 'Броней пока нет'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Бронь</th>
                <th>Гость</th>
                <th>Номер</th>
                <th>Проживание</th>
                <th>Статус</th>
                <th className="only-desktop">Источник</th>
                {can('folio.view') ? <th className="r">К оплате</th> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((b) => (
                <tr key={b.id} data-clickable onClick={() => openBooking(b.id)}>
                  <td className="num">{b.number}</td>
                  <td>
                    {b.guestName}
                    {b.isVip ? <span className="tag tag-strong" style={{ marginLeft: 6 }}>VIP</span> : null}
                    <span className="sub">
                      {b.adults + b.children} {b.adults + b.children === 1 ? 'гость' : 'гостя'} · {PAYMENT_TYPE[b.paymentType]}
                    </span>
                  </td>
                  <td className="num">
                    {b.roomNumber}
                    <span className="sub">{b.roomTypeName}</span>
                  </td>
                  <td className="nowrap">
                    {stayRange(b.arrival, b.departure, true)}
                    {b.status === 'tentative' || b.status === 'confirmed' ? (
                      <span className="sub">
                        {b.roomHkStatus !== 'inspected' && view === 'arrivals' ? <span className="danger">номер: {HK_STATUS[b.roomHkStatus]?.toLowerCase()}</span> : `создана ${dayShort(b.createdAt.slice(0, 10))}`}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <Status value={b.status} />
                    {b.prepaymentOverdue ? <span className="sub danger">предоплата просрочена</span> : null}
                  </td>
                  <td className="only-desktop muted">{BOOKING_SOURCE[b.source]}</td>
                  {can('folio.view') ? (
                    <td className="r">
                      {b.due ? b.due > 0 ? <Money value={b.due} currency={property.currency} tone={b.status === 'checked_in' ? 'due' : undefined} /> : <span className="muted">переплата</span> : <span className="muted">-</span>}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {list.data.nextCursor ? (
            <div style={{ padding: 'var(--s-4) 0' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setCursor(list.data!.nextCursor!)}>
                Дальше
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
