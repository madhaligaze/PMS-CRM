import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { api, idem, pid, unwrap } from '@/api/client';
import { useHkBoard, useInvalidate, type S } from '@/api/hooks';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Empty, Field, Loading } from '@/components/ui/bits';
import { Dialog, Modal, useHeld } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { History } from '@/features/bookings/history';
import { zonedToIso } from '@/lib/dates';
import { dayTitle, plural, time } from '@/lib/format';
import { HK_STATUS, HK_TASK_KIND } from '@/lib/labels';
import { ProblemDialog } from './problem-dialog';
import './housekeeping.css';

type Board = S['HkBoard'];
type Room = Board['rooms'][number];
type Staff = Board['staff'];
type Task = S['HkTask'];
type Load = Map<string, number>;

/** Что сегодня с номером, словами. Имя гостя - только тем, кому его показывают. */
export function occupancyText(r: Room): string {
  const who = (name: string | null) => (name ? ` · ${name}` : '');
  switch (r.occupancy) {
    case 'turnover':
      return `Выезд и заезд${who(r.arrivalGuest)}`;
    case 'departure':
      return r.departureDone ? 'Гости выехали' : `Выезд сегодня${who(r.departureGuest)}`;
    case 'arrival':
      return `Заезд сегодня${who(r.arrivalGuest)}`;
    case 'occupied':
      return `Живут${who(r.inHouseGuest)}`;
    case 'blocked':
      return 'Снят с продажи';
    default:
      return 'Свободен';
  }
}

/** Где задача сейчас: ждёт, убирают, убрано, принято. */
export function taskStage(t: Task, tz: string): string {
  switch (t.status) {
    case 'open':
      return 'ждёт';
    case 'in_progress':
      return t.startedAt ? `убирают с ${time(t.startedAt, tz)}` : 'убирают';
    case 'done':
      return t.finishedAt ? `убрано в ${time(t.finishedAt, tz)}, проверить` : 'убрано, проверить';
    case 'inspected':
      return 'принято';
    case 'skipped':
      return `пропущено${t.skipReason ? `: ${t.skipReason.toLowerCase()}` : ''}`;
    default:
      return 'отменено';
  }
}

/** «Гүлнар Иманғалиева» → «Гүлнар»: сотрудников зовут по имени, на плитке его хватает. */
const shortName = (full: string | null) => (full ? (full.split(' ')[0] ?? full) : null);

/** Номер нужен к заезду сегодня, а он ещё не проверен. */
const urgent = (r: Room) => (r.occupancy === 'arrival' || r.occupancy === 'turnover') && r.hkStatus !== 'inspected';
const live = (t: Task) => t.status !== 'cancelled';
const active = (t: Task) => t.status === 'open' || t.status === 'in_progress';

/** Сколько незакрытых задач у каждой горничной: видно при распределении. */
function loadOf(board: Board): Load {
  const load: Load = new Map();
  for (const t of board.rooms.flatMap((r) => r.tasks)) if (active(t) && t.assigneeId) load.set(t.assigneeId, (load.get(t.assigneeId) ?? 0) + 1);
  return load;
}

type RoomFilter = 'all' | 'todo' | 'check' | 'ready' | 'repair';

/**
 * Хозслужба. В продажу идёт только проверенный номер, поэтому доска ведёт
 * каждый номер от «грязного» через уборку к проверке. Номера стоят на своих
 * местах по этажам: супервайзер помнит, где какой, а сегодняшний заезд в
 * неготовом номере выделен рамкой, а не перестановкой.
 */
