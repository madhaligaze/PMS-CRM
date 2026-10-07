import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, pid, unwrap } from '@/api/client';
import { useHkBoard, useHkTasks, useInvalidate, type S } from '@/api/hooks';
import { useProperty, useSession } from '@/auth/session';
import { Choices, Empty, Field, Loading } from '@/components/ui/bits';
import { Dialog, useHeld } from '@/components/ui/overlay';
import { PhotoPicker, usePhotos } from '@/components/ui/photos';
import { toast } from '@/components/ui/toast';
import { dayTitle, time } from '@/lib/format';
import { HK_TASK_KIND } from '@/lib/labels';
import { ProblemDialog } from './problem-dialog';
import './housekeeping.css';

type Task = S['HkTask'];
type Room = S['HkBoard']['rooms'][number];

/** Для горничной гость - не имя, а что происходит в номере. */
function roomLine(r: Room | undefined): string | null {
  if (!r) return null;
  switch (r.occupancy) {
    case 'turnover':
      return 'Выезд и заезд сегодня: к заезду номер должен быть готов';
    case 'departure':
      return r.departureDone ? 'Гости выехали' : 'Гости выезжают сегодня';
    case 'arrival':
      return 'Сегодня заезд: номер должен быть готов';
    case 'occupied':
      return 'В номере живут';
    default:
      return 'Номер свободен';
  }
}

const needsForArrival = (r: Room | undefined) => !!r && (r.occupancy === 'arrival' || r.occupancy === 'turnover');

/**
 * Мои уборки: телефон горничной. Сверху - номер, который убирается сейчас,
 * дальше - очередь: сначала номера к сегодняшнему заезду, потом по сроку.
 * Никому не назначенные задачи горничная может взять сама.
 */
export function MyTasksPage() {
  const property = useProperty();
  const me = useSession().me;
  const tasks = useHkTasks({ assignee: 'me' });
  const board = useHkBoard();
  const [problem, setProblem] = useState<{ roomId: string; number: string } | null>(null);
  if (tasks.isPending) return <div className="page mt"><Loading /></div>;
  if (tasks.isError) return <div className="page mt"><Empty title="Задачи не загрузились">Проверьте связь и обновите страницу.</Empty></div>;

  const rooms = new Map((board.data?.rooms ?? []).map((r) => [r.id, r]));
  const all = (tasks.data ?? []).filter((t) => t.status !== 'cancelled');
  const mine = all.filter((t) => t.assigneeId === me?.id);
  const free = all.filter((t) => !t.assigneeId && t.status === 'open');
  const now = mine.filter((t) => t.status === 'in_progress');
  const queue = mine
    .filter((t) => t.status === 'open')
    .sort(
      (a, b) =>
        Number(needsForArrival(rooms.get(b.roomId))) - Number(needsForArrival(rooms.get(a.roomId))) ||
        Number(b.overdue) - Number(a.overdue) ||
        (a.dueAt ?? '9').localeCompare(b.dueAt ?? '9') ||
        a.roomNumber.localeCompare(b.roomNumber, 'ru', { numeric: true }),
    );
  const done = mine.filter((t) => t.status === 'done' || t.status === 'inspected' || t.status === 'skipped');
  const left = now.length + queue.length;
  const date = board.data?.businessDate;

  return (
    <div className="page mt">
      <div className="page-head">
        <div>
          <h1 className="page-title">Мои уборки</h1>
          <p className="page-sub">
            {date ? `${dayTitle(date)} · ` : ''}
            {mine.length ? (left ? `осталось ${left} из ${mine.length}` : 'всё сделано') : 'задач пока нет'}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setProblem({ roomId: '', number: '' })}>
            Сообщить о поломке
          </button>
        </div>
      </div>

      {!mine.length && !free.length ? (
        <Empty title="На сегодня уборок нет">Когда супервайзер назначит номер, он появится здесь сам.</Empty>
      ) : null}

      {now.length ? (
        <TaskGroup title="Сейчас" tasks={now} rooms={rooms} tz={property.timezone} onProblem={setProblem} />
      ) : null}
      {queue.length ? <TaskGroup title="Дальше" tasks={queue} rooms={rooms} tz={property.timezone} onProblem={setProblem} /> : null}
      {free.length ? <TaskGroup title="Никому не назначены: можно взять" tasks={free} rooms={rooms} tz={property.timezone} onProblem={setProblem} /> : null}
      {done.length ? <TaskGroup title="Сделано сегодня" tasks={done} rooms={rooms} tz={property.timezone} onProblem={setProblem} /> : null}

      <ProblemDialog open={!!problem} onClose={() => setProblem(null)} roomId={problem?.roomId || null} roomNumber={problem?.number} />
    </div>
  );
}

