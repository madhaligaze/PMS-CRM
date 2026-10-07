import { useMutation } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { useBooking, useInvalidate, usePropertyInfo, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Empty, Loading, Money, Status } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { dash, dateTime, phone, plural, stayRange } from '@/lib/format';
import { BOOKING_SOURCE, HK_STATUS, MEAL, PAYMENT_TYPE } from '@/lib/labels';
import { BookingEdit } from './booking-edit';
import { CheckInFlow } from './checkin';
import { CheckOutFlow } from './checkout';
import { FolioView } from './folio';
import { History } from './history';
import { useOpenBooking } from './open';
import './bookings.css';

type Booking = S['Booking'];
type Mode = 'view' | 'edit' | 'checkin' | 'checkout';
type Tab = 'info' | 'folio' | 'history';

/** Карточка брони поверх любой страницы: открывается по ?booking=<id>. */
export function BookingCard() {
  const search = useSearch({ strict: false }) as { booking?: string };
  const id = search.booking ?? null;
  const openBooking = useOpenBooking();
  const q = useBooking(id);
  const [mode, setMode] = useState<Mode>('view');
  const [tab, setTab] = useState<Tab>('info');
  const b = q.data;

  useEffect(() => {
    setMode('view');
    setTab('info');
  }, [id]);

  const close = () => openBooking(undefined);
  const title = b ? (
    <>
      {b.guest.fullName}
      {b.guest.isVip ? <span className="tag tag-strong title-tag">VIP</span> : null}
    </>
  ) : (
    'Бронь'
  );
  const subtitle = b ? `Бронь ${b.number} · номер ${b.roomNumber}, ${b.roomTypeName} · ${stayRange(b.arrival, b.departure, true)}` : undefined;

  return (
    <Modal
      open={!!id}
      onClose={close}
      title={title}
      label={b ? `Бронь ${b.number}` : 'Бронь'}
      subtitle={subtitle}
      aside={b ? <Status value={b.status} /> : undefined}
      wide
      tall
      footer={b && mode === 'view' ? <Actions b={b} onMode={setMode} /> : undefined}
    >
      {q.isPending ? (
        <Loading />
      ) : q.isError || !b ? (
        <Empty title="Бронь не найдена">Возможно, ссылка устарела.</Empty>
      ) : mode === 'edit' ? (
        <BookingEdit b={b} onDone={() => setMode('view')} />
      ) : mode === 'checkin' ? (
        <CheckInFlow b={b} onDone={() => setMode('view')} />
      ) : mode === 'checkout' ? (
        <CheckOutFlow b={b} onDone={() => setMode('view')} />
      ) : (
        <>
          <div className="tabs card-tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === 'info'} onClick={() => setTab('info')}>
              Бронь
            </button>
            {b.balance ? (
              <button type="button" role="tab" className="tab" aria-selected={tab === 'folio'} onClick={() => setTab('folio')}>
                Счёт
                {b.balance.due ? <span className="count">{b.balance.due > 0 ? 'к оплате' : 'переплата'}</span> : null}
              </button>
            ) : null}
            <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
              История
            </button>
          </div>
          {tab === 'info' ? <BookingInfo b={b} /> : tab === 'folio' ? <FolioView b={b} /> : <History entityType="booking" entityId={b.id} />}
        </>
      )}
    </Modal>
  );
}

