import { useMutation } from '@tanstack/react-query';
import { Fragment, useEffect, useState } from 'react';
import { api, download, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useAttendance, useInvalidate, usePropertyInfo, useTimesheet, type S } from '@/api/hooks';
import { CabinetTabs } from '@/app/cabinet-tabs';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Empty, Field, Loading } from '@/components/ui/bits';
import { ChevronGlyph, Dialog } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { zonedParts, zonedToIso } from '@/lib/dates';
import { dayShort, minutesToHours, monthName, time, weekdayShort } from '@/lib/format';
import './staff.css';

type Row = S['Timesheet']['rows'][number];
type Event = S['AttendanceEvent'];

const shiftMonth = (month: string, n: number) => {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/**
 * Табель за месяц: часы и дни каждого, пропущенные уходы. Исправляет отметку
 * только тот, кому открыто «Учёт времени - Правит», и всегда с причиной:
 * прежняя отметка не стирается, а помечается исправленной.
 */
export function TimesheetPage() {
  const can = useCan();
  const property = useProperty();
  const info = usePropertyInfo();
  const [month, setMonth] = useState<string | null>(null);
  useEffect(() => {
    if (!month && info.data) setMonth(info.data.businessDate.slice(0, 7));
  }, [info.data, month]);
  const current = month ?? new Date().toISOString().slice(0, 7);
  const sheet = useTimesheet(current);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  return (
    <div className="page">
      <CabinetTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Табель</h1>
        </div>
        <div className="page-actions">
          <div className="month-switch">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Прошлый месяц" onClick={() => setMonth(shiftMonth(current, -1))}>
              <ChevronGlyph dir="left" />
            </button>
            <span className="month-name">
              {monthName(`${current}-01`)} {current.slice(0, 4)}
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Следующий месяц" onClick={() => setMonth(shiftMonth(current, 1))}>
              <ChevronGlyph />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await download(`/api/v1/properties/${pid().propertyId}/attendance/timesheet/export?month=${current}`, `timesheet-${current}.csv`);
              } catch (e) {
                toast.fail(e);
              } finally {
                setExporting(false);
              }
            }}
          >
            Выгрузить в Excel
          </button>
        </div>
      </div>
      {sheet.isPending ? (
        <Loading />
      ) : !sheet.data?.rows.length ? (
        <Empty title="Отметок за месяц нет" />
      ) : (
        <div className="table-wrap">
          <table className="table timesheet">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th className="r">Дней</th>
                <th className="r">Часов</th>
                <th className="r">Без отметки ухода</th>
              </tr>
            </thead>
            <tbody>
              {sheet.data.rows.map((r) => (
                <Fragment key={r.userId}>
                  <tr data-clickable aria-expanded={open === r.userId} onClick={() => setOpen(open === r.userId ? null : r.userId)}>
                    <td>
                      {r.name}
                      <span className="sub">{r.position}</span>
                    </td>
                    <td className="r num">{r.daysWorked || <span className="muted">-</span>}</td>
                    <td className="r num">{r.totalMinutes ? (r.totalMinutes / 60).toFixed(1).replace('.', ',') : <span className="muted">-</span>}</td>
                    <td className={`r num${r.missingOut ? ' danger' : ''}`}>{r.missingOut || <span className="muted">-</span>}</td>
                  </tr>
                  {open === r.userId ? (
                    <tr className="timesheet-detail">
                      <td colSpan={4}>
                        <PersonMonth row={r} month={current} canCorrect={can('attendance.correct')} tz={property.timezone} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Edit = { kind: 'in' | 'out'; date: string; time: string; event: Event | null };

/** Месяц одного человека по дням: приход, уход, часы; исправить или добавить отметку. */
function PersonMonth({ row, month, canCorrect, tz }: { row: Row; month: string; canCorrect: boolean; tz: string }) {
  const from = `${month}-01`;
  const to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const events = useAttendance({ from, to, userId: row.userId });
  const [edit, setEdit] = useState<Edit | null>(null);
  const byDay = new Map<string, Event[]>();
  for (const e of [...(events.data ?? [])].reverse()) {
    if (e.supersededBy) continue;
    const day = zonedParts(e.at, tz).date;
    byDay.set(day, [...(byDay.get(day) ?? []), e]);
  }
  const days = row.days;
  if (!days.length && !canCorrect) return <p className="muted">В этом месяце отметок нет.</p>;
  return (
    <div className="person-month">
      {days.length ? (
        <ul role="list" className="days">
          {days.map((d) => {
            const list = byDay.get(d.date) ?? [];
            return (
              <li key={d.date} className="day">
                <span className="day-date">
                  {dayShort(d.date)}, {weekdayShort(d.date)}
                </span>
                <span className="day-marks">
                  {list.map((e) => (
                    <button key={e.id} type="button" className="mark-time" disabled={!canCorrect} onClick={() => setEdit({ kind: e.kind, ...zonedParts(e.at, tz), event: e })} title={e.reason ? `Исправлено: ${e.reason}` : undefined}>
                      {e.kind === 'in' ? 'приход' : 'уход'} {time(e.at, tz)}
                      {e.method === 'manual' ? <span className="muted"> · вручную</span> : null}
                    </button>
                  ))}
                  {d.open ? <span className="danger">уход не отмечен</span> : d.working ? <span className="muted">на работе</span> : null}
                </span>
                <span className="day-hours num">{d.minutes ? minutesToHours(d.minutes) : ''}</span>
                {canCorrect && d.open ? (
                  <button type="button" className="btn btn-quiet" onClick={() => setEdit({ kind: 'out', date: d.date, time: '18:00', event: null })}>
                    Добавить уход
                  </button>
                ) : (
                  <span />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {canCorrect ? (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEdit({ kind: 'in', date: days[days.length - 1]?.date ?? from, time: '09:00', event: null })}>
          Добавить отметку
        </button>
      ) : null}
      <MarkDialog edit={edit} userId={row.userId} name={row.name} tz={tz} onClose={() => setEdit(null)} />
    </div>
  );
}

function MarkDialog({ edit, userId, name, tz, onClose }: { edit: Edit | null; userId: string; name: string; tz: string; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [form, setForm] = useState<Edit>({ kind: 'in', date: '', time: '', event: null });
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (edit) {
      setForm(edit);
      setReason('');
      setError(null);
    }
  }, [edit]);
  const save = useMutation({
    mutationFn: () => {
      const at = zonedToIso(form.date, form.time, tz);
      return form.event
        ? unwrap(api.POST('/api/v1/properties/{propertyId}/attendance/{id}/correct', { params: { path: { ...pid(), id: form.event.id } }, body: { at, kind: form.kind, reason: reason.trim() } }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/attendance/manual', { params: { path: pid() }, body: { userId, kind: form.kind, at, reason: reason.trim() } }));
    },
    onSuccess: () => {
      toast.info(form.event ? 'Отметка исправлена' : 'Отметка добавлена', 'Прежняя запись сохранена в журнале.');
      void invalidate('attendance');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  return (
    <Dialog open={!!edit} onClose={onClose} title={`${form.event ? 'Исправить отметку' : 'Добавить отметку'} · ${name}`}>
      <div className="stack">
        <Field label="Что">
          <Choices
            label="Что"
            value={form.kind}
            onChange={(kind) => setForm((f) => ({ ...f, kind }))}
            options={[
              ['in', 'Приход'],
              ['out', 'Уход'],
            ]}
          />
        </Field>
        <div className="grid-2">
          <Field label="Дата" htmlFor="m-date">
            <input id="m-date" type="date" className="input" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </Field>
          <Field label="Время" htmlFor="m-time">
            <input id="m-time" type="time" className="input" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} />
          </Field>
        </div>
        <Field label="Причина" htmlFor="m-reason">
          <input id="m-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Например: забыл отметить уход" />
        </Field>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!form.date || !form.time || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
          Сохранить
        </button>
      </div>
    </Dialog>
  );
}