function TaskGroup({
  title,
  tasks,
  rooms,
  tz,
  onProblem,
}: {
  title: string;
  tasks: Task[];
  rooms: Map<string, Room>;
  tz: string;
  onProblem: (p: { roomId: string; number: string }) => void;
}) {
  return (
    <section className="mt-group">
      <h2 className="mt-group-title">{title}</h2>
      <ul role="list" className="mt-list">
        {tasks.map((t) => (
          <TaskCard key={t.id} task={t} room={rooms.get(t.roomId)} tz={tz} onProblem={() => onProblem({ roomId: t.roomId, number: t.roomNumber })} />
        ))}
      </ul>
    </section>
  );
}

function TaskCard({ task: t, room, tz, onProblem }: { task: Task; room: Room | undefined; tz: string; onProblem: () => void }) {
  const invalidate = useInvalidate();
  const [finishing, setFinishing] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const refresh = () => void invalidate('hk', 'dashboard');
  const start = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}/start', { params: { path: { ...pid(), id: t.id } } })),
    onSuccess: () => {
      toast.info(`Номер ${t.roomNumber}: уборка начата`);
      refresh();
    },
    onError: toast.fail,
  });
  const finish = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}/finish', { params: { path: { ...pid(), id: t.id } }, body: {} })),
    onSuccess: () => {
      toast.info(`Номер ${t.roomNumber} убран`, 'Супервайзер проверит и отпустит его в продажу.');
      refresh();
    },
    onError: toast.fail,
  });
  const undnd = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/rooms/{id}/dnd', { params: { path: { ...pid(), id: t.roomId } }, body: { on: false } })),
    onSuccess: () => {
      toast.info(`Номер ${t.roomNumber}: табличку сняли`);
      void invalidate('hk');
    },
    onError: toast.fail,
  });
  const open = t.status === 'open';
  const working = t.status === 'in_progress';
  const closed = !open && !working;
  const dnd = !!room?.dnd && open;
  const line = roomLine(room);
  return (
    <li className="mt-card" data-status={t.status} data-overdue={t.overdue || undefined}>
      <div className="mt-card-head">
        <span className="mt-num">{t.roomNumber}</span>
        <span className="mt-kind">{HK_TASK_KIND[t.kind]}</span>
        <span className="mt-due">
          {closed
            ? t.status === 'skipped'
              ? 'пропущено'
              : t.status === 'inspected'
                ? 'принято'
                : t.finishedAt
                  ? `убрано в ${time(t.finishedAt, tz)}`
                  : 'убрано'
            : t.dueAt
              ? t.overdue
                ? `просрочено, срок ${time(t.dueAt, tz)}`
                : `до ${time(t.dueAt, tz)}`
              : null}
        </span>
      </div>
      {!closed && line ? <div className={`mt-line${needsForArrival(room) ? ' strong' : ''}`}>{line}</div> : null}
      {t.note && !closed ? <div className="mt-returned">{t.note}</div> : null}
      {t.status === 'skipped' && t.skipReason ? <div>{t.skipReason}</div> : null}
      {dnd ? <div className="mt-line strong">На двери «Не беспокоить»</div> : null}
      {working && t.startedAt ? <div className="mt-line">Начата в {time(t.startedAt, tz)}</div> : null}
      {!closed ? (
        <div className="mt-actions">
          {open && !dnd ? (
            <button type="button" className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>
              {t.assigneeId ? 'Начать уборку' : 'Взять и начать'}
            </button>
          ) : null}
          {dnd ? (
            <button type="button" className="btn btn-ghost" disabled={undnd.isPending} onClick={() => undnd.mutate()}>
              Табличку сняли
            </button>
          ) : null}
          {working ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={finish.isPending}
              onClick={() => (t.checklist.length ? setFinishing(true) : finish.mutate())}
            >
              Закончить уборку
            </button>
          ) : null}
          {working && !t.checklist.length ? (
            <button type="button" className="btn btn-ghost" onClick={() => setFinishing(true)}>
              С фото или замечанием
            </button>
          ) : null}
          {t.assigneeId ? (
            <button type="button" className="btn btn-ghost" onClick={() => setSkipping(true)}>
              Пропустить
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost" onClick={onProblem}>
            Поломка
          </button>
        </div>
      ) : null}
      <FinishDialog task={finishing ? t : null} onClose={() => setFinishing(false)} onDone={refresh} />
      <SkipDialog task={skipping ? t : null} dnd={!!room?.dnd} onClose={() => setSkipping(false)} onDone={refresh} />
    </li>
  );
}

