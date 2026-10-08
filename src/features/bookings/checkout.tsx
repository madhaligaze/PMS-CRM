import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useFolio, useInvalidate, usePropertyInfo, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Field, Loading, Money } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';
import { addDays } from '@/lib/dates';
import { dayShort } from '@/lib/format';
import { PaymentDialog } from './folio';

type Booking = S['Booking'];

/**
 * Выселение по ТЗ: сверка счёта, доплата или возврат, чек; номер уходит в
 * «грязный» и в задачу горничной; визит пишется в историю гостя с оценкой.
 */
export function CheckOutFlow({ b, onDone }: { b: Booking; onDone: () => void }) {
  const can = useCan();
  const property = useProperty();
  const info = usePropertyInfo();
  const folio = useFolio(b.id);
  const invalidate = useInvalidate();
  const [pay, setPay] = useState<'payment' | 'refund' | 'deposit_return' | null>(null);
  const [rating, setRating] = useState<string>('');
  const [feedback, setFeedback] = useState('');
  const [debt, setDebt] = useState(false);
  const [debtReason, setDebtReason] = useState('');
  const today = info.data?.businessDate ?? b.departure;
  const cur = property.currency;

  const shorten = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/bookings/{id}', {
          params: { path: { ...pid(), id: b.id } },
          headers: ifMatch(b.version),
          body: { departure: today > b.arrival ? today : addDays(b.arrival, 1), reprice: 'keep' },
        }),
      ),
    onSuccess: () => {
      toast.info('Проживание сокращено', 'Счёт пересчитан: проверьте переплату.');
      void invalidate('booking', 'folio', 'tape', 'dashboard', 'bookings');
    },
    onError: toast.fail,
  });

  const extend = useMutation({
    mutationFn: () =>
      unwrap(api.PATCH('/api/v1/properties/{propertyId}/bookings/{id}', { params: { path: { ...pid(), id: b.id } }, headers: ifMatch(b.version), body: { departure: today, reprice: 'keep' } })),
    onSuccess: () => {
      toast.info('Проживание продлено до сегодня');
      void invalidate('booking', 'folio', 'tape', 'dashboard', 'bookings');
    },
    onError: toast.fail,
  });

  const checkOut = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/bookings/{id}/check-out', {
          params: { path: { ...pid(), id: b.id } },
          body: { rating: rating ? Number(rating) : null, feedback: feedback.trim() || null, allowDebt: debt, debtReason: debt ? debtReason.trim() : null },
        }),
      ),
    onSuccess: (nb) => {
      toast.info(`Выезд из номера ${nb.roomNumber}: ${nb.guest.fullName}`, `Номер ${nb.roomNumber} ушёл в уборку`);
      void invalidate('booking', 'bookings', 'tape', 'dashboard', 'hk', 'folio', 'guest');
      onDone();
    },
    onError: (e) => {
      if (isApiError(e)) toast.error(e.message, e.detail);
      else toast.fail(e);
    },
  });

  if (folio.isPending) return <Loading />;
  if (!folio.data) return null;
  const bal = folio.data.balance;
  const early = b.departure > today;
  const overstay = b.departure < today;
  const ready = !early && !overstay && bal.deposit === 0 && bal.due <= 0 && bal.due === 0;
  const canDebt = can('booking.checkout_debt') && bal.due > 0 && bal.deposit === 0 && !early && !overstay;

  return (
    <div className="stack checkout">
      {early ? (
        <div className="note">
          Выезд по брони - {dayShort(b.departure)}. Гость уезжает раньше: сначала сократите проживание, цена пересчитается, переплату вернёте здесь же.
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={shorten.isPending} onClick={() => shorten.mutate()}>
              Выезд сегодня, сократить проживание
            </button>
          </div>
        </div>
      ) : null}
      {overstay ? (
        <div className="alert">
          <strong>Гость живёт дольше брони</strong> (выезд был {dayShort(b.departure)}). Продлите проживание до сегодня.
          <div className="row" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" disabled={extend.isPending} onClick={() => extend.mutate()}>
              Продлить до сегодня
            </button>
          </div>
        </div>
      ) : null}

      <section className="section">
        <h3 className="section-title">Сверка счёта</h3>
        <dl className="folio-total big">
          <dt>Проживание и начисления</dt>
          <dd>
            <Money value={bal.charges} currency={cur} />
          </dd>
          <dt>Оплачено</dt>
          <dd>
            <Money value={bal.paid} currency={cur} tone={bal.paid ? 'in' : undefined} />
          </dd>
          {bal.deposit ? (
            <>
              <dt>Депозит на руках</dt>
              <dd>
                <Money value={bal.deposit} currency={cur} />
              </dd>
            </>
          ) : null}
          <dt className="strong">{bal.due > 0 ? 'Доплата' : bal.due < 0 ? 'Вернуть гостю' : 'Счёт закрыт'}</dt>
          <dd className="strong">{bal.due ? <Money value={Math.abs(bal.due)} currency={cur} tone={bal.due > 0 ? 'due' : undefined} /> : <span>0</span>}</dd>
        </dl>
        <div className="row" style={{ marginTop: 'var(--s-3)' }}>
          {bal.due > 0 && can('payment.accept') ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPay('payment')}>
              Принять доплату
            </button>
          ) : null}
          {bal.due < 0 && can('payment.refund') ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setPay('refund')}>
              Вернуть переплату
            </button>
          ) : null}
          {bal.deposit > 0 && can('payment.refund') ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPay('deposit_return')}>
              Вернуть депозит
            </button>
          ) : null}
        </div>
        {b.companyName && bal.due > 0 ? (
          <p className="field-hint" style={{ marginTop: 8 }}>
            Плательщик - {b.companyName}: доплату можно провести «По счёту компании».
          </p>
        ) : null}
      </section>

      <section className="section">
        <h3 className="section-title">
          Отзыв гостя <span className="aside">по желанию</span>
        </h3>
        <Field label="Оценка">
          <Choices
            label="Оценка"
            value={rating}
            onChange={setRating}
            options={[
              ['5', '5 отлично'],
              ['4', '4'],
              ['3', '3'],
              ['2', '2'],
              ['1', '1 плохо'],
            ]}
          />
        </Field>
        <div style={{ marginTop: 'var(--s-3)' }}>
          <Field label="Что сказал гость" htmlFor="co-fb" optional>
            <textarea id="co-fb" className="textarea" rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </Field>
        </div>
      </section>

      {canDebt ? (
        <section className="section">
          <label className="check">
            <input type="checkbox" checked={debt} onChange={(e) => setDebt(e.target.checked)} />
            <span>Выселить с долгом: оплатят позже (компания по счёту, договорённость с управляющим)</span>
          </label>
          {debt ? (
            <div style={{ marginTop: 'var(--s-3)' }}>
              <Field label="Кто и как закроет долг" htmlFor="co-debt">
                <input id="co-debt" className="input" value={debtReason} onChange={(e) => setDebtReason(e.target.value)} />
              </Field>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="row form-actions">
        <button
          type="button"
          className={`btn ${debt ? 'btn-danger' : 'btn-primary'}`}
          disabled={checkOut.isPending || (!ready && !(debt && debtReason.trim()))}
          onClick={() => checkOut.mutate()}
        >
          {checkOut.isPending ? 'Выселяем' : debt ? 'Выселить с долгом' : `Выселить, номер ${b.roomNumber} в уборку`}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone}>
          Вернуться к брони
        </button>
      </div>
      {!ready && !debt ? (
        <p className="field-hint">
          {early || overstay ? 'Сначала приведите даты в порядок.' : bal.deposit ? 'Верните депозит.' : bal.due > 0 ? 'Примите доплату.' : bal.due < 0 ? 'Верните переплату.' : ''}
        </p>
      ) : null}

      <PaymentDialog open={pay !== null} kind={pay ?? 'payment'} booking={b} balance={bal} onClose={() => setPay(null)} onDone={() => setPay(null)} />
    </div>
  );
}
