import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { useGuest, useGuestDocuments, useGuestStays, useInvalidate } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Empty, Loading, Money, Status } from '@/components/ui/bits';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { openNewBooking } from '@/features/bookings/new-booking';
import { History } from '@/features/bookings/history';
import { useOpenBooking } from '@/features/bookings/open';
import { dash, dateTime, dayLong, phone, plural, stayRange } from '@/lib/format';
import { COUNTRY, DOC_TYPE, LANGUAGE } from '@/lib/labels';
import { GuestFormModal } from './guest-form';
import './guests.css';

/** Карточка гостя - центр CRM: всё, что связано с человеком, в одном месте. */
export function GuestPage() {
  const { guestId } = useParams({ strict: false }) as { guestId: string };
  const can = useCan();
  const property = useProperty();
  const guest = useGuest(guestId);
  const stays = useGuestStays(guestId);
  const docs = useGuestDocuments(guestId, can('guest.documents'));
  const invalidate = useInvalidate();
  const openBooking = useOpenBooking();
  const [editing, setEditing] = useState(false);
  const [blacklistDialog, setBlacklistDialog] = useState(false);
  const g = guest.data;

  const dupes = useQuery({
    queryKey: ['guest', pid().propertyId, guestId, 'dupes', g?.version],
    queryFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/guests/match', {
          params: { path: pid() },
          body: { docNumber: g!.docNumber, citizenship: g!.citizenship, phone: g!.phone, lastName: g!.lastName, birthDate: g!.birthDate, excludeId: g!.id },
        }),
      ),
    enabled: !!g && !g.mergedInto,
  });

  const blacklist = useMutation({
    mutationFn: (reason: string | null) =>
      unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/guests/{id}', {
          params: { path: { ...pid(), id: g!.id } },
          headers: ifMatch(g!.version),
          body: { blacklisted: reason !== null, blacklistReason: reason },
        }),
      ),
    onSuccess: (ng) => {
      toast.info(ng.blacklisted ? 'Гость внесён в чёрный список' : 'Гость убран из чёрного списка');
      setBlacklistDialog(false);
      void invalidate('guest', 'guests');
    },
    onError: toast.fail,
  });

  const merge = useMutation({
    mutationFn: (duplicateId: string) => unwrap(api.POST('/api/v1/properties/{propertyId}/guests/{id}/merge', { params: { path: { ...pid(), id: g!.id } }, body: { duplicateId } })),
    onSuccess: () => {
      toast.info('Карточки объединены', 'История и сканы дубля перенесены сюда; дубль остался со ссылкой на эту карточку.');
      void invalidate('guest', 'guests', 'bookings');
    },
    onError: toast.fail,
  });

  const openDoc = async (documentId: string) => {
    try {
      const { url } = await unwrap(api.GET('/api/v1/properties/{propertyId}/guests/{id}/documents/{documentId}/url', { params: { path: { ...pid(), id: guestId, documentId } } }));
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      toast.fail(e);
    }
  };

  if (guest.isPending) return <div className="page"><Loading /></div>;
  if (!g) return <div className="page"><Empty title="Гость не найден" /></div>;
  if (g.mergedInto) {
    return (
      <div className="page">
        <h1 className="page-title">{g.fullName}</h1>
        <p className="page-sub">Эта карточка объединена с другой.</p>
        <Link to="/guests/$guestId" params={{ guestId: g.mergedInto }} className="btn btn-primary" style={{ marginTop: 'var(--s-4)' }}>
          Открыть основную карточку
        </Link>
      </div>
    );
  }
  const strongDupes = (dupes.data ?? []).filter((d) => d.strength === 'strong' || d.reasons.length);

  return (
    <div className="page guest-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {g.fullName}
            {g.isVip ? <span className="tag tag-strong title-tag">VIP</span> : null}
          </h1>
          <p className="page-sub">
            {phone(g.phone)}
            {g.email ? ` · ${g.email}` : ''}
            {g.citizenship ? ` · ${COUNTRY[g.citizenship] ?? g.citizenship}` : ''}
            {g.language ? ` · говорит: ${LANGUAGE[g.language]?.toLowerCase() ?? g.language}` : ''}
          </p>
        </div>
        <div className="page-actions">
          {can('booking.create') && !g.blacklisted ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                openNewBooking({
                  guest: {
                    id: g.id,
                    fullName: g.fullName,
                    phone: g.phone,
                    email: g.email,
                    citizenship: g.citizenship,
                    birthDate: g.birthDate,
                    docNumber: g.docNumber,
                    companyName: g.companyName,
                    isVip: g.isVip,
                    blacklisted: g.blacklisted,
                    stays: g.stats.stays,
                    lastStay: g.stats.lastStay,
                  },
                })
              }
            >
              Новая бронь
            </button>
          ) : null}
          {can('guest.edit') ? (
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
              Изменить
            </button>
          ) : null}
          {can('guest.blacklist') ? (
            g.blacklisted ? (
              <button type="button" className="btn btn-quiet" disabled={blacklist.isPending} onClick={() => blacklist.mutate(null)}>
                Убрать из чёрного списка
              </button>
            ) : (
              <button type="button" className="btn btn-quiet danger-quiet" onClick={() => setBlacklistDialog(true)}>
                В чёрный список
              </button>
            )
          ) : null}
        </div>
      </div>

      {g.blacklisted ? (
        <div className="alert" style={{ marginBottom: 'var(--s-5)' }}>
          <strong>Чёрный список.</strong> {g.blacklistReason}
        </div>
      ) : null}

      <div className="figures">
        <div className="figure">
          <span className="v">{g.stats.stays}</span>
          <span className="l">{plural(g.stats.stays, 'проживание', 'проживания', 'проживаний')}</span>
        </div>
        <div className="figure">
          <span className="v">{g.stats.nights}</span>
          <span className="l">{plural(g.stats.nights, 'ночь', 'ночи', 'ночей')}</span>
        </div>
        {can('folio.view') ? (
          <div className="figure">
            <span className="v">
              <Money value={g.stats.spent} currency={property.currency} />
            </span>
            <span className="l">проживания и услуги за всё время</span>
          </div>
        ) : null}
        <div className="figure">
          <span className="v">{g.stats.lastStay ? dayLong(g.stats.lastStay) : '-'}</span>
          <span className="l">последний визит</span>
        </div>
        {g.stats.cancellations || g.stats.noShows ? (
          <div className="figure" data-alert={g.stats.noShows > 0}>
            <span className="v">
              {g.stats.cancellations} / {g.stats.noShows}
            </span>
            <span className="l">отмен / незаездов</span>
          </div>
        ) : null}
      </div>

      {strongDupes.length && can('guest.view') ? (
        <section className="section guest-dupes">
          <h2 className="section-title">Возможные дубли</h2>
          {strongDupes.map((d) => (
            <div key={d.guest.id} className="row-between dupe-row">
              <div>
                <Link to="/guests/$guestId" params={{ guestId: d.guest.id }} className="link">
                  {d.guest.fullName}
                </Link>
                <span className="muted">
                  {' '}
                  · {phone(d.guest.phone)} · совпадает {d.reasons.map((r) => (r === 'document' ? 'документ' : r === 'phone' ? 'телефон' : 'ФИО и дата рождения')).join(', ')}
                  {d.guest.stays ? ` · визитов ${d.guest.stays}` : ''}
                </span>
              </div>
              {can('guest.merge') ? (
                <button type="button" className="btn btn-ghost btn-sm" disabled={merge.isPending} onClick={() => merge.mutate(d.guest.id)}>
                  Объединить с этой карточкой
                </button>
              ) : (
                <span className="muted">объединяет старший администратор</span>
              )}
            </div>
          ))}
        </section>
      ) : null}

      <div className="guest-cols">
        <section className="section">
          <h2 className="section-title">Профиль</h2>
          <dl className="facts">
            <dt>Документ</dt>
            <dd>{g.docType ? `${DOC_TYPE[g.docType]} ${g.docNumber ?? ''}` : '-'}</dd>
            <dt>Дата рождения</dt>
            <dd>{g.birthDate ? dayLong(g.birthDate, 0) : '-'}</dd>
            <dt>ИИН</dt>
            <dd className="num">{dash(g.personalNumber)}</dd>
            <dt>Адрес</dt>
            <dd>{dash(g.address)}</dd>
            <dt>Компания</dt>
            <dd>{dash(g.companyName)}</dd>
            <dt>Согласие на данные</dt>
            <dd>{g.pdConsentAt ? `${dateTime(g.pdConsentAt, property.timezone)}, ${g.pdConsentMethod === 'tablet' ? 'на планшете' : 'на бумаге'}` : <span className="muted">не подписано</span>}</dd>
            <dt>Рассылки</dt>
            <dd>{g.marketingConsent ? 'согласен' : <span className="muted">не согласен - не писать</span>}</dd>
          </dl>
        </section>
        <section className="section">
          <h2 className="section-title">Предпочтения и пометки</h2>
          <dl className="facts">
            <dt>Номер</dt>
            <dd>{dash(g.preferences.roomType)}</dd>
            <dt>Аллергии</dt>
            <dd>{g.preferences.allergies ? <strong>{g.preferences.allergies}</strong> : '-'}</dd>
            <dt>Пожелания</dt>
            <dd>{dash(g.preferences.notes)}</dd>
            <dt>Заметки</dt>
            <dd>{dash(g.notes)}</dd>
          </dl>
        </section>
      </div>

      <section className="section">
        <h2 className="section-title">
          История <span className="aside">проживания, отмены, незаезды, отзывы</span>
        </h2>
        {stays.isPending ? (
          <Loading />
        ) : !stays.data?.length ? (
          <p className="muted">Броней пока не было.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Даты</th>
                  <th>Номер</th>
                  <th>Статус</th>
                  {can('folio.view') ? <th className="r">Сумма</th> : null}
                  <th>Отзыв</th>
                </tr>
              </thead>
              <tbody>
                {stays.data.map((s) => (
                  <tr key={s.bookingId} data-clickable onClick={() => openBooking(s.bookingId)}>
                    <td className="nowrap">
                      {stayRange(s.arrival, s.departure, true)}
                      <span className="sub">бронь {s.number}</span>
                    </td>
                    <td>
                      {s.roomNumber}
                      <span className="sub">{s.roomTypeName}</span>
                    </td>
                    <td>
                      <Status value={s.status} />
                      {s.cancelReason ? <span className="sub">{s.cancelReason}</span> : null}
                    </td>
                    {can('folio.view') ? <td className="r">{s.total ? <Money value={s.total} currency={property.currency} /> : '-'}</td> : null}
                    <td>
                      {s.rating ? `${s.rating} из 5` : '-'}
                      {s.feedback ? <span className="sub">{s.feedback}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can('guest.documents') ? (
        <section className="section">
          <h2 className="section-title">
            Сканы документов <span className="aside">просмотр пишется в журнал</span>
          </h2>
          {!docs.data?.length ? (
            <p className="muted">Сканов нет. Скан добавляется при заселении.</p>
          ) : (
            <ul role="list" className="doc-list">
              {docs.data.map((d) => (
                <li key={d.id} className="row-between">
                  <span>
                    {d.kind === 'passport' ? 'Паспорт' : d.kind === 'id_front' ? 'ID-карта, лицевая сторона' : d.kind === 'id_back' ? 'ID-карта, оборот' : 'Документ'}
                    <span className="muted">
                      {' '}
                      · {dateTime(d.uploadedAt, property.timezone)}
                      {d.uploadedBy ? ` · ${d.uploadedBy}` : ''}
                      {d.retainUntil ? ` · хранится до ${dayLong(d.retainUntil, 0)}` : ''}
                    </span>
                  </span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openDoc(d.id)}>
                    Открыть
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="section">
        <h2 className="section-title">Изменения карточки</h2>
        <History entityType="guest" entityId={g.id} />
      </section>

      <GuestFormModal open={editing} guest={g} onClose={() => setEditing(false)} />
      <ReasonDialog
        open={blacklistDialog}
        onClose={() => setBlacklistDialog(false)}
        title={`Внести ${g.fullName} в чёрный список?`}
        text="Новую бронь такому гостю оформит только старший администратор, осознанно. Причину увидят все, кто откроет карточку."
        confirmLabel="Внести в чёрный список"
        danger
        busy={blacklist.isPending}
        onConfirm={(r) => blacklist.mutate(r)}
      />
    </div>
  );
}