export function HousekeepingPage() {
  const board = useHkBoard();
  const can = useCan();
  const [tab, setTab] = useState<'rooms' | 'tasks'>('rooms');
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState(false);

  if (board.isPending) return <div className="page"><Loading /></div>;
  if (board.isError || !board.data) return <div className="page"><Empty title="Доска не загрузилась">Обновите страницу.</Empty></div>;
  const b = board.data;
  const tasks = b.rooms.flatMap((r) => r.tasks).filter(live);
  const load = loadOf(b);
  const count = (f: (r: Room) => boolean) => b.rooms.filter(f).length;
  const overdue = tasks.filter((t) => t.overdue).length;
  const unassigned = tasks.filter((t) => active(t) && !t.assigneeId).length;

  return (
    <div className="page hk">
      <div className="page-head">
        <div>
          <h1 className="page-title">Хозслужба</h1>
          <p className="page-sub">{dayTitle(b.businessDate)}</p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setProblem(true)}>
            Сообщить о поломке
          </button>
          {can('hk.assign') ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Новая задача
            </button>
          ) : null}
        </div>
      </div>

      <div className="figures hk-figures">
        <Figure v={count((r) => r.hkStatus === 'dirty' || r.hkStatus === 'cleaning')} l="ждут уборки" />
        <Figure v={count((r) => r.hkStatus === 'clean')} l="ждут проверки" />
        <Figure v={count((r) => r.hkStatus === 'inspected')} l="готовы к заселению" />
        <Figure v={count(urgent)} l="к заезду, ещё не готовы" />
        {can('hk.assign') && unassigned ? <Figure v={unassigned} l={plural(unassigned, 'задача без горничной', 'задачи без горничной', 'задач без горничной')} /> : null}
        {overdue ? <Figure v={overdue} l="просрочено" alert /> : null}
      </div>

      <div className="tabs page-tabs hk-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'rooms'} onClick={() => setTab('rooms')}>
          Номера
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'tasks'} onClick={() => setTab('tasks')}>
          Задачи<span className="count">{tasks.length}</span>
        </button>
      </div>

      {tab === 'rooms' ? <RoomsBoard board={b} onOpen={setOpenRoom} /> : <TasksList board={b} load={load} onOpenRoom={setOpenRoom} />}

      <RoomModal room={b.rooms.find((r) => r.id === openRoom) ?? null} board={b} load={load} onClose={() => setOpenRoom(null)} />
      <NewTaskDialog open={creating} rooms={b.rooms} staff={b.staff} businessDate={b.businessDate} onClose={() => setCreating(false)} />
      <ProblemDialog open={problem} onClose={() => setProblem(false)} />
    </div>
  );
}

function Figure({ v, l, alert }: { v: number; l: string; alert?: boolean }) {
  return (
    <div className="figure" data-alert={alert || undefined}>
      <span className="v">{v}</span>
      <span className="l">{l}</span>
    </div>
  );
}

