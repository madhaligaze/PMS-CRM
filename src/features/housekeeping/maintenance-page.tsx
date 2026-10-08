import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useInvalidate, useMaintenance, type S } from '@/api/hooks';
import { useCan, useProperty, useSession } from '@/auth/session';
import { Empty, Field, Loading } from '@/components/ui/bits';
import { Dialog, Modal, useHeld } from '@/components/ui/overlay';
import { PhotoPicker, PhotoStrip, usePhotos } from '@/components/ui/photos';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import { toast } from '@/components/ui/toast';
import { History } from '@/features/bookings/history';
import { dateTime, dayLong, plural } from '@/lib/format';
import { MAINT_STATUS, URGENCY } from '@/lib/labels';
import { ProblemDialog } from './problem-dialog';
import './housekeeping.css';

type Request = S['MaintenanceRequest'];
type View = 'open' | 'closed';

const URGENCY_ORDER: Record<Request['urgency'], number> = { critical: 0, high: 1, normal: 2, low: 3 };
const where = (m: Request) => (m.roomNumber ? `Номер ${m.roomNumber}` : (m.location ?? '-'));

/**
 * Ремонт: заявки технику. Открытые идут по срочности, внутри - от старых к
 * новым: авария не ждёт, а старая заявка не должна теряться под свежими.
 * Заявка, из-за которой номер снят с продажи, при закрытии сама вернёт номер
 * в уборку.
 */
