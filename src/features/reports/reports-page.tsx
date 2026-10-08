import { useState } from 'react';
import { download } from '@/api/client';
import { useDailyReport, usePeriodReport, usePropertyInfo, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Empty, Field, Loading, Money } from '@/components/ui/bits';
import { ChevronGlyph } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { useOpenBooking } from '@/features/bookings/open';
import { addDays, diffDays } from '@/lib/dates';
import { amount, currencySign, dayShort, dayTitle, plural, time, weekdayShort } from '@/lib/format';
import { ChartKey, ColumnChart, type Column } from './column-chart';
import './reports.css';

type Period = S['PeriodReport'];
type Daily = S['DailyReport'];
type Preset = '7' | '30' | '90' | 'month' | 'prev' | 'custom';

const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });
const pct = (v: number) => `${Math.round(v)}%`;

/** Отчёты: день - для ресепшена и управляющего, период - для владельца. */
export function ReportsPage() {
  const can = useCan();
  const [tab, setTab] = useState<'day' | 'period' | 'export'>('day');
  return (
    <div className="page reports">
      <div className="page-head">
        <div>
          <h1 className="page-title">Отчёты</h1>
        </div>
      </div>
      <div className="tabs page-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'day'} onClick={() => setTab('day')}>
          За день
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'period'} onClick={() => setTab('period')}>
          За период
        </button>
        {can('reports.export') ? (
          <button type="button" role="tab" className="tab" aria-selected={tab === 'export'} onClick={() => setTab('export')}>
            Выгрузка
          </button>
        ) : null}
      </div>
      {tab === 'day' ? <DayReport /> : tab === 'period' ? <PeriodReport /> : <ExportTab />}
    </div>
  );
}

// ── За день ───────────────────────────────────────────────────────────────

function DayReport() {
  const info = usePropertyInfo();
  const today = info.data?.businessDate;
  const [date, setDate] = useState<string | null>(null);
  const day = date ?? today;
  const q = useDailyReport(day);
  if (!day || q.isPending) return <Loading />;
  if (!q.data) return <Empty title="Отчёт не загрузился">Обновите страницу.</Empty>;
  return (
    <div className={q.isFetching && q.isPlaceholderData ? 'is-refetching' : undefined}>
      <div className="rep-filter row">
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Предыдущий день" onClick={() => setDate(addDays(day, -1))}>
          <ChevronGlyph dir="left" />
        </button>
        <input type="date" className="input rep-date" value={day} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Дата отчёта" />
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Следующий день" disabled={!!today && day >= today} onClick={() => setDate(addDays(day, 1))}>
          <ChevronGlyph dir="right" />
        </button>
        <span className="rep-day-title">{dayTitle(day)}</span>
        {today && day !== today ? (
          <button type="button" className="btn-quiet" onClick={() => setDate(null)}>
            Сегодня
          </button>
        ) : null}
      </div>
      <DayBody r={q.data} />
    </div>
  );
}