function RoomsBoard({ board, onOpen }: { board: Board; onOpen: (id: string) => void }) {
  const property = useProperty();
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [maid, setMaid] = useState('');
  const rooms = useMemo(
    () =>
      board.rooms.filter((r) => {
        if (maid && !r.tasks.some((t) => live(t) && t.assigneeId === maid)) return false;
        if (filter === 'todo') return r.hkStatus === 'dirty' || r.hkStatus === 'cleaning';
        if (filter === 'check') return r.hkStatus === 'clean';
        if (filter === 'ready') return r.hkStatus === 'inspected';
        if (filter === 'repair') return r.hkStatus === 'repair' || r.occupancy === 'blocked';
        return true;
      }),
    [board.rooms, filter, maid],
  );
  const floors = [...new Set(rooms.map((r) => r.floor ?? 0))].sort((x, y) => x - y);
  return (
    <>
      <div className="hk-filters list-filter">
        <Choices
          label="Какие номера показать"
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'Все'],
            ['todo', 'Ждут уборки'],
            ['check', 'Ждут проверки'],
            ['ready', 'Готовы'],
            ['repair', 'Ремонт'],
          ]}
        />
        {board.staff.length ? <MaidFilter staff={board.staff} value={maid} onChange={setMaid} /> : null}
      </div>
      {!rooms.length ? (
        <Empty title="Таких номеров сейчас нет" />
      ) : (
        floors.map((floor) => (
          <section key={floor} className="hk-floor">
            {floors.length > 1 || floor ? <h2 className="hk-floor-title">{floor ? `${floor} этаж` : 'Без этажа'}</h2> : null}
            <div className="hk-grid">
              {rooms
                .filter((r) => (r.floor ?? 0) === floor)
                .map((r) => (
                  <RoomTile key={r.id} room={r} tz={property.timezone} onOpen={() => onOpen(r.id)} />
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}

function MaidFilter({ staff, value, onChange }: { staff: Staff; value: string; onChange: (v: string) => void }) {
  return (
    <select className="select hk-maid" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Горничная">
      <option value="">Все горничные</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function RoomTile({ room: r, tz, onOpen }: { room: Room; tz: string; onOpen: () => void }) {
  const tasks = r.tasks.filter(live);
  return (
    <button type="button" className="hk-tile" data-status={r.hkStatus} data-urgent={urgent(r) || undefined} onClick={onOpen}>
      <span className="hk-tile-head">
        <span className="hk-num">{r.number}</span>
        <span className="hk-type">{r.roomTypeName}</span>
      </span>
      <span className="hk-status">
        {HK_STATUS[r.hkStatus]}
        {r.dnd ? <span className="hk-dnd"> · не беспокоить</span> : null}
      </span>
      <span className="hk-occ">{occupancyText(r)}</span>
      {tasks.map((t) => (
        <span key={t.id} className="hk-task" data-overdue={t.overdue || undefined}>
          {HK_TASK_KIND[t.kind]} · {shortName(t.assigneeName) ?? 'без горничной'} · {taskStage(t, tz)}
        </span>
      ))}
    </button>
  );
}

type TaskFilter = 'all' | 'free' | 'work' | 'check' | 'closed';
const STATUS_ORDER: Record<Task['status'], number> = { done: 0, open: 1, in_progress: 2, inspected: 3, skipped: 4, cancelled: 5 };

/** Задачи дня списком: распределить по горничным и принять убранное, не открывая номеров. */
function TasksList({ board, load, onOpenRoom }: { board: Board; load: Load; onOpenRoom: (id: string) => void }) {
  const property = useProperty();
  const can = useCan();
  const actions = useTaskActions();
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [maid, setMaid] = useState('');
  const [returning, setReturning] = useState<Task | null>(null);
  const all = board.rooms.flatMap((r) => r.tasks).filter(live);
  const rows = all
    .filter((t) => {
      if (maid && t.assigneeId !== maid) return false;
      if (filter === 'free') return active(t) && !t.assigneeId;
      if (filter === 'work') return active(t);
      if (filter === 'check') return t.status === 'done';
      if (filter === 'closed') return t.status === 'inspected' || t.status === 'skipped';
      return true;
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.roomNumber.localeCompare(b.roomNumber, 'ru', { numeric: true }));
  const roomOf = (t: Task) => board.rooms.find((r) => r.id === t.roomId);
  return (
    <>
      <div className="hk-filters list-filter">
        <Choices
          label="Какие задачи показать"
          value={filter}
          onChange={setFilter}
          options={[
            ['all', 'Все'],
            ['free', 'Без горничной'],
            ['work', 'Не сделаны'],
            ['check', 'Проверить'],
            ['closed', 'Закрыты'],
          ]}
        />
        {board.staff.length ? <MaidFilter staff={board.staff} value={maid} onChange={setMaid} /> : null}
      </div>
      {!rows.length ? (
        <Empty title={all.length ? 'Таких задач нет' : 'Задач на сегодня нет'} />
      ) : (
        <div className="table-wrap">
          <table className="table hk-table">
            <thead>
              <tr>
                <th>Номер</th>
                <th>Задача</th>
                <th>Срок</th>
                <th>Горничная</th>
                <th>Ход</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const room = roomOf(t);
                return (
                  <tr key={t.id}>
                    <td>
                      <button type="button" className="link-btn hk-room-link" onClick={() => onOpenRoom(t.roomId)}>
                        {t.roomNumber}
                      </button>
                    </td>
                    <td>
                      {HK_TASK_KIND[t.kind]}
                      {room && urgent(room) ? <span className="sub strong">заезд сегодня</span> : null}
                      {t.note ? <span className="sub">{t.note}</span> : null}
                    </td>
                    <td className={`num${t.overdue ? ' danger' : ''}`}>{t.dueAt && active(t) ? time(t.dueAt, property.timezone) : '-'}</td>
                    <td>
                      {can('hk.assign') && active(t) ? (
                        <AssignSelect task={t} staff={board.staff} load={load} busy={actions.assign.isPending} onAssign={(assigneeId) => actions.assign.mutate({ task: t, assigneeId })} />
                      ) : (
                        (t.assigneeName ?? '-')
                      )}
                    </td>
                    <td className={t.status === 'done' ? 'strong' : t.status === 'inspected' || t.status === 'skipped' ? 'muted' : undefined}>{taskStage(t, property.timezone)}</td>
                    <td className="r">
                      {can('hk.inspect') && t.status === 'done' ? (
                        <span className="row hk-inspect">
                          <button type="button" className="btn btn-primary btn-sm" disabled={actions.inspect.isPending} onClick={() => actions.inspect.mutate({ task: t, ok: true })}>
                            Принять
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReturning(t)}>
                            Вернуть
                          </button>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <ReturnDialog
        task={returning}
        busy={actions.inspect.isPending}
        onClose={() => setReturning(null)}
        onConfirm={(note) => returning && actions.inspect.mutate({ task: returning, ok: false, note }, { onSuccess: () => setReturning(null) })}
      />
    </>
  );
}

function AssignSelect({ task, staff, load, busy, onAssign }: { task: Task; staff: Staff; load: Load; busy: boolean; onAssign: (id: string | null) => void }) {
  return (
    <select className="select hk-assign" value={task.assigneeId ?? ''} aria-label={`Горничная, номер ${task.roomNumber}`} disabled={busy} onChange={(e) => onAssign(e.target.value || null)}>
      <option value="">Не назначена</option>
      {staff.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
          {load.get(s.id) ? ` · ${load.get(s.id)}` : ''}
        </option>
      ))}
      {/* Назначенная раньше горничная могла уволиться или лишиться уборки в правах: имя остаётся видно. */}
      {task.assigneeId && !staff.some((s) => s.id === task.assigneeId) ? <option value={task.assigneeId}>{task.assigneeName}</option> : null}
    </select>
  );
}

/** Назначить, принять, вернуть: общие для списка задач и окна номера. */
function useTaskActions() {
  const invalidate = useInvalidate();
  const refresh = () => void invalidate('hk', 'tape', 'dashboard', 'readiness', 'booking');
  const assign = useMutation({
    mutationFn: ({ task, assigneeId }: { task: Task; assigneeId: string | null }) =>
      unwrap(api.PATCH('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}', { params: { path: { ...pid(), id: task.id } }, body: { assigneeId } })),
    onSuccess: (t) => {
      toast.info(t.assigneeName ? `Номер ${t.roomNumber}: ${t.assigneeName}` : `Номер ${t.roomNumber}: горничная снята`);
      refresh();
    },
    onError: toast.fail,
  });
  const inspect = useMutation({
    mutationFn: ({ task, ok, note }: { task: Task; ok: boolean; note?: string }) =>
      unwrap(api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks/{id}/inspect', { params: { path: { ...pid(), id: task.id } }, body: { ok, note: note ?? null } })),
    onSuccess: (t) => {
      toast.info(t.status === 'inspected' ? `Номер ${t.roomNumber} принят, можно заселять` : `Номер ${t.roomNumber} возвращён на доуборку`);
      refresh();
    },
    onError: toast.fail,
  });
  return { assign, inspect };
}

function RoomModal({ room: incoming, board, load, onClose }: { room: Room | null; board: Board; load: Load; onClose: () => void }) {
  const room = useHeld(incoming);
  const can = useCan();
  const property = useProperty();
  const invalidate = useInvalidate();
  const actions = useTaskActions();
  const [tab, setTab] = useState<'now' | 'history'>('now');
  const [returning, setReturning] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState(false);
  const roomId = room?.id;
  useEffect(() => setTab('now'), [roomId]);
  const refresh = (msg: string) => {
    toast.info(msg);
    void invalidate('hk', 'tape', 'dashboard', 'readiness', 'rooms');
  };
  const status = useMutation({
    mutationFn: (s: 'dirty' | 'clean' | 'inspected') => unwrap(api.POST('/api/v1/properties/{propertyId}/rooms/{id}/hk-status', { params: { path: { ...pid(), id: roomId! } }, body: { status: s } })),
    onSuccess: (_d, s) => refresh(`Номер ${room?.number}: ${(HK_STATUS[s] ?? s).toLowerCase()}`),
    onError: toast.fail,
  });
  const dnd = useMutation({
    mutationFn: (on: boolean) => unwrap(api.POST('/api/v1/properties/{propertyId}/rooms/{id}/dnd', { params: { path: { ...pid(), id: roomId! } }, body: { on } })),
    onSuccess: (_d, on) => refresh(on ? `Номер ${room?.number}: «не беспокоить»` : `Номер ${room?.number}: «не беспокоить» снято`),
    onError: toast.fail,
  });
  if (!room) return null;
  const tasks = room.tasks.filter(live);
  const guestsInside = room.occupancy === 'occupied' || room.occupancy === 'turnover' || (room.occupancy === 'departure' && !room.departureDone);
  return (
    <Modal
      open={!!incoming}
      onClose={onClose}
      title={`Номер ${room.number}`}
      subtitle={[room.roomTypeName, room.floor ? `${room.floor} этаж` : null].filter(Boolean).join(' · ')}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setProblem(true)}>
            Сообщить о поломке
          </button>
          <span className="spacer" />
          {can('hk.assign') ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Новая задача
            </button>
          ) : null}
        </>
      }
    >
      <div className="tabs card-tabs" role="tablist">
        <button type="button" role="tab" className="tab" aria-selected={tab === 'now'} onClick={() => setTab('now')}>
          Сегодня
        </button>
        <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
          История
        </button>
      </div>
      {tab === 'history' ? (
        <History entityType="room" entityId={room.id} />
      ) : (
        <div className="stack">
          <dl className="facts">
            <dt>Состояние</dt>
            <dd>
              <strong>{HK_STATUS[room.hkStatus]}</strong>
              <span className="muted"> · с {time(room.hkStatusAt, property.timezone)}</span>
            </dd>
            <dt>Сегодня</dt>
            <dd className={urgent(room) ? 'strong' : undefined}>
              {occupancyText(room)}
              {urgent(room) ? ' · номер ещё не готов' : ''}
            </dd>
          </dl>

          {room.hkStatus === 'repair' ? <p className="note">Номер на ремонте. В уборку и продажу его вернёт закрытие заявки в разделе «Ремонт».</p> : null}

          <section>
            <h3 className="hk-sub">Задачи</h3>
            {tasks.length ? (
              <ul role="list" className="hk-tasks">
                {tasks.map((t) => (
                  <li key={t.id} className="hk-task-row">
                    <div className="hk-task-what">
                      <strong>{HK_TASK_KIND[t.kind]}</strong>
                      <span className={t.overdue ? 'danger' : 'muted'}>
                        {' '}
                        · {taskStage(t, property.timezone)}
                        {t.dueAt && active(t) ? ` · срок ${time(t.dueAt, property.timezone)}` : ''}
                        {t.overdue ? ', просрочено' : ''}
                      </span>
                      {t.note ? <div className="muted">{t.note}</div> : null}
                      {!can('hk.assign') || !active(t) ? <div className="muted">{t.assigneeName ?? 'Горничная не назначена'}</div> : null}
                    </div>
                    <div className="row">
                      {can('hk.assign') && active(t) ? (
                        <AssignSelect task={t} staff={board.staff} load={load} busy={actions.assign.isPending} onAssign={(assigneeId) => actions.assign.mutate({ task: t, assigneeId })} />
                      ) : null}
                      {can('hk.inspect') && t.status === 'done' ? (
                        <>
                          <button type="button" className="btn btn-primary btn-sm" disabled={actions.inspect.isPending} onClick={() => actions.inspect.mutate({ task: t, ok: true })}>
                            Принять
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReturning(t)}>
                            Вернуть
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">На сегодня задач нет.</p>
            )}
          </section>

          {can('hk.status') && room.hkStatus !== 'repair' ? (
            <Field label="Состояние вручную" hint="Если номер убрали или проверили без задачи. Смена попадёт в историю номера.">
              <Choices
                label="Состояние номера"
                value={room.hkStatus === 'cleaning' ? 'dirty' : room.hkStatus}
                onChange={(s) => s !== room.hkStatus && status.mutate(s as 'dirty' | 'clean' | 'inspected')}
                options={[
                  ['dirty', 'Грязный'],
                  ['clean', 'Убран'],
                  ['inspected', 'Проверен'],
                ]}
              />
            </Field>
          ) : null}

          {guestsInside || room.dnd ? (
            <label className="check">
              <input type="checkbox" checked={room.dnd} disabled={dnd.isPending} onChange={(e) => dnd.mutate(e.target.checked)} />
              <span>На двери «Не беспокоить»</span>
            </label>
          ) : null}
        </div>
      )}
      <ReturnDialog
        task={returning}
        busy={actions.inspect.isPending}
        onClose={() => setReturning(null)}
        onConfirm={(note) => returning && actions.inspect.mutate({ task: returning, ok: false, note }, { onSuccess: () => setReturning(null) })}
      />
      <NewTaskDialog open={creating} rooms={[room]} staff={board.staff} businessDate={board.businessDate} onClose={() => setCreating(false)} />
      <ProblemDialog open={problem} onClose={() => setProblem(false)} roomId={room.id} roomNumber={room.number} />
    </Modal>
  );
}

function ReturnDialog({ task, busy, onClose, onConfirm }: { task: Task | null; busy: boolean; onClose: () => void; onConfirm: (note: string) => void }) {
  const held = useHeld(task);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (task) setNote('');
  }, [task]);
  return (
    <Dialog open={!!task} onClose={onClose} title={`Вернуть номер ${held?.roomNumber ?? ''} на доуборку`}>
      <Field label="Что доделать" htmlFor="ret-note" hint="Горничная увидит это в своей задаче.">
        <textarea id="ret-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: пыль на подоконнике, нет полотенец" data-autofocus />
      </Field>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!note.trim() || busy} onClick={() => onConfirm(note.trim())}>
          Вернуть на доуборку
        </button>
      </div>
    </Dialog>
  );
}

/** Задача сверх плана дня: по просьбе гостя или генеральная. */
function NewTaskDialog({ open, rooms, staff, businessDate, onClose }: { open: boolean; rooms: Room[]; staff: Staff; businessDate: string; onClose: () => void }) {
  const property = useProperty();
  const invalidate = useInvalidate();
  const single = rooms.length === 1 ? rooms[0]! : null;
  const [roomId, setRoomId] = useState('');
  const [kind, setKind] = useState<'request' | 'general'>('request');
  const [assigneeId, setAssigneeId] = useState('');
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!open) return;
    setRoomId(single?.id ?? '');
    setKind('request');
    setAssigneeId('');
    setDue('');
    setNote('');
  }, [open, single?.id]);
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST('/api/v1/properties/{propertyId}/housekeeping/tasks', {
          params: { path: pid() },
          headers: idem(),
          body: {
            roomId,
            kind,
            assigneeId: assigneeId || null,
            note: note.trim() || null,
            ...(due ? { dueAt: zonedToIso(businessDate, due, property.timezone) } : {}),
          },
        }),
      ),
    onSuccess: (t) => {
      toast.info(`Задача на номер ${t.roomNumber}`, t.assigneeName ? `Поручено: ${t.assigneeName}` : 'Без горничной: возьмёт любая свободная.');
      void invalidate('hk', 'dashboard');
      onClose();
    },
    onError: toast.fail,
  });
  return (
    <Dialog open={open} onClose={onClose} title={single ? `Новая задача · номер ${single.number}` : 'Новая задача уборки'} wide>
      <div className="stack">
        <Field label="Что сделать">
          <Choices
            label="Вид задачи"
            value={kind}
            onChange={setKind}
            options={[
              ['request', 'По просьбе гостя'],
              ['general', 'Генеральная уборка'],
            ]}
          />
        </Field>
        <div className="grid-3">
          {single ? null : (
            <Field label="Номер" htmlFor="nt-room">
              <select id="nt-room" className="select" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
                <option value="">Выберите</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} · {r.roomTypeName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Горничная" htmlFor="nt-maid" optional>
            <select id="nt-maid" className="select" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Любая свободная</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Сделать к" htmlFor="nt-due" optional>
            <input id="nt-due" type="time" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
        </div>
        <Field label="Что именно" htmlFor="nt-note" optional>
          <input id="nt-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Например: поменять полотенца, принести детскую кроватку" maxLength={500} />
        </Field>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Отмена
        </button>
        <button type="button" className="btn btn-primary" disabled={!roomId || create.isPending} onClick={() => create.mutate()}>
          Создать задачу
        </button>
      </div>
    </Dialog>
  );
}
