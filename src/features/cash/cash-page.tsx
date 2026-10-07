import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useCash, useDirectory, useInvalidate, usePayments, usePropertyInfo, type S } from '@/api/hooks';
import { useCan, useProperty, useSession } from '@/auth/session';
import { Empty, Field, Loading, Money } from '@/components/ui/bits';
import { Dialog, Modal } from '@/components/ui/overlay';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { useOpenBooking } from '@/features/bookings/open';
import { amount as fmtAmount, currencySign, dateTime, parseMoney, time } from '@/lib/format';
import { PAYMENT_KIND, PAYMENT_METHOD } from '@/lib/labels';
import './cash.css';

type Shift = S['Shift'];
type Report = S['CashReport'];
type Payment = S['Payment'];

/**
 * Касса. Смена открывается после отметки прихода и принимает остаток
 * прошлой; закрывается Z-отчётом: администратор пересчитывает наличные,
 * расхождение - только с комментарием, и передаёт смену следующему. После
 * Z-отчёта смену не меняет никто.
 */
export function CashPage() {
  const [tab, setTab] = useState<'shift' | 'history'>('shift');
  const can = useCan();
  return (
    <div className="page cash">
      <div className="page-head">
        <div>
          <h1 className="page-title">Касса</h1>
        </div>
      </div>
      <div className="tabs page-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'shift'} onClick={() => setTab('shift')}>
          Текущая смена
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          {can('cash.reports') ? 'История смен' : 'Мои смены'}
        </button>
      </div>
      {tab === 'shift' ? <CurrentShift /> : <History />}
    </div>
  );
}