/** Закончить с чек-листом (генеральная), фото и замечанием для супервайзера. */
function FinishDialog({ task: incoming, onClose, onDone }: { task: Task | null; onClose: () => void; onDone: () => void }) {
  const task = useHeld(incoming);
  const photos = usePhotos('task_photo');
  const [checklist, setChecklist] = useState<Task['checklist']>([]);
  const [note, setNote] = useState('');
  const { reset } = photos;
  useEffect(() => {
    if (!incoming) return;
    setChecklist(incoming.checklist);
    setNote('');
    reset();
  }, [incoming, reset]);
  const finish = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}/finish', {
          params: { path: { ...pid(), id: task!.id } },
          body: { checklist, photoFileIds: photos.ids, note: note.trim() || undefined },
        }),
      ),
    onSuccess: (t) => {
      toast.info(`Номер ${t.roomNumber} убран`, 'Супервайзер проверит и отпустит его в продажу.');
      onDone();
      onClose();
    },
    onError: toast.fail,
  });
  const allDone = checklist.every((c) => c.done);
  return (
    <Dialog open={!!incoming} onClose={onClose} title={`Номер ${task?.roomNumber ?? ''}: уборка закончена`}>
      <div className="stack">
        {checklist.length ? (
          <div className="mt-checklist">
            {checklist.map((c, i) => (
              <label key={c.text} className="check">
                <input type="checkbox" checked={c.done} onChange={(e) => setChecklist((list) => list.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)))} />
                <span>{c.text}</span>
              </label>
            ))}
          </div>
        ) : null}
        <PhotoPicker photos={photos} />
        <Field label="Замечание" htmlFor="fin-note" optional hint="Что увидит супервайзер: например, «не хватило шампуня».">
          <textarea id="fin-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!allDone || photos.busy || finish.isPending} onClick={() => finish.mutate()}>
          {!allDone ? 'Отметьте все пункты' : photos.busy ? 'Фото загружается' : 'Готово'}
        </button>
      </div>
    </Dialog>
  );
}

function SkipDialog({ task: incoming, dnd, onClose, onDone }: { task: Task | null; dnd: boolean; onClose: () => void; onDone: () => void }) {
  const task = useHeld(incoming);
  const [reason, setReason] = useState<'dnd' | 'refused' | 'other'>('dnd');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!incoming) return;
    setReason(dnd ? 'dnd' : 'refused');
    setNote('');
  }, [incoming, dnd]);
  const skip = useMutation({
    mutationFn: () =>
      unwrap(api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}/skip', { params: { path: { ...pid(), id: task!.id } }, body: { reason, note: note.trim() || null } })),
    onSuccess: (t) => {
      toast.info(`Номер ${t.roomNumber}: уборка пропущена`);
      onDone();
      onClose();
    },
    onError: toast.fail,
  });
  return (
    <Dialog open={!!incoming} onClose={onClose} title={`Пропустить номер ${task?.roomNumber ?? ''}`}>
      <div className="stack">
        <Choices
          label="Почему"
          value={reason}
          onChange={setReason}
          options={[
            ['dnd', '«Не беспокоить»'],
            ['refused', 'Гость отказался'],
            ['other', 'Другое'],
          ]}
        />
        <Field label={reason === 'other' ? 'Что случилось' : 'Примечание'} htmlFor="skip-note" optional={reason !== 'other'}>
          <input id="skip-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={(reason === 'other' && !note.trim()) || skip.isPending} onClick={() => skip.mutate()}>
          Пропустить
        </button>
      </div>
    </Dialog>
  );
}