function DayBody({ r }: { r: Daily }) {
  const property = useProperty();
  const cur = property.currency;
  return (
    <>
      <div className="figures rep-figures">
        <div className="figure">
          <span className="v rep-v">{pct(r.rooms.occupancyPct)}</span>
          <span className="l">
            загрузка, {r.rooms.occupied} из {r.rooms.available} {plural(r.rooms.available, 'номера', 'номеров', 'номеров')}
          </span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            {r.arrivals.arrived}
            <small>из {r.arrivals.expected}</small>
          </span>
          <span className="l">заехали</span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            {r.departures.departed}
            <small>из {r.departures.expected}</small>
          </span>
          <span className="l">выехали</span>
        </div>
        <div className="figure">
          <span className="v rep-v">{r.inHouse}</span>
          <span className="l">
            {plural(r.inHouse, 'номер занят', 'номера заняты', 'номеров занято')}, {r.guests} {plural(r.guests, 'гость', 'гостя', 'гостей')}
          </span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            <Money value={r.revenue.payments} currency={cur} />
          </span>
          <span className="l">принято оплат за вычетом возвратов</span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            <Money value={r.revenue.accommodation} currency={cur} />
          </span>
          <span className="l">начислено за проживание</span>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">Оплаты по способам</h2>
        <div className="table-wrap">
          <table className="table rep-narrow">
            <thead>
              <tr>
                <th>Способ</th>
                <th className="r">Документов</th>
                <th className="r">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {r.revenue.byMethod.map((m) => (
                <tr key={m.key} className={m.count ? undefined : 'rep-empty'}>
                  <td>{m.label}</td>
                  <td className="r num">{m.count}</td>
                  <td className="r">
                    <Money value={m.amount} currency={cur} />
                  </td>
                </tr>
              ))}
              {r.revenue.refunds ? (
                <tr>
                  <td>Возвраты</td>
                  <td />
                  <td className="r">
                    <Money value={-r.revenue.refunds} currency={cur} />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <EventsTable title="Отмены и незаезды" rows={r.cancellations} empty="Отмен и незаездов не было" amountLabel="Сумма брони" />
      <EventsTable title="Скидки и спеццены" rows={r.discounts} empty="Броней со скидкой не было" amountLabel="Скидка" />
      <EventsTable title="Сторно" rows={r.stornos} empty="Сторно не было" amountLabel="Сумма" />
    </>
  );
}

function EventsTable({ title, rows, empty, amountLabel }: { title: string; rows: Daily['cancellations']; empty: string; amountLabel: string }) {
  const property = useProperty();
  const openBooking = useOpenBooking();
  return (
    <section className="section">
      <h2 className="section-title">
        {title}
        {rows.length ? <span className="aside">{rows.length}</span> : null}
      </h2>
      {!rows.length ? (
        <p className="muted">{empty}.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Бронь</th>
                <th>Что</th>
                <th className="r">{amountLabel}</th>
                <th>Причина</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td className="num">{time(e.at, property.timezone)}</td>
                  <td>
                    {e.bookingId ? (
                      <button type="button" className="link-btn num" onClick={() => openBooking(e.bookingId!)}>
                        № {e.bookingNumber}
                      </button>
                    ) : (
                      '-'
                    )}
                    {e.guest ? <span className="sub">{e.guest}</span> : null}
                  </td>
                  <td>{e.kind}</td>
                  <td className="r">
                    <Money value={e.amount} currency={property.currency} />
                  </td>
                  <td className="ink-2">{e.reason ?? '-'}</td>
                  <td>{e.by ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── За период ─────────────────────────────────────────────────────────────

function rangeOf(preset: Preset, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case '7':
      return { from: addDays(today, -6), to: today };
    case '30':
      return { from: addDays(today, -29), to: today };
    case '90':
      return { from: addDays(today, -89), to: today };
    case 'month':
      return { from: monthStart, to: today };
    case 'prev': {
      const prevEnd = addDays(monthStart, -1);
      return { from: `${prevEnd.slice(0, 7)}-01`, to: prevEnd };
    }
    default:
      return custom;
  }
}

function PeriodReport() {
  const info = usePropertyInfo();
  const today = info.data?.businessDate;
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState({ from: '', to: '' });
  if (!today) return <Loading />;
  const range = rangeOf(preset, today, custom.from && custom.to ? custom : { from: addDays(today, -29), to: today });
  return (
    <>
      <div className="rep-filter rep-period-filter">
        <Choices
          label="Период"
          value={preset}
          onChange={(p) => {
            if (p === 'custom' && !custom.from) setCustom(rangeOf(preset, today, custom));
            setPreset(p);
          }}
          options={[
            ['7', '7 дней'],
            ['30', '30 дней'],
            ['90', '90 дней'],
            ['month', 'Этот месяц'],
            ['prev', 'Прошлый месяц'],
            ['custom', 'Свой'],
          ]}
        />
        {preset === 'custom' ? (
          <span className="row">
            <input type="date" className="input rep-date" value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="С даты" />
            <span className="muted">-</span>
            <input type="date" className="input rep-date" value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="По дату" />
          </span>
        ) : (
          <span className="muted">
            {dayShort(range.from)} - {dayShort(range.to)}
          </span>
        )}
      </div>
      {diffDays(range.from, range.to) < 0 ? (
        <Empty title="Начало периода позже конца" />
      ) : diffDays(range.from, range.to) > 400 ? (
        <Empty title="Период длиннее 400 дней">Разбейте его на части.</Empty>
      ) : (
        <PeriodBody from={range.from} to={range.to} today={today} />
      )}
    </>
  );
}

function PeriodBody({ from, to, today }: { from: string; to: string; today: string }) {
  const property = useProperty();
  const q = usePeriodReport(from, to);
  const [asTable, setAsTable] = useState(false);
  if (q.isPending) return <Loading />;
  if (!q.data) return <Empty title="Отчёт не загрузился">Обновите страницу.</Empty>;
  const r: Period = q.data;
  const cur = property.currency;
  const sign = currencySign(cur);
  const money = (v: number) => `${amount(v)} ${sign}`;
  const future = r.days.some((d) => d.date > today);
  const monthAt = (d: string, i: number) => (i === 0 || d.endsWith('-01') ? dayShort(d) : String(Number(d.slice(8))));
  const title = (d: string) => `${weekdayShort(d)}, ${dayShort(d)}${d > today ? ' · по броням' : ''}`;

  const occupancy: Column[] = r.days.map((d, i) => ({
    key: d.date,
    value: d.occupancyPct,
    tick: monthAt(d.date, i),
    muted: d.date > today,
    tip: {
      title: title(d.date),
      lines: [
        ['загрузка', pct(d.occupancyPct)],
        ['продано номеров', `${d.occupied} из ${d.available}`],
        ...(d.tentative ? ([['без подтверждения', String(d.tentative)]] as [string, string][]) : []),
      ],
    },
  }));
  const revenue: Column[] = r.days.map((d, i) => ({
    key: d.date,
    value: d.revenue / 100,
    tick: monthAt(d.date, i),
    muted: d.date > today,
    tip: {
      title: title(d.date),
      lines: [
        ['за проживание', money(d.revenue)],
        ['средняя цена ночи', d.occupied ? money(d.adr) : '-'],
        ['на доступный номер', money(d.revpar)],
      ],
    },
  }));
  const sourceMax = Math.max(1, ...r.bySource.map((s) => s.revenue));
  const sourceTotal = r.bySource.reduce((a, s) => a + s.revenue, 0);
  const hk = r.housekeeping;

  return (
    <div className={q.isFetching && q.isPlaceholderData ? 'is-refetching' : undefined}>
      <div className="figures rep-figures">
        <div className="figure">
          <span className="v rep-v">{pct(r.totals.occupancyPct)}</span>
          <span className="l">
            загрузка: продано {r.totals.occupied} из {r.totals.available} {plural(r.totals.available, 'номеро-ночи', 'номеро-ночей', 'номеро-ночей')}
          </span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            <Money value={r.totals.revenue} currency={cur} />
          </span>
          <span className="l">выручка от проживания</span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            <Money value={Math.round(r.totals.adr / 100) * 100} currency={cur} />
          </span>
          <span className="l">средняя цена проданной ночи (ADR)</span>
        </div>
        <div className="figure">
          <span className="v rep-v">
            <Money value={Math.round(r.totals.revpar / 100) * 100} currency={cur} />
          </span>
          <span className="l">выручка на доступный номер (RevPAR)</span>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">
          Загрузка по дням
          <button type="button" className="btn-quiet" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
            {asTable ? 'Графиком' : 'Таблицей'}
          </button>
        </h2>
        {asTable ? (
          <DaysTable r={r} today={today} />
        ) : (
          <>
            {future ? <ChartKey items={[{ label: 'Прошедшие дни' }, { label: 'Будущие: по текущим броням', muted: true }]} /> : null}
            <ColumnChart data={occupancy} yMax={100} yFormat={pct} label={`Загрузка по дням, ${dayShort(from)} - ${dayShort(to)}`} />
          </>
        )}
      </section>

      {asTable ? null : (
        <section className="section">
          <h2 className="section-title">Выручка от проживания по дням</h2>
          <ColumnChart data={revenue} yFormat={(v) => (v ? compact.format(v) : '0')} label={`Выручка по дням, ${dayShort(from)} - ${dayShort(to)}, ${sign}`} />
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Откуда брони</h2>
        {!r.bySource.length ? (
          <p className="muted">Проданных ночей за период нет.</p>
        ) : (
          <div className="table-wrap">
            <table className="table rep-sources">
              <thead>
                <tr>
                  <th>Источник</th>
                  <th className="r">Броней</th>
                  <th className="r">Ночей</th>
                  <th className="r">Выручка</th>
                  <th className="rep-share-h">Доля выручки</th>
                </tr>
              </thead>
              <tbody>
                {r.bySource.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="r num">{s.bookings}</td>
                    <td className="r num">{s.nights}</td>
                    <td className="r">
                      <Money value={s.revenue} currency={cur} />
                    </td>
                    <td className="rep-share">
                      <span className="rep-bar" style={{ width: `${(s.revenue / sourceMax) * 100}%` }} aria-hidden="true" />
                      <span className="rep-share-v">{sourceTotal ? `${Math.round((s.revenue / sourceTotal) * 100)}%` : '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Сотрудники</h2>
        {!r.byStaff.length ? (
          <p className="muted">За период брони не оформлялись.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Сотрудник</th>
                  <th className="r">Оформил броней</th>
                  <th className="r">Ночей</th>
                  <th className="r">На сумму</th>
                  <th className="r">Сторно</th>
                </tr>
              </thead>
              <tbody>
                {r.byStaff.map((s) => (
                  <tr key={s.userId}>
                    <td>{s.name}</td>
                    <td className="r num">{s.bookings}</td>
                    <td className="r num">{s.nights}</td>
                    <td className="r">
                      <Money value={s.revenue} currency={cur} />
                    </td>
                    <td className="r">
                      {s.stornos ? (
                        <>
                          <span className="num">{s.stornos}</span>
                          <span className="sub">
                            <Money value={s.stornoAmount} currency={cur} />
                          </span>
                        </>
                      ) : (
                        <span className="muted">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section-title">Хозслужба и ремонт</h2>
        <div className="figures rep-figures rep-figures-quiet">
          <div className="figure">
            <span className="v">{hk.tasksDone}</span>
            <span className="l">{plural(hk.tasksDone, 'уборка сделана', 'уборки сделано', 'уборок сделано')}</span>
          </div>
          <div className="figure">
            <span className="v">{hk.avgCleanMinutes ?? '-'}</span>
            <span className="l">{hk.avgCleanMinutes != null ? plural(hk.avgCleanMinutes, 'минута', 'минуты', 'минут') : 'минут'} в среднем на уборку</span>
          </div>
          <div className="figure" data-alert={hk.overdue ? 'true' : undefined}>
            <span className="v">{hk.overdue}</span>
            <span className="l">{plural(hk.overdue, 'уборка', 'уборки', 'уборок')} с опозданием</span>
          </div>
          <div className="figure">
            <span className="v">{hk.openRequests}</span>
            <span className="l">{plural(hk.openRequests, 'заявка на ремонт открыта', 'заявки на ремонт открыты', 'заявок на ремонт открыто')} сейчас</span>
          </div>
          <div className="figure">
            <span className="v">{hk.blockedRoomNights}</span>
            <span className="l">{plural(hk.blockedRoomNights, 'номеро-ночь снята', 'номеро-ночи сняты', 'номеро-ночей снято')} с продажи</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function DaysTable({ r, today }: { r: Period; today: string }) {
  const property = useProperty();
  const cur = property.currency;
  return (
    <div className="table-wrap rep-days">
      <table className="table">
        <thead>
          <tr>
            <th>День</th>
            <th className="r">Доступно</th>
            <th className="r">Продано</th>
            <th className="r">Без подтв.</th>
            <th className="r">Загрузка</th>
            <th className="r">Выручка</th>
            <th className="r">ADR</th>
            <th className="r">RevPAR</th>
          </tr>
        </thead>
        <tbody>
          {r.days.map((d) => (
            <tr key={d.date} className={d.date > today ? 'rep-future' : undefined}>
              <td className="nowrap">
                {weekdayShort(d.date)}, {dayShort(d.date)}
              </td>
              <td className="r num">{d.available}</td>
              <td className="r num">{d.occupied}</td>
              <td className="r num">{d.tentative || ''}</td>
              <td className="r num">{pct(d.occupancyPct)}</td>
              <td className="r">
                <Money value={d.revenue} currency={cur} />
              </td>
              <td className="r">{d.occupied ? <Money value={d.adr} currency={cur} /> : '-'}</td>
              <td className="r">
                <Money value={d.revpar} currency={cur} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Выгрузка ──────────────────────────────────────────────────────────────

function ExportTab() {
  const info = usePropertyInfo();
  const property = useProperty();
  const today = info.data?.businessDate ?? '';
  const [from, setFrom] = useState(() => (today ? `${today.slice(0, 7)}-01` : ''));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const f = from || (today ? `${today.slice(0, 7)}-01` : '');
  const t = to || today;
  const ok = !!f && !!t && f <= t;
  return (
    <section className="rep-export">
      <p className="ink-2">Все оплаты, возвраты и сторно за период одной таблицей: для 1С, бухгалтера и Excel. Каждая строка - документ кассы с номером чека.</p>
      <div className="row rep-export-form">
        <Field label="С" htmlFor="ex-from">
          <input id="ex-from" type="date" className="input" value={f} max={t || undefined} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="По" htmlFor="ex-to">
          <input id="ex-to" type="date" className="input" value={t} min={f || undefined} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!ok || busy}
          onClick={() => {
            setBusy(true);
            download(`/api/v1/properties/${property.id}/reports/payments-export?from=${f}&to=${t}`, `payments-${f}-${t}.csv`)
              .catch(toast.fail)
              .finally(() => setBusy(false));
          }}
        >
          {busy ? 'Готовлю файл' : 'Скачать CSV'}
        </button>
      </div>
    </section>
  );
}