function CurrentShift() {
  const cash = useCash();
  const can = useCan();
  const property = useProperty();
  const [dialog, setDialog] = useState<'withdrawal' | 'deposit' | 'close' | null>(null);
  const [report, setReport] = useState<string | null>(null);
  if (cash.isPending) return <Loading />;
  if (cash.isError || !cash.data) return <Empty title="Касса не загрузилась">Обновите страницу.</Empty>;
  const { shift, report: x, previous, clockedIn, fiscalTest } = cash.data;
  const cur = property.currency;

  if (!shift) {
    return (
      <>
        <OpenShift previous={previous} clockedIn={clockedIn} canOpen={can('cash.shift')} />
        {previous ? (
          <p className="cash-prev">
            <button type="button" className="btn-quiet" onClick={() => setReport(previous.id)}>
              Z-отчёт смены {previous.number}
            </button>
          </p>
        ) : null}
        <ReportModal shiftId={report} onClose={() => setReport(null)} />
      </>
    );
  }

  return (
    <>
      <div className="shift-head">
        <div>
          <div className="shift-title">
            Смена {shift.number} · {shift.registerName}
          </div>
          <div className="muted">
            открыта {dateTime(shift.openedAt, property.timezone)} · {shift.openedBy.name}
            {fiscalTest ? ' · касса в тестовом режиме: чеки «TEST»' : ''}
          </div>
        </div>
        {can('cash.shift') ? (
          <div className="row">
            <button type="button" className="btn btn-ghost" onClick={() => setDialog('deposit')}>
              Внесение
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setDialog('withdrawal')}>
              Выемка
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setReport(shift.id)}>
              X-отчёт
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setDialog('close')}>
              Закрыть смену
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost" onClick={() => setReport(shift.id)}>
            X-отчёт
          </button>
        )}
      </div>

      {x ? (
        <div className="figures cash-figures">
          <div className="figure">
            <span className="v">
              <Money value={x.expectedCash} currency={cur} />
            </span>
            <span className="l">наличными в кассе сейчас</span>
          </div>
          {x.byMethod
            .filter((l) => l.count > 0)
            .map((l) => (
              <div key={l.key} className="figure">
                <span className="v">
                  <Money value={l.amount} currency={cur} />
                </span>
                <span className="l">
                  {l.label.toLowerCase()}, {l.count}
                </span>
              </div>
            ))}
          {x.refunds.count ? (
            <div className="figure">
              <span className="v">
                <Money value={x.refunds.amount} currency={cur} />
              </span>
              <span className="l">возвраты, {x.refunds.count}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      <ShiftPayments shift={shift} />

      <MovementDialog kind={dialog === 'withdrawal' || dialog === 'deposit' ? dialog : null} shift={shift} expected={x?.expectedCash ?? 0} onClose={() => setDialog(null)} />
      <CloseDialog open={dialog === 'close'} shift={shift} expected={x?.expectedCash ?? 0} onClose={() => setDialog(null)} onClosed={(id) => setReport(id)} />
      <ReportModal shiftId={report} onClose={() => setReport(null)} />
    </>
  );
}

function OpenShift({ previous, clockedIn, canOpen }: { previous: Shift | null; clockedIn: boolean; canOpen: boolean }) {
  const property = useProperty();
  const invalidate = useInvalidate();
  const [opening, setOpening] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setOpening(previous?.countedCash != null ? fmtAmount(previous.countedCash) : ''), [previous?.id, previous?.countedCash]);
  const clock = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/attendance/clock', { params: { path: pid() }, body: { kind: 'in' } })),
    onSuccess: () => {
      toast.info('Приход отмечен');
      void invalidate('cash', 'attendance', 'dashboard');
    },
    onError: toast.fail,
  });
  const open = useMutation({
    mutationFn: () => {
      const v = parseMoney(opening);
      return unwrap(api.POST('/api/v1/properties/{propertyId}/cash/shifts', { params: { path: pid() }, body: v != null ? { openingCash: v } : {} }));
    },
    onSuccess: (s) => {
      toast.info(`Смена ${s.number} открыта`, previous ? `Смена ${previous.number} принята` : undefined);
      void invalidate('cash', 'dashboard');
    },
    onError: (e) => (isApiError(e) ? setError(e.detail ? `${e.message}. ${e.detail}` : e.message) : toast.fail(e)),
  });
  const cur = property.currency;
  const differs = previous?.countedCash != null && parseMoney(opening) != null && parseMoney(opening) !== previous.countedCash;
  return (
    <section className="open-shift">
      <h2 className="section-title">Смена закрыта</h2>
      {previous ? (
        <p>
          Последняя - смена {previous.number}, закрыта {previous.closedAt ? dateTime(previous.closedAt, property.timezone) : ''} · {previous.closedBy}. В кассе{' '}
          <Money value={previous.countedCash ?? 0} currency={cur} />
          {previous.handedOverTo ? `, передана: ${previous.handedOverTo}` : ''}.
        </p>
      ) : (
        <p className="muted">Смен ещё не было.</p>
      )}
      {!canOpen ? null : !clockedIn ? (
        <div className="note row-between">
          <span>Смену открывают после отметки прихода.</span>
          <button type="button" className="btn btn-primary btn-sm" disabled={clock.isPending} onClick={() => clock.mutate()}>
            Отметить приход
          </button>
        </div>
      ) : (
        <div className="open-form">
          <Field
            label="Наличных в кассе сейчас"
            htmlFor="open-cash"
            hint={differs ? 'Не сходится с Z-отчётом прошлой смены - это попадёт в журнал' : previous ? 'Пересчитайте и проверьте: так вы принимаете смену' : undefined}
          >
            <div className="input-affix">
              <input id="open-cash" className="input num" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
              <span className="affix">{currencySign(cur)}</span>
            </div>
          </Field>
          {error ? <p className="field-error">{error}</p> : null}
          <button type="button" className="btn btn-primary" disabled={open.isPending} onClick={() => open.mutate()}>
            {previous ? 'Принять и открыть смену' : 'Открыть смену'}
          </button>
        </div>
      )}
    </section>
  );
}

