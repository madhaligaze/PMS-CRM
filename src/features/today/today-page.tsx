import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { api, pid, unwrap } from '@/api/client';
import { useAttendanceMe, useDashboard, useInvalidate, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Empty, Loading, Money } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';
import { openNewBooking } from '@/features/bookings/new-booking';
import { dayTitle, nights as nightsLabel, time } from '@/lib/format';
import { diffDays } from '@/lib/dates';
import { HK_STATUS } from '@/lib/labels';
import './today.css';

type Item = S['BookingListItem'];

function useOpenBooking() {
  const navigate = useNavigate();
  return (id: string) => void navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, booking: id }) } as never);
}

function ClockPrompt() {
  const me = useAttendanceMe();
  const invalidate = useInvalidate();
  const clock = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/attendance/clock', { params: { path: pid() }, body: { kind: 'in' } })),
    onSuccess: () => {
      toast.info('Приход отмечен');
      void invalidate('attendance', 'cash', 'dashboard');
    },
    onError: toast.fail,
  });
  if (!me.data || me.data.clockedIn) return null;
  return (
    <div className="note today-clock">
      <span>Вы ещё не отметили приход. Без отметки кассовую смену не открыть.</span>
      <button type="button" className="btn btn-primary btn-sm" disabled={clock.isPending} onClick={() => clock.mutate()}>
        Отметить приход
      </button>
    </div>
  );
}

