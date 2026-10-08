import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { useCash, useFolio, useInvalidate, usePropertyInfo, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Field, Loading, Money } from '@/components/ui/bits';
import { Dialog } from '@/components/ui/overlay';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { currencySign, amount as fmtAmount, dateTime, nights as nightsLabel, parseMoney } from '@/lib/format';
import { CHARGE_KIND, PAYMENT_KIND, PAYMENT_METHOD } from '@/lib/labels';

type Booking = S['Booking'];
type Kind = 'payment' | 'deposit' | 'refund' | 'deposit_return';
type Method = 'cash' | 'card' | 'qr' | 'transfer' | 'invoice';

export function FolioView({ b }: { b: Booking }) {
  const property = useProperty();
  const can = useCan();
  const folio = useFolio(b.id);
  const invalidate = useInvalidate();
  const [pay, setPay] = useState<Kind | null>(null);
  const [charge, setCharge] = useState(false);
  const [storno, setStorno] = useState<{ kind: 'payment' | 'charge'; id: string; label: string } | null>(null);
  const info = usePropertyInfo();
  const cur = property.currency;
  const tz = property.timezone;

  const doStorno = useMutation({
    mutationFn: ({ kind, id, reason }: { kind: 'payment' | 'charge'; id: string; reason: string }) =>
      kind === 'payment'
        ? unwrap(api.POST('/api/v1/properties/{propertyId}/payments/{id}/storno', { params: { path: { ...pid(), id } }, body: { reason } }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/charges/{id}/storno', { params: { path: { ...pid(), id } }, body: { reason } })),
    onSuccess: () => {
      toast.info('Сторно проведено', 'Исходный документ остался в счёте и журнале.');
      setStorno(null);
      void invalidate('folio', 'booking', 'bookings', 'cash', 'dashboard', 'tape');
    },
    onError: toast.fail,
  });

  if (folio.isPending) return <Loading />;
  if (!folio.data) return null;
  const f = folio.data;
  const closed = b.status === 'cancelled' || b.status === 'no_show' || b.status === 'checked_out';
  const canStornoPayment = can('payment.storno', 'payment.storno.closed');

  return (
    <div className="folio">
      <table className="table folio-table">
        <thead>
          <tr>
            <th>Начисления</th>
            <th className="r">Сумма</th>
            <th aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              Проживание, {nightsLabel(f.accommodation.nights)}
              {f.accommodation.discountTotal ? (
                <span className="sub">
                  {f.accommodation.priceMode === 'special' ? 'Спеццена' : 'Скидка'}: {f.accommodation.priceReason} · по тарифу {fmtAmount(f.accommodation.baseTotal)}
                </span>
              ) : null}
            </td>
            <td className="r">
              <Money value={f.accommodation.amount} currency={cur} />
            </td>
            <td />
          </tr>
          {f.meal.amount ? (
            <tr>
              <td>Завтраки</td>
              <td className="r">
                <Money value={f.meal.amount} currency={cur} />
              </td>
              <td />
            </tr>
          ) : null}
          {f.charges.map((c) => (
            <tr key={c.id} data-storno={!!c.stornoOf || !!c.reversedBy}>
              <td>
                {c.description}
                {c.quantity > 1 ? ` × ${c.quantity}` : ''}
                <span className="sub">
                  {CHARGE_KIND[c.kind]} · {dateTime(c.createdAt, tz)}
                  {c.createdBy ? ` · ${c.createdBy}` : ''}
                  {c.stornoReason ? ` · причина: ${c.stornoReason}` : ''}
                </span>
              </td>
              <td className="r">
                <Money value={c.amount} currency={cur} />
              </td>
              <td className="r">
                {!c.stornoOf && !c.reversedBy && can('folio.storno') ? (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setStorno({ kind: 'charge', id: c.id, label: c.description })}>
                    Сторно
                  </button>
                ) : c.reversedBy ? (
                  <span className="muted">сторнировано</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="table folio-table" style={{ marginTop: 'var(--s-6)' }}>
        <thead>
          <tr>
            <th>Оплаты</th>
            <th className="r">Сумма</th>
            <th aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          {f.payments.length ? (
            f.payments.map((p) => (
              <tr key={p.id} data-storno={!!p.stornoOf || !!p.reversedBy}>
                <td>
                  {p.stornoOf ? 'Сторно: ' : ''}
                  {PAYMENT_KIND[p.kind]} · {PAYMENT_METHOD[p.method]}
                  <span className="sub">
                    № {p.number} · смена {p.shiftNumber} · {dateTime(p.createdAt, tz)} · {p.createdBy}
                    {p.fiscalNumber ? ` · чек ${p.fiscalNumber}${p.fiscalTest ? ' (тестовая касса)' : ''}` : ''}
                    {p.fiscalStatus === 'failed' ? ' · чек не пробит' : ''}
                    {p.stornoReason ? ` · причина: ${p.stornoReason}` : ''}
                  </span>
                </td>
                <td className="r">
                  <Money value={p.signedAmount} currency={cur} tone={p.signedAmount > 0 && p.kind === 'payment' ? 'in' : undefined} />
                </td>
                <td className="r">
                  {!p.stornoOf && !p.reversedBy && canStornoPayment ? (
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setStorno({ kind: 'payment', id: p.id, label: `${PAYMENT_KIND[p.kind]} № ${p.number}` })}>
                      Сторно
                    </button>
                  ) : p.reversedBy ? (
                    <span className="muted">сторнировано</span>
                  ) : null}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3} className="muted">
                Оплат пока нет
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <dl className="folio-total">
        <dt>Начислено</dt>
        <dd>
          <Money value={f.balance.charges} currency={cur} />
        </dd>
        <dt>Оплачено</dt>
        <dd>
          <Money value={f.balance.paid} currency={cur} />
        </dd>
        {f.balance.deposit ? (
          <>
            <dt>Депозит на руках</dt>
            <dd>
              <Money value={f.balance.deposit} currency={cur} />
            </dd>
          </>
        ) : null}
        <dt className="strong">{f.balance.due >= 0 ? 'К оплате' : 'Переплата'}</dt>
        <dd className="strong">
          <Money value={Math.abs(f.balance.due)} currency={cur} tone={f.balance.due > 0 ? 'due' : undefined} />
        </dd>
      </dl>

      {!closed || f.balance.due !== 0 || f.balance.deposit ? (
        <div className="row folio-actions">
          {can('payment.accept') && f.balance.due > 0 ? (
            <button type="button" className="btn btn-primary" onClick={() => setPay('payment')}>
              Принять оплату
            </button>
          ) : null}
          {can('payment.accept') && b.status !== 'checked_out' && f.balance.due <= 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setPay('payment')}>
              Принять оплату
            </button>
          ) : null}
          {can('folio.charge') && !closed ? (
            <button type="button" className="btn btn-ghost" onClick={() => setCharge(true)}>
              Начисление
            </button>
          ) : null}
          {can('payment.accept') && b.status === 'checked_in' ? (
            <button type="button" className="btn btn-ghost" onClick={() => setPay('deposit')}>
              Депозит
            </button>
          ) : null}
          {can('payment.refund') && f.balance.deposit > 0 ? (
            <button type="button" className="btn btn-ghost" onClick={() => setPay('deposit_return')}>
              Вернуть депозит
            </button>
          ) : null}
          {can('payment.refund') && f.balance.paid > 0 ? (
            <button type="button" className={`btn ${f.balance.due < 0 ? 'btn-primary' : 'btn-quiet'}`} onClick={() => setPay('refund')}>
              {f.balance.due < 0 ? 'Вернуть переплату' : 'Возврат'}
            </button>
          ) : null}
        </div>
      ) : null}

      <PaymentDialog
        open={pay !== null}
        kind={pay ?? 'payment'}
        booking={b}
        balance={f.balance}
        onClose={() => setPay(null)}
        onDone={() => setPay(null)}
      />
      <ChargeDialog open={charge} booking={b} onClose={() => setCharge(false)} />
      <ReasonDialog
        open={storno !== null}
        onClose={() => setStorno(null)}
        title={`Сторно: ${storno?.label ?? ''}`}
        text="Документ не удаляется: появится обратная запись с причиной, а исходный останется в счёте и журнале. После Z-отчёта сторно делает только управляющий."
        presets={info.data?.settings.stornoReasons ?? []}
        confirmLabel="Провести сторно"
        danger
        busy={doStorno.isPending}
        onConfirm={(reason) => storno && doStorno.mutate({ kind: storno.kind, id: storno.id, reason })}
      />
    </div>
  );
}

/**
 * Приём оплаты, возврата, депозита. Без открытой кассовой смены провести
 * нельзя: диалог скажет об этом сразу, а не после нажатия.
 */
export function PaymentDialog({
  open,
  kind: initialKind,
  booking,
  balance,
  onClose,
  onDone,
}: {
  open: boolean;
  kind: Kind;
  booking: Booking;
  balance: S['Balance'];
  onClose: () => void;
  onDone: () => void;
}) {
  const property = useProperty();
  const can = useCan();
  const cash = useCash(open && can('cash.view'));
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [method, setMethod] = useState<Method>('cash');
  const [sum, setSum] = useState('');
  const [comment, setComment] = useState('');

  const suggested = (k: Kind) =>
    k === 'payment' ? Math.max(0, balance.due) : k === 'refund' ? Math.max(0, -balance.due) : k === 'deposit_return' ? balance.deposit : 0;

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    const s = suggested(initialKind);
    setSum(s ? fmtAmount(s).replace(/\s/g, ' ') : '');
    setMethod(booking.paymentType === 'cashless' ? 'card' : 'cash');
    setComment('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKind]);

  const value = parseMoney(sum);
  const mutation = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/payments', {
          params: { path: pid() },
          headers: idem(),
          body: {
            bookingId: booking.id,
            kind,
            method,
            amount: value!,
            ...(method === 'invoice' ? { payer: 'company' as const } : {}),
            comment: comment.trim() || null,
          },
        }),
      ),
    onSuccess: (p) => {
      const done: Record<string, string> = { payment: 'Оплата № N проведена', refund: 'Возврат № N проведён', deposit: 'Депозит № N принят', deposit_return: 'Депозит возвращён, документ № N' };
      toast.info((done[p.kind] ?? 'Документ № N проведён').replace('N', String(p.number)), p.fiscalNumber ? `Чек ${p.fiscalNumber}${p.fiscalTest ? ', тестовая касса' : ''}` : undefined);
      void invalidate('folio', 'booking', 'bookings', 'cash', 'dashboard', 'tape', 'readiness');
      onDone();
    },
    onError: toast.fail,
  });

  const shiftOpen = !!cash.data?.shift;
  const kinds: [Kind, string][] = [
    ...(can('payment.accept') ? ([['payment', 'Оплата']] as [Kind, string][]) : []),
    ...(can('payment.accept') && booking.status === 'checked_in' ? ([['deposit', 'Депозит']] as [Kind, string][]) : []),
    ...(can('payment.refund') && balance.paid > 0 ? ([['refund', 'Возврат']] as [Kind, string][]) : []),
    ...(can('payment.refund') && balance.deposit > 0 ? ([['deposit_return', 'Вернуть депозит']] as [Kind, string][]) : []),
  ];
  const methods: [Method, string][] = [
    ['cash', 'Наличные'],
    ['card', 'Карта'],
    ['qr', 'QR / перевод'],
    ['transfer', 'Перевод'],
    ...(booking.companyId && kind === 'payment' ? ([['invoice', 'По счёту компании']] as [Method, string][]) : []),
  ];

  return (
    <Dialog open={open} onClose={onClose} title={`${PAYMENT_KIND[kind]} по брони ${booking.number}`} wide>
      {!shiftOpen && cash.isSuccess ? (
        <div className="alert" style={{ marginBottom: 'var(--s-4)' }}>
          <strong>Кассовая смена закрыта.</strong> Без открытой смены принять оплату нельзя. <Link to="/cash">Открыть смену</Link>
        </div>
      ) : null}
      <div className="stack">
        {kinds.length > 1 ? (
          <Field label="Что проводим">
            <Choices
              label="Вид документа"
              value={kind}
              onChange={(k) => {
                setKind(k);
                const s = suggested(k);
                setSum(s ? fmtAmount(s) : '');
              }}
              options={kinds}
            />
          </Field>
        ) : null}
        <Field label="Способ">
          <Choices label="Способ" value={method} onChange={setMethod} options={methods} />
        </Field>
        <div className="grid-2">
          <Field label="Сумма" htmlFor="pay-sum" hint={kind === 'payment' && balance.due > 0 ? `К оплате ${fmtAmount(balance.due)}` : undefined}>
            <div className="input-affix">
              <input id="pay-sum" className="input num" inputMode="decimal" value={sum} onChange={(e) => setSum(e.target.value)} data-autofocus />
              <span className="affix">{currencySign(property.currency)}</span>
            </div>
          </Field>
          <Field label="Комментарий" htmlFor="pay-comment" optional>
            <input id="pay-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </div>
        {method !== 'invoice' ? (
          <p className="field-hint">Наличные, карта и QR пробиваются фискальным чеком автоматически.</p>
        ) : (
          <p className="field-hint">Безнал по счёту: чек не пробивается, компании выставляется счёт на оплату.</p>
        )}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!value || value <= 0 || mutation.isPending || (cash.isSuccess && !shiftOpen)}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Проводим' : value ? `Провести ${fmtAmount(value)} ${currencySign(property.currency)}` : 'Провести'}
        </button>
      </div>
    </Dialog>
  );
}

function ChargeDialog({ open, booking, onClose }: { open: boolean; booking: Booking; onClose: () => void }) {
  const property = useProperty();
  const invalidate = useInvalidate();
  const [kind, setKind] = useState<'minibar' | 'restaurant' | 'laundry' | 'transfer' | 'damage' | 'service' | 'other'>('minibar');
  const [description, setDescription] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  useEffect(() => {
    if (open) {
      setDescription('');
      setQty('1');
      setPrice('');
    }
  }, [open]);
  const unit = parseMoney(price);
  const q = Math.max(1, Number(qty) || 1);
  const m = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/bookings/{id}/charges', {
          params: { path: { ...pid(), id: booking.id } },
          headers: idem(),
          body: { kind, description: description.trim() || null, quantity: q, unitAmount: unit! },
        }),
      ),
    onSuccess: () => {
      toast.info('Начисление добавлено в счёт');
      void invalidate('folio', 'booking', 'bookings', 'dashboard', 'tape');
      onClose();
    },
    onError: toast.fail,
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Начисление на номер ${booking.roomNumber}`} wide>
      <div className="stack">
        <Field label="Что">
          <Choices
            label="Вид начисления"
            value={kind}
            onChange={setKind}
            options={(['minibar', 'restaurant', 'laundry', 'transfer', 'damage', 'service', 'other'] as const).map((k) => [k, CHARGE_KIND[k]!])}
          />
        </Field>
        <Field label="Описание" htmlFor="ch-desc" optional>
          <input id="ch-desc" className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={CHARGE_KIND[kind]} />
        </Field>
        <div className="grid-2">
          <Field label="Цена" htmlFor="ch-price">
            <div className="input-affix">
              <input id="ch-price" className="input num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
              <span className="affix">{currencySign(property.currency)}</span>
            </div>
          </Field>
          <Field label="Количество" htmlFor="ch-qty">
            <input id="ch-qty" className="input num" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!unit || m.isPending} onClick={() => m.mutate()}>
          {unit ? `Начислить ${fmtAmount(unit * q)} ${currencySign(property.currency)}` : 'Начислить'}
        </button>
      </div>
    </Dialog>
  );
}