function ShiftPayments({ shift }: { shift: Shift }) {
  const property = useProperty();
  const can = useCan();
  const list = usePayments({ shiftId: shift.id });
  const openBooking = useOpenBooking();
  const invalidate = useInvalidate();
  const info = usePropertyInfo();
  const [storno, setStorno] = useState<Payment | null>(null);
  const reasons = info.data?.settings.stornoReasons ?? [];
  const doStorno = useMutation({
    mutationFn: ({ p, reason }: { p: Payment; reason: string }) =>
      unwrap(api.POST('/api/v1/properties/{propertyId}/payments/{id}/storno', { params: { path: { ...pid(), id: p.id } }, headers: idem(), body: { reason } })),
    onSuccess: () => {
      toast.info('Сторно проведено');
      setStorno(null);
      void invalidate('cash', 'folio', 'booking', 'bookings', 'dashboard');
    },
    onError: toast.fail,
  });
  const cur = property.currency;
  if (list.isPending) return <Loading />;
  const rows = list.data ?? [];
  return (
    <section className="section">
      <h2 className="section-title">Документы смены {rows.length ? <span className="aside">{rows.length}</span> : null}</h2>
      {!rows.length ? (
        <p className="muted">В этой смене оплат ещё не было.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Время</th>
                <th>Что</th>
                <th>Бронь, гость</th>
                <th>Способ</th>
                <th className="r">Сумма</th>
                <th>Чек</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} data-reversed={!!p.reversedBy || undefined}>
                  <td className="num">{p.number}</td>
                  <td className="num">{time(p.createdAt, property.timezone)}</td>
                  <td>
                    {p.stornoOf ? <span className="danger">сторно</span> : PAYMENT_KIND[p.kind]}
                    {p.stornoReason ? <span className="sub">{p.stornoReason}</span> : p.reversedBy ? <span className="sub">сторнирован</span> : null}
                  </td>
                  <td>
                    {p.bookingId ? (
                      <button type="button" className="link-btn" onClick={() => openBooking(p.bookingId!)}>
                        Бронь {p.bookingNumber}
                      </button>
                    ) : (
                      '-'
                    )}
                    {p.guestName ? <span className="sub">{p.companyName ?? p.guestName}</span> : null}
                  </td>
                  <td>{PAYMENT_METHOD[p.method]}</td>
                  <td className="r">
                    <Money value={p.signedAmount} currency={cur} signed tone={p.signedAmount > 0 && p.kind === 'payment' && !p.stornoOf ? 'in' : undefined} />
                  </td>
                  <td className={p.fiscalStatus === 'failed' ? 'danger' : 'muted'}>
                    {p.fiscalStatus === 'printed' ? p.fiscalNumber : p.fiscalStatus === 'failed' ? 'не пробит' : p.fiscalStatus === 'pending' ? 'пробивается' : 'не нужен'}
                  </td>
                  <td className="r">
                    {!p.stornoOf && !p.reversedBy && can('payment.storno') ? (
                      <button type="button" className="btn-quiet" onClick={() => setStorno(p)}>
                        Сторно
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ReasonDialog
        open={!!storno}
        onClose={() => setStorno(null)}
        title={storno ? `Сторно документа ${storno.number}` : ''}
        text={storno ? `${PAYMENT_KIND[storno.kind]} ${fmtAmount(storno.amount)} ${currencySign(cur)}, ${PAYMENT_METHOD[storno.method]?.toLowerCase()}. Будет проведён обратный документ; исходный останется в истории.` : undefined}
        presets={reasons}
        confirmLabel="Провести сторно"
        danger
        busy={doStorno.isPending}
        onConfirm={(reason) => storno && doStorno.mutate({ p: storno, reason })}
      />
    </section>
  );
}

function MovementDialog({ kind, shift, expected, onClose }: { kind: 'withdrawal' | 'deposit' | null; shift: Shift; expected: number; onClose: () => void }) {
  const property = useProperty();
  const invalidate = useInvalidate();
  const [sum, setSum] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (kind) {
      setSum('');
      setReason('');
      setError(null);
    }
  }, [kind]);
  const value = parseMoney(sum);
  const save = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/cash/shifts/{id}/movements', { params: { path: { ...pid(), id: shift.id } }, headers: idem(), body: { kind: kind!, amount: value!, reason: reason.trim() } })),
    onSuccess: () => {
      toast.info(kind === 'withdrawal' ? 'Выемка проведена' : 'Внесение проведено');
      void invalidate('cash', 'dashboard');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  const cur = property.currency;
  return (
    <Dialog open={!!kind} onClose={onClose} title={kind === 'withdrawal' ? 'Выемка наличных' : 'Внесение наличных'}>
      <div className="stack">
        <Field label="Сумма" htmlFor="mv-sum" hint={kind === 'withdrawal' ? `В кассе ${fmtAmount(expected)} ${currencySign(cur)}` : undefined}>
          <div className="input-affix">
            <input id="mv-sum" className="input num" inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} data-autofocus />
            <span className="affix">{currencySign(cur)}</span>
          </div>
        </Field>
        <Field label={kind === 'withdrawal' ? 'Кому сдано' : 'Откуда'} htmlFor="mv-reason">
          <input id="mv-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'withdrawal' ? 'Например: выручка сдана бухгалтеру' : 'Например: размен из сейфа'} />
        </Field>
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!value || value <= 0 || !reason.trim() || save.isPending} onClick={() => save.mutate()}>
          {kind === 'withdrawal' ? 'Провести выемку' : 'Провести внесение'}
        </button>
      </div>
    </Dialog>
  );
}