export function TodayPage() {
  const dash = useDashboard();
  const can = useCan();
  const property = useProperty();
  const open = useOpenBooking();

  if (dash.isPending) return <div className="page"><Loading /></div>;
  if (dash.isError || !dash.data) return <div className="page"><Empty title="Сводка не загрузилась">Обновите страницу.</Empty></div>;
  const d = dash.data;

  const unpaidDepartures = d.departures.filter((b) => b.status === 'checked_in' && (b.due ?? 0) > 0);
  const notReady = d.arrivals.filter((a) => a.status !== 'checked_in' && a.roomHkStatus !== 'inspected');
  const attention = d.overduePrepayments.length + notReady.length + unpaidDepartures.length + (d.overdueTasks ? 1 : 0);
  const arrivedCount = d.arrivals.filter((a) => a.status === 'checked_in').length;
  const departedCount = d.departures.filter((b) => b.status === 'checked_out').length;

  return (
    <div className="page today">
      <div className="page-head">
        <div>
          <h1 className="page-title">{dayTitle(d.businessDate)}</h1>
          <p className="page-sub">Операционные сутки с 06:00 · {d.propertyName}</p>
        </div>
        <div className="page-actions">
          {can('booking.create') ? (
            <button type="button" className="btn btn-primary" onClick={() => openNewBooking({})}>
              Новая бронь
            </button>
          ) : null}
        </div>
      </div>

      {can('attendance.self') ? <ClockPrompt /> : null}

      <div className="figures">
        <div className="figure">
          <span className="v">
            {Math.round(d.occupancy.pct)}
            <small>%</small>
          </span>
          <span className="l">
            загрузка, {d.occupancy.occupied} из {d.occupancy.rooms}
          </span>
        </div>
        <div className="figure">
          <span className="v">{d.arrivals.length}</span>
          <span className="l">заездов, заселено {arrivedCount}</span>
        </div>
        <div className="figure">
          <span className="v">{d.departures.length}</span>
          <span className="l">выездов, выехало {departedCount}</span>
        </div>
        <div className="figure">
          <span className="v">{d.inHouse}</span>
          <span className="l">номеров живут, гостей {d.guestsInHouse}</span>
        </div>
        <div className="figure">
          <span className="v">{d.roomStates.dirty + d.roomStates.cleaning}</span>
          <span className="l">к уборке, на проверке {d.roomStates.clean}</span>
        </div>
        {d.roomStates.repair ? (
          <div className="figure">
            <span className="v">{d.roomStates.repair}</span>
            <span className="l">на ремонте</span>
          </div>
        ) : null}
      </div>

      {attention ? (
        <section className="today-attention" aria-label="Требует внимания">
          <h2 className="section-title">Требует внимания</h2>
          <ul role="list" className="attention-list">
            {d.overduePrepayments.map((b) => (
              <li key={b.id}>
                <span className="a-what">Предоплата не внесена в срок</span>
                <button type="button" className="a-link" onClick={() => open(b.id)}>
                  Бронь {b.number} · {b.guestName} · номер {b.roomNumber}
                </button>
              </li>
            ))}
            {notReady.map((b) => (
              <li key={b.id}>
                <span className="a-what">Заезд сегодня, номер не готов</span>
                <button type="button" className="a-link" onClick={() => open(b.id)}>
                  {b.roomNumber}: {HK_STATUS[b.roomHkStatus]?.toLowerCase()} · {b.guestName}
                </button>
              </li>
            ))}
            {unpaidDepartures.map((b) => (
              <li key={b.id}>
                <span className="a-what">Выезд сегодня, счёт не оплачен</span>
                <button type="button" className="a-link" onClick={() => open(b.id)}>
                  {b.roomNumber} · {b.guestName} · <Money value={b.due ?? 0} currency={property.currency} />
                </button>
              </li>
            ))}
            {d.overdueTasks ? (
              <li>
                <span className="a-what">Уборка не сделана к сроку</span>
                <Link to={can('hk.view') ? '/housekeeping' : '/tasks'} className="a-link">
                  {d.overdueTasks} {d.overdueTasks === 1 ? 'задача' : 'задачи'} в хозслужбе
                </Link>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <div className="today-cols">
        <section>
          <h2 className="section-title">
            Заезды <span className="aside">{d.arrivals.length ? `${d.arrivals.length}` : 'нет'}</span>
          </h2>
          {d.arrivals.length ? <MoveTable rows={d.arrivals} kind="arrival" onOpen={open} /> : <p className="muted">Сегодня заездов нет.</p>}
        </section>
        <section>
          <h2 className="section-title">
            Выезды <span className="aside">{d.departures.length ? `${d.departures.length}` : 'нет'}</span>
          </h2>
          {d.departures.length ? <MoveTable rows={d.departures} kind="departure" onOpen={open} /> : <p className="muted">Сегодня выездов нет.</p>}
        </section>
      </div>

      {d.shift ? (
        <p className="today-shift">
          Смена {d.shift.number} открыта в {time(d.shift.openedAt, property.timezone)} · {d.shift.openedBy} · в кассе{' '}
          <Money value={d.shift.expectedCash} currency={property.currency} />
        </p>
      ) : can('cash.view') ? (
        <p className="today-shift muted">
          Кассовая смена закрыта. <Link to="/cash">Открыть смену</Link>
        </p>
      ) : null}
    </div>
  );
}

function MoveTable({ rows, kind, onOpen }: { rows: Item[]; kind: 'arrival' | 'departure'; onOpen: (id: string) => void }) {
  const can = useCan();
  const property = useProperty();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Номер</th>
            <th>Гость</th>
            <th>{kind === 'arrival' ? 'Ночей' : 'Статус'}</th>
            {kind === 'arrival' ? <th>Номер готов</th> : null}
            {can('folio.view') ? <th className="r">К оплате</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const done = kind === 'arrival' ? b.status === 'checked_in' : b.status === 'checked_out';
            const ready = b.roomHkStatus === 'inspected';
            return (
              <tr key={b.id} data-clickable onClick={() => onOpen(b.id)} data-done={done}>
                <td className="num room-cell">{b.roomNumber}</td>
                <td>
                  {b.guestName}
                  {b.isVip ? <span className="tag tag-strong" style={{ marginLeft: 6 }}>VIP</span> : null}
                  <span className="sub">
                    {/* Что уже оформлено, говорит колонка статуса; здесь - номер брони, чтобы не повторять. */}
                    {b.status === 'tentative' ? 'предварительная бронь' : `бронь ${b.number}`}
                  </span>
                </td>
                <td className="num">{kind === 'arrival' ? nightsLabel(diffDays(b.arrival, b.departure)) : done ? 'Выезд оформлен' : 'Проживает'}</td>
                {kind === 'arrival' ? (
                  <td>{done ? <span className="muted">в номере</span> : ready ? 'Готов' : <span className="danger">{HK_STATUS[b.roomHkStatus]}</span>}</td>
                ) : null}
                {can('folio.view') ? (
                  <td className="r">{b.due != null ? b.due > 0 ? <Money value={b.due} currency={property.currency} tone={kind === 'departure' && !done ? 'due' : undefined} /> : <span className="muted">оплачено</span> : '-'}</td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