export function MaintenancePage() {
  const [view, setView] = useState<View>('open');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const property = useProperty();
  const list = useMaintenance({ status: view === 'open' ? ['open', 'in_progress'] : ['done', 'cancelled'] });
  const rows = [...(list.data ?? [])].sort((a, b) =>
    view === 'open' ? URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] || a.createdAt.localeCompare(b.createdAt) : (b.closedAt ?? '').localeCompare(a.closedAt ?? ''),
  );
  const selected = (list.data ?? []).find((m) => m.id === openId) ?? null;
  const offSale = rows.filter((m) => m.block?.isActive).length;
  return (
    <div className="page mn">
      <div className="page-head">
        <div>
          <h1 className="page-title">Ремонт</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            Новая заявка
          </button>
        </div>
      </div>

      <div className="tabs page-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={view === 'open'} onClick={() => setView('open')}>
          Открытые
        </button>
        <button type="button" role="tab" className="tab" aria-selected={view === 'closed'} onClick={() => setView('closed')}>
          Закрытые
        </button>
      </div>

      {view === 'open' && rows.length ? (
        <div className="figures hk-figures">
          <div className="figure">
            <span className="v">{rows.filter((m) => m.status === 'open').length}</span>
            <span className="l">ждут техника</span>
          </div>
          <div className="figure">
            <span className="v">{rows.filter((m) => m.status === 'in_progress').length}</span>
            <span className="l">в работе</span>
          </div>
          {offSale ? (
            <div className="figure">
              <span className="v">{offSale}</span>
              <span className="l">{plural(offSale, 'номер снят с продажи', 'номера сняты с продажи', 'номеров снято с продажи')}</span>
            </div>
          ) : null}
          {rows.some((m) => m.urgency === 'critical') ? (
            <div className="figure" data-alert="true">
              <span className="v">{rows.filter((m) => m.urgency === 'critical').length}</span>
              <span className="l">{plural(rows.filter((m) => m.urgency === 'critical').length, 'авария', 'аварии', 'аварий')}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Empty title="Заявки не загрузились">Обновите страницу.</Empty>
      ) : !rows.length ? (
        <Empty title={view === 'open' ? 'Открытых заявок нет' : 'Закрытых заявок пока нет'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>№</th>
                <th>Где</th>
                <th>Что</th>
                <th>Срочность</th>
                <th>{view === 'open' ? 'Кто делает' : 'Итог'}</th>
                <th>{view === 'open' ? 'Создана' : 'Закрыта'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} data-clickable onClick={() => setOpenId(m.id)}>
                  <td className="num">{m.number}</td>
                  <td>
                    {where(m)}
                    {m.block?.isActive ? <span className="sub">не продаётся до {dayLong(m.block.endsOn)}</span> : null}
                  </td>
                  <td>
                    {m.title}
                    {m.description ? <span className="sub truncate">{m.description}</span> : null}
                  </td>
                  <td>
                    <span className="mn-urgency" data-u={m.urgency}>
                      {URGENCY[m.urgency]}
                    </span>
                  </td>
                  <td>
                    {view === 'open' ? (
                      m.assigneeName ? (
                        m.assigneeName
                      ) : (
                        <span className="muted">никто</span>
                      )
                    ) : (
                      <>
                        {MAINT_STATUS[m.status]}
                        {m.closeComment ? <span className="sub truncate">{m.closeComment}</span> : null}
                      </>
                    )}
                  </td>
                  <td className="nowrap">
                    {view === 'open' ? dateTime(m.createdAt, property.timezone) : m.closedAt ? dateTime(m.closedAt, property.timezone) : '-'}
                    <span className="sub">{view === 'open' ? m.createdBy : (m.closedBy ?? '')}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RequestModal request={selected} onClose={() => setOpenId(null)} />
      <ProblemDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function RequestModal({ request: incoming, onClose }: { request: Request | null; onClose: () => void }) {
  const m = useHeld(incoming);
  const can = useCan();
  const me = useSession().me;
  const property = useProperty();
  const invalidate = useInvalidate();
  const [tab, setTab] = useState<'card' | 'history'>('card');
  const [closing, setClosing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const id = m?.id;
  useEffect(() => setTab('card'), [id]);
  const refresh = () => void invalidate('maintenance', 'hk', 'tape', 'dashboard');
  const take = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/maintenance/{id}/take', { params: { path: { ...pid(), id: id! } } })),
    onSuccess: (r) => {
      toast.info(`Заявка ${r.number} в работе`);
      refresh();
    },
    onError: toast.fail,
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => unwrap(api.POST('/api/v1/properties/{propertyId}/maintenance/{id}/cancel', { params: { path: { ...pid(), id: id! } }, body: { reason } })),
    onSuccess: (r) => {
      toast.info(`Заявка ${r.number} отменена`, r.block ? 'Номер вернулся в уборку.' : undefined);
      setCancelling(false);
      refresh();
    },
    onError: toast.fail,
  });
  if (!m) return null;
  const tz = property.timezone;
  const live = m.status === 'open' || m.status === 'in_progress';
  const canCancel = live && (m.createdById === me?.id || can('block.manage'));
  return (
    <Modal
      open={!!incoming}
      onClose={onClose}
      title={`Заявка ${m.number} · ${where(m)}`}
      subtitle={`${MAINT_STATUS[m.status]} · ${URGENCY[m.urgency]?.toLowerCase()}`}
      wide
      footer={
        live ? (
          <>
            {canCancel ? (
              <button type="button" className="btn btn-ghost" onClick={() => setCancelling(true)}>
                Отменить заявку
              </button>
            ) : null}
            <span className="spacer" />
            {can('maintenance.work') && m.status === 'open' ? (
              <button type="button" className="btn btn-ghost" disabled={take.isPending} onClick={() => take.mutate()}>
                Взять в работу
              </button>
            ) : null}
            {can('maintenance.work') ? (
              <button type="button" className="btn btn-primary" onClick={() => setClosing(true)}>
                Готово, закрыть
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="tabs card-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'card'} onClick={() => setTab('card')}>
          Заявка
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          История
        </button>
      </div>
      {tab === 'history' ? (
        <History entityType="maintenance" entityId={m.id} />
      ) : (
        <div className="stack">
          <dl className="facts">
            <dt>Что</dt>
            <dd>
              <strong>{m.title}</strong>
              {m.description ? <div className="ink-2">{m.description}</div> : null}
            </dd>
            <dt>Срочность</dt>
            <dd>
              <span className="mn-urgency" data-u={m.urgency}>
                {URGENCY[m.urgency]}
              </span>
            </dd>
            <dt>Создал</dt>
            <dd>
              {m.createdBy} · {dateTime(m.createdAt, tz)}
            </dd>
            {m.block ? (
              <>
                <dt>Продажа номера</dt>
                <dd>{m.block.isActive ? `закрыт до ${dayLong(m.block.endsOn)}` : 'блокировка снята'}</dd>
              </>
            ) : null}
            {m.assigneeName ? (
              <>
                <dt>Техник</dt>
                <dd>
                  {m.assigneeName}
                  {m.takenAt ? ` · взял ${dateTime(m.takenAt, tz)}` : ''}
                </dd>
              </>
            ) : null}
            {!live ? (
              <>
                <dt>{m.status === 'cancelled' ? 'Отменил' : 'Закрыл'}</dt>
                <dd>
                  {m.closedBy ?? '-'}
                  {m.closedAt ? ` · ${dateTime(m.closedAt, tz)}` : ''}
                  {m.closeComment ? <div className="ink-2">{m.closeComment}</div> : null}
                </dd>
              </>
            ) : null}
          </dl>
          {m.photoFileIds.length ? (
            <div>
              <h3 className="hk-sub">Фото поломки</h3>
              <PhotoStrip ids={m.photoFileIds} />
            </div>
          ) : null}
          {m.closePhotoFileIds.length ? (
            <div>
              <h3 className="hk-sub">Фото после ремонта</h3>
              <PhotoStrip ids={m.closePhotoFileIds} />
            </div>
          ) : null}
        </div>
      )}
      <CloseDialog request={closing ? m : null} onClose={() => setClosing(false)} onDone={refresh} />
      <ReasonDialog
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Отменить заявку ${m.number}`}
        text={m.block?.isActive ? 'Номер снимется с блокировки и уйдёт в уборку.' : undefined}
        presets={['Заявка повторная', 'Починили сами', 'Ошибка в заявке']}
        confirmLabel="Отменить заявку"
        busy={cancel.isPending}
        onConfirm={(reason) => cancel.mutate(reason)}
      />
    </Modal>
  );
}

function CloseDialog({ request: incoming, onClose, onDone }: { request: Request | null; onClose: () => void; onDone: () => void }) {
  const m = useHeld(incoming);
  const photos = usePhotos('maintenance_photo');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { reset } = photos;
  useEffect(() => {
    if (!incoming) return;
    setComment('');
    setError(null);
    reset();
  }, [incoming, reset]);
  const close = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/api/v1/properties/{propertyId}/maintenance/{id}/close', { params: { path: { ...pid(), id: m!.id } }, body: { comment: comment.trim(), photoFileIds: photos.ids } })),
    onSuccess: (r) => {
      toast.info(`Заявка ${r.number} закрыта`, r.block ? `Номер ${r.roomNumber} ушёл в уборку, после проверки вернётся в продажу.` : undefined);
      onDone();
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.message) : toast.fail(e)),
  });
  return (
    <Dialog open={!!incoming} onClose={onClose} title={`Закрыть заявку ${m?.number ?? ''}`}>
      <div className="stack">
        <Field label="Что сделано" htmlFor="mn-done">
          <textarea id="mn-done" className="textarea" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: заменил смеситель, протечки нет" data-autofocus />
        </Field>
        <PhotoPicker photos={photos} label="Фото после ремонта" />
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!comment.trim() || photos.busy || close.isPending} onClick={() => close.mutate()}>
          {photos.busy ? 'Фото загружается' : 'Закрыть заявку'}
        </button>
      </div>
    </Dialog>
  );
}