function CloseDialog({ open, shift, expected, onClose, onClosed }: { open: boolean; shift: Shift; expected: number; onClose: () => void; onClosed: (id: string) => void }) {
  const property = useProperty();
  const session = useSession();
  const invalidate = useInvalidate();
  const directory = useDirectory(open);
  const [counted, setCounted] = useState('');
  const [comment, setComment] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setCounted('');
      setComment('');
      setTo('');
      setError(null);
    }
  }, [open]);
  const value = parseMoney(counted);
  const diff = value != null ? value - expected : 0;
  const close = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/cash/shifts/{id}/close', {
          params: { path: { ...pid(), id: shift.id } },
          body: { countedCash: value!, discrepancyComment: comment.trim() || null, handedOverTo: to || null },
        }),
      ),
    onSuccess: () => {
      toast.info(`Смена ${shift.number} закрыта`, 'Z-отчёт сохранён и больше не меняется.');
      void invalidate('cash', 'dashboard');
      onClose();
      onClosed(shift.id);
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  const cur = property.currency;
  const people = (directory.data ?? []).filter((p) => p.id !== session.me?.id);
  return (
    <Dialog open={open} onClose={onClose} title={`Закрыть смену ${shift.number}`} wide>
      <div className="stack">
        <p>
          По документам в кассе должно быть <Money value={expected} currency={cur} />. Пересчитайте наличные и введите, сколько есть на самом деле.
        </p>
        <div className="grid-2">
          <Field label="Пересчитано" htmlFor="z-counted">
            <div className="input-affix">
              <input id="z-counted" className="input num" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} data-autofocus />
              <span className="affix">{currencySign(cur)}</span>
            </div>
          </Field>
          <Field label="Передаю смену" htmlFor="z-to" optional>
            <select id="z-to" className="select" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Выберите, кто примет</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName}
                  {p.position ? ` · ${p.position}` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {value != null && diff !== 0 ? (
          <Field label={diff < 0 ? `Недостача ${fmtAmount(-diff)} ${currencySign(cur)}: что случилось` : `Излишек ${fmtAmount(diff)} ${currencySign(cur)}: что случилось`} htmlFor="z-comment" error={!comment.trim() ? 'Без комментария смену с расхождением не закрыть' : undefined}>
            <textarea id="z-comment" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={value == null || (diff !== 0 && !comment.trim()) || close.isPending} onClick={() => close.mutate()}>
          Закрыть смену, Z-отчёт
        </button>
      </div>
    </Dialog>
  );
}

/** X- или Z-отчёт смены: печатается как есть, с местами для подписей. */
function ReportModal({ shiftId, onClose }: { shiftId: string | null; onClose: () => void }) {
  const property = useProperty();
  const q = useQuery({
    queryKey: ['cash', property.id, 'report', shiftId],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/cash/shifts/{id}/report', { params: { path: { ...pid(), id: shiftId! } } })),
    enabled: !!shiftId,
  });
  const data = q.data;
  return (
    <Modal
      open={!!shiftId}
      onClose={onClose}
      title={data ? `${data.kind === 'z' ? 'Z-отчёт' : 'X-отчёт'} · смена ${data.shift.number}` : 'Отчёт смены'}
      footer={
        data ? (
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Печать
          </button>
        ) : undefined
      }
    >
      {q.isPending ? <Loading /> : data ? <ReportSheet kind={data.kind} shift={data.shift} report={data.report} /> : <Empty title="Отчёт не загрузился" />}
    </Modal>
  );
}

function ReportSheet({ kind, shift, report }: { kind: 'x' | 'z'; shift: Shift; report: Report }) {
  const property = useProperty();
  const cur = report.currency || property.currency;
  const tz = property.timezone;
  const line = (l: { label: string; amount: number; count: number }, key?: string) => (
    <tr key={key ?? l.label}>
      <td>{l.label}</td>
      <td className="r num">{l.count || ''}</td>
      <td className="r">
        <Money value={l.amount} currency={cur} />
      </td>
    </tr>
  );
  return (
    <div className="print-sheet report">
      <div className="report-head">
        <strong>
          {property.name} · {kind === 'z' ? 'Z-отчёт' : 'X-отчёт'} · смена {shift.number}
        </strong>
        <div>
          Открыта {dateTime(shift.openedAt, tz)} · {report.openedBy}
        </div>
        {kind === 'z' && shift.closedAt ? (
          <div>
            Закрыта {dateTime(shift.closedAt, tz)} · {report.closedBy}
          </div>
        ) : (
          <div className="muted">Промежуточный: смена ещё открыта</div>
        )}
      </div>
      <table className="table report-table">
        <tbody>
          <tr className="report-group">
            <th colSpan={3}>По способам оплаты</th>
          </tr>
          {report.byMethod.map((l) => line(l, `m-${l.key}`))}
          <tr className="report-group">
            <th colSpan={3}>По типу оплаты брони</th>
          </tr>
          {report.byPaymentType.map((l) => line(l, `t-${l.key}`))}
          <tr className="report-group">
            <th colSpan={3}>Движения</th>
          </tr>
          {line(report.refunds, 'refunds')}
          {line(report.stornos, 'stornos')}
          {line(report.deposits, 'deposits')}
          {line(report.withdrawals, 'withdrawals')}
          {line(report.cashDeposits, 'cashDeposits')}
          <tr className="report-group">
            <th colSpan={3}>Наличные</th>
          </tr>
          <tr>
            <td>Остаток на начало</td>
            <td />
            <td className="r">
              <Money value={report.openingCash} currency={cur} />
            </td>
          </tr>
          <tr>
            <td>Приход наличными</td>
            <td />
            <td className="r">
              <Money value={report.cashIn} currency={cur} />
            </td>
          </tr>
          <tr>
            <td>Расход наличными</td>
            <td />
            <td className="r">
              <Money value={report.cashOut} currency={cur} />
            </td>
          </tr>
          <tr className="strong">
            <td>Должно быть в кассе</td>
            <td />
            <td className="r">
              <Money value={report.expectedCash} currency={cur} />
            </td>
          </tr>
          {kind === 'z' ? (
            <>
              <tr className="strong">
                <td>Пересчитано</td>
                <td />
                <td className="r">
                  <Money value={report.countedCash} currency={cur} />
                </td>
              </tr>
              <tr className={report.discrepancy ? 'danger' : undefined}>
                <td>Расхождение{report.discrepancyComment ? `: ${report.discrepancyComment}` : ''}</td>
                <td />
                <td className="r">{report.discrepancy ? <Money value={report.discrepancy} currency={cur} signed /> : '0'}</td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
      {report.specialPrices.length ? (
        <>
          <h3 className="section-title">Спеццены</h3>
          <table className="table report-table">
            <tbody>
              {report.specialPrices.map((s) => (
                <tr key={s.bookingNumber}>
                  <td>
                    Бронь {s.bookingNumber} · {s.guest}
                    <span className="sub">
                      {s.basis}, утвердил {s.approvedBy}
                    </span>
                  </td>
                  <td className="r">
                    <Money value={s.discount} currency={cur} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
      {kind === 'z' ? (
        <div className="signatures">
          <div>Сдал: {report.closedBy} ____________</div>
          <div>Принял: {shift.acceptedBy ?? shift.handedOverTo ?? '________________'} ____________</div>
        </div>
      ) : null}
    </div>
  );
}

function History() {
  const property = useProperty();
  const [report, setReport] = useState<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['cash', property.id, 'shifts', 'pages'],
    queryFn: ({ pageParam }) => unwrap(api.GET('/api/v1/properties/{propertyId}/cash/shifts', { params: { path: pid(), query: { limit: 30, ...(pageParam ? { cursor: pageParam } : {}) } } })),
    initialPageParam: '' as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const cur = property.currency;
  const tz = property.timezone;
  if (list.isPending) return <Loading />;
  if (!rows.length) return <Empty title="Смен ещё не было" />;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Смена</th>
              <th>Открыта</th>
              <th>Закрыта</th>
              <th className="r">Документов</th>
              <th className="r">Пересчитано</th>
              <th className="r">Расхождение</th>
              <th>Передана</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} data-clickable onClick={() => setReport(s.id)}>
                <td className="num">{s.number}</td>
                <td>
                  {dateTime(s.openedAt, tz)}
                  <span className="sub">{s.openedBy.name}</span>
                </td>
                <td>{s.closedAt ? dateTime(s.closedAt, tz) : <strong>открыта</strong>}</td>
                <td className="r num">{s.paymentsCount}</td>
                <td className="r">{s.countedCash != null ? <Money value={s.countedCash} currency={cur} /> : '-'}</td>
                <td className={`r${s.discrepancy ? ' danger' : ''}`}>{s.discrepancy ? <Money value={s.discrepancy} currency={cur} signed /> : s.status === 'closed' ? '0' : '-'}</td>
                <td>
                  {s.acceptedBy ? s.acceptedBy : s.handedOverTo ? `${s.handedOverTo}, ещё не принял` : <span className="muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.hasNextPage ? (
        <div className="more">
          <button type="button" className="btn btn-ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            Показать ещё
          </button>
        </div>
      ) : null}
      <ReportModal shiftId={report} onClose={() => setReport(null)} />
    </>
  );
}
