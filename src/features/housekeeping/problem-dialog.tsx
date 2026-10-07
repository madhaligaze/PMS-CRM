import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useInvalidate, usePropertyInfo, useRooms } from '@/api/hooks';
import { useCan } from '@/auth/session';
import { Choices, Field } from '@/components/ui/bits';
import { Dialog } from '@/components/ui/overlay';
import { PhotoPicker, usePhotos } from '@/components/ui/photos';
import { toast } from '@/components/ui/toast';
import { addDays } from '@/lib/dates';
import { dayLong } from '@/lib/format';

type Urgency = 'low' | 'normal' | 'high' | 'critical';

/**
 * «Сообщить о поломке»: заявка технику. Написать её может любой сотрудник;
 * снять номер с продажи на время ремонта - только тот, кому открыта
 * блокировка номеров. Номер подставляется, если окно открыто из номера.
 */
export function ProblemDialog({ open, onClose, roomId: fixedRoom, roomNumber }: { open: boolean; onClose: () => void; roomId?: string | null; roomNumber?: string }) {
  const can = useCan();
  const rooms = useRooms();
  const info = usePropertyInfo();
  const invalidate = useInvalidate();
  const photos = usePhotos('maintenance_photo');
  const [roomId, setRoomId] = useState('');
  const [location, setLocation] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [blocks, setBlocks] = useState(false);
  const [blockTo, setBlockTo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const today = info.data?.businessDate ?? '';
  const { reset } = photos;

  useEffect(() => {
    if (!open) return;
    setRoomId(fixedRoom ?? '');
    setLocation('');
    setTitle('');
    setDescription('');
    setUrgency('normal');
    setBlocks(false);
    setBlockTo('');
    setError(null);
    reset();
  }, [open, fixedRoom, reset]);

  const room = fixedRoom ?? roomId;
  const canBlock = can('block.manage') && !!room;
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/maintenance', {
          params: { path: pid() },
          headers: idem(),
          body: {
            roomId: room || null,
            location: room ? null : location.trim(),
            title: title.trim(),
            description: description.trim() || null,
            urgency,
            photoFileIds: photos.ids,
            blocksSale: canBlock && blocks,
            ...(canBlock && blocks ? { blockTo } : {}),
          },
        }),
      ),
    onSuccess: (m) => {
      toast.info(`Заявка ${m.number} отправлена`, m.block ? `Номер ${m.roomNumber} не продаётся до ${dayLong(m.block.endsOn)}` : 'Техник увидит её в разделе «Ремонт».');
      void invalidate('maintenance', 'hk', 'tape', 'dashboard');
      onClose();
    },
    onError: (e) => (isApiError(e) ? setError(e.detail ? `${e.message}. ${e.detail}` : e.message) : toast.fail(e)),
  });

  const where = room ? true : location.trim().length > 0;
  const ready = where && title.trim().length > 0 && !photos.busy && (!blocks || !canBlock || (!!blockTo && blockTo > today));
  const list = (rooms.data ?? []).filter((r) => r.isActive).sort((a, b) => a.number.localeCompare(b.number, 'ru', { numeric: true }));

  return (
    <Dialog open={open} onClose={onClose} title={fixedRoom ? `Поломка в номере ${roomNumber ?? ''}` : 'Сообщить о поломке'} wide>
      <div className="stack">
        {fixedRoom ? null : (
          <div className="grid-2">
            <Field label="Где" htmlFor="pr-room">
              <select id="pr-room" className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Не в номере</option>
                {list.map((r) => (
                  <option key={r.id} value={r.id}>
                    Номер {r.number}
                  </option>
                ))}
              </select>
            </Field>
            {roomId ? null : (
              <Field label="Место" htmlFor="pr-place">
                <input id="pr-place" className="input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Например: лобби, прачечная" />
              </Field>
            )}
          </div>
        )}
        <Field label="Что случилось" htmlFor="pr-title">
          <input id="pr-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например: течёт кран в ванной" data-autofocus maxLength={200} />
        </Field>
        <Field label="Подробнее" htmlFor="pr-desc" optional>
          <textarea id="pr-desc" className="textarea" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label="Срочность">
          <Choices
            label="Срочность"
            value={urgency}
            onChange={setUrgency}
            options={[
              ['low', 'Не срочно'],
              ['normal', 'Обычная'],
              ['high', 'Срочно'],
              ['critical', 'Авария'],
            ]}
          />
        </Field>
        <PhotoPicker photos={photos} />
        {canBlock ? (
          <div className="stack problem-block">
            <label className="check">
              <input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />
              <span>Жить в номере нельзя: снять его с продажи до ремонта</span>
            </label>
            {blocks ? (
              <Field label="Не продавать до" htmlFor="pr-until" hint="До этого дня номер закрыт на шахматке. Починят раньше - техник закроет заявку, и блокировка снимется сама.">
                <input id="pr-until" type="date" className="input" min={today ? addDays(today, 1) : undefined} value={blockTo} onChange={(e) => setBlockTo(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!ready || save.isPending} onClick={() => save.mutate()}>
          {photos.busy ? 'Фото загружается' : 'Отправить заявку'}
        </button>
      </div>
    </Dialog>
  );
}