function BookingInfo({ b }: { b: Booking }) {
  const property = useProperty();
  const info = usePropertyInfo();
  const can = useCan();
  const tz = property.timezone;
  const cur = property.currency;
  return (
    <div className="stack">
      {b.guest.blacklisted ? (
        <div className="alert">
          <strong>Гость в чёрном списке.</strong> {b.guest.blacklistReason}
        </div>
      ) : null}
      {b.flags.prepaymentOverdue ? (
        <div className="alert">
          <strong>Предоплата не внесена в срок.</strong> Без оплаты или подтверждения бронь снимется автоматически.
        </div>
      ) : null}
      {b.flags.roomNotReady ? (
        <div className="alert">
          <strong>Номер {b.roomNumber} не готов к заезду:</strong> {HK_STATUS[b.roomHkStatus]?.toLowerCase()}. Продать можно только проверенный номер.
        </div>
      ) : null}
      {b.flags.departureToday && b.balance && b.balance.due > 0 ? (
        <div className="alert">
          <strong>Выезд сегодня, к оплате</strong> <Money value={b.balance.due} currency={cur} />
        </div>
      ) : null}

      <dl className="facts">
        <dt>Гость</dt>
        <dd>
          {can('guest.view') ? (
            <Link to="/guests/$guestId" params={{ guestId: b.guest.id }} className="link">
              {b.guest.fullName}
            </Link>
          ) : (
            b.guest.fullName
          )}
          <span className="muted"> · {phone(b.guest.phone)}</span>
        </dd>
        <dt>Проживание</dt>
        <dd>
          {stayRange(b.arrival, b.departure, true)}
          {info.data ? (
            <span className="muted">
              {' '}
              · заезд с {info.data.checkInTime}, выезд до {info.data.checkOutTime}
            </span>
          ) : null}
        </dd>
        <dt>Номер</dt>
        <dd>
          {b.roomNumber}, {b.roomTypeName}
          <span className="muted"> · {HK_STATUS[b.roomHkStatus]?.toLowerCase()}</span>
        </dd>
        <dt>Гостей</dt>
        <dd>
          {b.adults} {plural(b.adults, 'взрослый', 'взрослых', 'взрослых')}
          {b.children ? `, ${b.children} ${plural(b.children, 'ребёнок', 'ребёнка', 'детей')}` : ''}
        </dd>
        <dt>Тариф</dt>
        <dd>
          {b.ratePlanName} · {MEAL[b.meal]}
        </dd>
        {can('folio.view') ? (
          <>
            <dt>Стоимость</dt>
            <dd>
              <Money value={b.accommodationTotal + b.mealTotal} currency={cur} />
              {b.priceMode === 'discount' ? (
                <span className="muted">
                  {' '}
                  · скидка {b.discountPercent}%, <Money value={b.discountTotal} currency={cur} /> · {b.priceReason}
                </span>
              ) : null}
              {b.priceMode === 'special' ? (
                <span className="muted">
                  {' '}
                  · спеццена: {b.priceReason}, утвердил {b.priceApprovedBy?.name ?? '-'}
                </span>
              ) : null}
            </dd>
          </>
        ) : null}
        <dt>Тип оплаты</dt>
        <dd>{PAYMENT_TYPE[b.paymentType]}</dd>
        {b.companyName ? (
          <>
            <dt>Плательщик</dt>
            <dd>{b.companyName}</dd>
          </>
        ) : null}
        {b.groupName ? (
          <>
            <dt>Группа</dt>
            <dd>{b.groupName}</dd>
          </>
        ) : null}
        <dt>Источник</dt>
        <dd>{BOOKING_SOURCE[b.source]}</dd>
        {b.status === 'tentative' && b.prepaymentAmount ? (
          <>
            <dt>Предоплата</dt>
            <dd>
              <Money value={b.prepaymentAmount} currency={cur} />
              {b.prepaymentDueAt ? <span className={b.flags.prepaymentOverdue ? 'danger' : 'muted'}> · до {dateTime(b.prepaymentDueAt, tz)}</span> : null}
            </dd>
          </>
        ) : null}
        <dt>Комментарий</dt>
        <dd>{dash(b.comment)}</dd>
        <dt>Оформлено</dt>
        <dd>
          {dateTime(b.createdAt, tz)}
          {b.createdBy ? <span className="muted"> · {b.createdBy}</span> : null}
        </dd>
        {b.checkedInAt ? (
          <>
            <dt>Заселён</dt>
            <dd>
              {dateTime(b.checkedInAt, tz)}
              {b.keyIssuedAt ? <span className="muted"> · ключ выдан</span> : null}
            </dd>
          </>
        ) : null}
        {b.checkedOutAt ? (
          <>
            <dt>Выселен</dt>
            <dd>
              {dateTime(b.checkedOutAt, tz)}
              {b.rating ? <span className="muted"> · оценка {b.rating} из 5</span> : null}
            </dd>
          </>
        ) : null}
        {b.feedback ? (
          <>
            <dt>Отзыв</dt>
            <dd>{b.feedback}</dd>
          </>
        ) : null}
        {b.cancelReason ? (
          <>
            <dt>{b.status === 'no_show' ? 'Незаезд' : 'Отмена'}</dt>
            <dd>
              <span className="danger">{b.cancelReason}</span>
              <span className="muted">
                {' '}
                · {b.cancelledBy ?? 'Система'}
                {b.cancelledAt ? `, ${dateTime(b.cancelledAt, tz)}` : ''}
              </span>
            </dd>
          </>
        ) : null}
      </dl>

      {b.balance ? (
        <div className="balance-line">
          <span>
            Начислено <Money value={b.balance.charges} currency={cur} />
          </span>
          <span>
            Оплачено <Money value={b.balance.paid} currency={cur} tone={b.balance.paid > 0 ? 'in' : undefined} />
          </span>
          {b.balance.deposit ? (
            <span>
              Депозит <Money value={b.balance.deposit} currency={cur} />
            </span>
          ) : null}
          <span className="strong">
            {b.balance.due >= 0 ? 'К оплате' : 'Переплата'} <Money value={Math.abs(b.balance.due)} currency={cur} tone={b.balance.due > 0 ? 'due' : undefined} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Actions({ b, onMode }: { b: Booking; onMode: (m: Mode) => void }) {
  const can = useCan();
  const info = usePropertyInfo();
  const invalidate = useInvalidate();
  const today = info.data?.businessDate ?? '';
  const [dialog, setDialog] = useState<'cancel' | 'no_show' | null>(null);
  const settings = info.data?.settings;

  const after = (msg: string) => {
    toast.info(msg);
    void invalidate('booking', 'bookings', 'tape', 'dashboard', 'readiness', 'hk');
  };
  const confirm = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/bookings/{id}/confirm', { params: { path: { ...pid(), id: b.id } }, headers: ifMatch(b.version), body: {} })),
    onSuccess: () => after(`Бронь ${b.number} подтверждена`),
    onError: toast.fail,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      unwrap(
        api.POST(`/api/v1/properties/{propertyId}/bookings/{id}/${dialog === 'no_show' ? 'no-show' : 'cancel'}` as '/api/v1/properties/{propertyId}/bookings/{id}/cancel', {
          params: { path: { ...pid(), id: b.id } },
          headers: ifMatch(b.version),
          body: { reason },
        }),
      ),
    onSuccess: () => {
      after(dialog === 'no_show' ? `Бронь ${b.number}: незаезд` : `Бронь ${b.number} отменена`);
      setDialog(null);
    },
    onError: toast.fail,
  });

  const open = b.status === 'tentative' || b.status === 'confirmed';
  const arrivalReached = b.arrival <= today;
  const checkoutDay = b.status === 'checked_in' && b.departure <= today;

  return (
    <>
      {open && can('booking.checkin') && arrivalReached ? (
        <button type="button" className="btn btn-primary" onClick={() => onMode('checkin')}>
          Заселить
        </button>
      ) : null}
      {b.status === 'tentative' && can('booking.confirm') ? (
        <button type="button" className={`btn ${arrivalReached ? 'btn-ghost' : 'btn-primary'}`} disabled={confirm.isPending} onClick={() => confirm.mutate()}>
          Подтвердить
        </button>
      ) : null}
      {b.status === 'checked_in' && can('booking.checkout') ? (
        <button type="button" className={`btn ${checkoutDay ? 'btn-primary' : 'btn-ghost'}`} onClick={() => onMode('checkout')}>
          Выселить
        </button>
      ) : null}
      {(open || b.status === 'checked_in') && can('booking.edit') ? (
        <button type="button" className="btn btn-ghost" onClick={() => onMode('edit')}>
          {b.status === 'checked_in' ? 'Продлить или переселить' : 'Изменить'}
        </button>
      ) : null}
      <span className="spacer" />
      {open && can('booking.cancel') ? (
        <>
          {arrivalReached ? (
            <button type="button" className="btn btn-quiet" onClick={() => setDialog('no_show')}>
              Незаезд
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet danger-quiet" onClick={() => setDialog('cancel')}>
            Отменить бронь
          </button>
        </>
      ) : null}
      <ReasonDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'no_show' ? `Незаезд по брони ${b.number}` : `Отменить бронь ${b.number}?`}
        text={
          dialog === 'no_show'
            ? 'Номер освободится. Бронь останется в истории гостя с причиной.'
            : 'Бронь не удаляется: остаётся в истории с причиной и автором. Номер освободится сразу.'
        }
        presets={dialog === 'no_show' ? settings?.noShowReasons : settings?.cancelReasons}
        confirmLabel={dialog === 'no_show' ? 'Отметить незаезд' : 'Отменить бронь'}
        danger
        busy={cancel.isPending}
        onConfirm={(r) => cancel.mutate(r)}
      />
    </>
  );
}
