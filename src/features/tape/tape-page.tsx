import { useMutation } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { usePropertyInfo, useInvalidate, useTape, type S } from '@/api/hooks';
import { useCan } from '@/auth/session';
import { Choices, Empty, Loading } from '@/components/ui/bits';
import { ChevronGlyph, Dialog } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { openNewBooking } from '@/features/bookings/new-booking';
import { useOpenBooking } from '@/features/bookings/open';
import { addDays, diffDays, eachDay, isWeekend } from '@/lib/dates';
import { dayShort, monthName, plural, stayRange, weekdayShort } from '@/lib/format';
import { HK_STATUS } from '@/lib/labels';
import './tape.css';

type Tape = S['TapeChart'];
type Bar = Tape['bookings'][number];

const HEADER_W = 168;
const HEADER_W_MOBILE = 76;
const SPANS: [string, string][] = [
  ['14', '2 недели'],
  ['28', '4 недели'],
  ['56', '8 недель'],
];

type Drag = {
  bar: Bar;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  moved: boolean;
};

type Proposal = { bar: Bar; roomId: string; arrival: string; departure: string };

export function TapePage() {
  const search = useSearch({ strict: false }) as { from?: string; span?: number };
  const navigate = useNavigate();
  const prop = usePropertyInfo();
  const today = prop.data?.businessDate;
  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 760;
  const span = search.span && [14, 28, 56].includes(search.span) ? search.span : isNarrow ? 14 : 28;
  const from = search.from ?? (today ? addDays(today, -3) : undefined);

  const go = (next: { from?: string; span?: number }) =>
    void navigate({ to: '/tape', search: (prev: Record<string, unknown>) => ({ ...prev, ...next }) } as never);

  if (!today || !from) return <div className="page"><Loading /></div>;
  return <TapeView from={from} span={span} today={today} onNavigate={go} />;
}

function TapeView({ from, span, today, onNavigate }: { from: string; span: number; today: string; onNavigate: (n: { from?: string; span?: number }) => void }) {
  const to = addDays(from, span);
  const tape = useTape(from, to);
  const can = useCan();
  const openBooking = useOpenBooking();
  const invalidate = useInvalidate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [select, setSelect] = useState<{ roomId: string; a: number; b: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const headerW = width < 760 ? HEADER_W_MOBILE : HEADER_W;
  // День растягивается под ширину экрана; узкий экран прокручивается вбок.
  const dayW = Math.max(28, Math.min(84, Math.floor((width - headerW) / span)));
  const days = useMemo(() => eachDay(from, to), [from, to]);

  const data = tape.data;
  const rowsByType = useMemo(() => {
    if (!data) return [];
    return data.roomTypes.map((t) => ({ type: t, rooms: data.rooms.filter((r) => r.roomTypeId === t.id && r.isActive) })).filter((g) => g.rooms.length);
  }, [data]);
  const flatRooms = useMemo(() => rowsByType.flatMap((g) => (collapsed.has(g.type.id) ? [] : g.rooms)), [rowsByType, collapsed]);
  const barsByRoom = useMemo(() => {
    const m = new Map<string, Bar[]>();
    for (const b of data?.bookings ?? []) m.set(b.roomId, [...(m.get(b.roomId) ?? []), b]);
    return m;
  }, [data]);
  const blocksByRoom = useMemo(() => {
    const m = new Map<string, Tape['blocks']>();
    for (const b of data?.blocks ?? []) m.set(b.roomId, [...(m.get(b.roomId) ?? []), b]);
    return m;
  }, [data]);
  const arrivalsToday = useMemo(
    () => new Set((data?.bookings ?? []).filter((b) => b.arrival === today && (b.status === 'tentative' || b.status === 'confirmed')).map((b) => b.roomId)),
    [data, today],
  );

  const move = useMutation({
    mutationFn: (p: Proposal) =>
      unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/bookings/{id}', {
          params: { path: { ...pid(), id: p.bar.id } },
          headers: ifMatch(p.bar.version),
          body: {
            ...(p.roomId !== p.bar.roomId ? { roomId: p.roomId } : {}),
            ...(p.arrival !== p.bar.arrival ? { arrival: p.arrival } : {}),
            ...(p.departure !== p.bar.departure ? { departure: p.departure } : {}),
            reprice: 'keep',
          },
        }),
      ),
    onSuccess: (b) => {
      toast.info(`Бронь ${b.number} перенесена`, `${b.roomNumber}, ${stayRange(b.arrival, b.departure, true)}`);
      setProposal(null);
      void invalidate('tape', 'booking', 'bookings', 'dashboard', 'folio');
    },
    onError: (e) => {
      toast.fail(e);
      setProposal(null);
      void invalidate('tape');
    },
  });

  const canMove = can('booking.edit');
  const canCreate = can('booking.create');

  // Последнее состояние перетаскивания и выделения для обработчиков окна:
  // побочные действия (открыть бронь, форму) - вне функций-обновителей.
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const selectRef = useRef(select);
  selectRef.current = select;
  const dragging = drag !== null;
  const selecting = select !== null;

  // ── Перетаскивание брони ─────────────────────────────────────────────
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, dx: e.clientX - d.startX, dy: e.clientY - d.startY, moved: d.moved || Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 5 } : d));
    };
    const onUp = () => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (!d.moved) {
        openBooking(d.bar.id);
        return;
      }
      const shiftDays = Math.round(d.dx / dayW);
      const shiftRows = Math.round(d.dy / ROW_H);
      const idx = flatRooms.findIndex((r) => r.id === d.bar.roomId);
      const targetRoom = flatRooms[Math.max(0, Math.min(flatRooms.length - 1, idx + shiftRows))] ?? flatRooms[idx]!;
      let arrival = d.bar.arrival;
      let departure = d.bar.departure;
      if (d.mode === 'resize') {
        departure = addDays(d.bar.departure, shiftDays);
        if (departure <= arrival) departure = addDays(arrival, 1);
      } else if (d.bar.status !== 'checked_in') {
        arrival = addDays(d.bar.arrival, shiftDays);
        departure = addDays(d.bar.departure, shiftDays);
      }
      const roomId = d.mode === 'resize' ? d.bar.roomId : targetRoom.id;
      if (roomId !== d.bar.roomId || arrival !== d.bar.arrival || departure !== d.bar.departure) {
        setProposal({ bar: d.bar, roomId, arrival, departure });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, dayW, flatRooms, openBooking]);

  // ── Выделение пустых клеток - новая бронь ───────────────────────────
  useEffect(() => {
    if (!selecting) return;
    const onUp = () => {
      const s = selectRef.current;
      setSelect(null);
      if (!s) return;
      const a = Math.min(s.a, s.b);
      const b = Math.max(s.a, s.b);
      openNewBooking({ roomId: s.roomId, arrival: days[a]!, departure: addDays(days[b]!, 1) });
    };
    window.addEventListener('pointerup', onUp, { once: true });
    return () => window.removeEventListener('pointerup', onUp);
  }, [selecting, days]);

  const dayIndexAt = (e: RPointerEvent<HTMLElement>, track: HTMLElement) => {
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(days.length - 1, Math.floor((e.clientX - rect.left) / dayW)));
  };

  if (tape.isError) return <div className="page"><Empty title="Шахматка не загрузилась">Обновите страницу.</Empty></div>;

  const trackW = days.length * dayW;
  const todayIdx = diffDays(from, today);
  const totalRooms = data?.rooms.filter((r) => r.isActive).length ?? 0;

  return (
    <div className="page page-full tape-page">
      <div className="page-head tape-head">
        <div>
          <h1 className="page-title">Шахматка</h1>
          <p className="page-sub">
            {totalRooms} {plural(totalRooms, 'номер', 'номера', 'номеров')} · {dayShort(from)} - {dayShort(addDays(to, -1))}
          </p>
        </div>
        <div className="page-actions">
          <div className="row tape-nav">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Раньше" onClick={() => onNavigate({ from: addDays(from, -Math.round(span / 2)) })}>
              <ChevronGlyph dir="left" />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate({ from: addDays(today, -3) })}>
              Сегодня
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Позже" onClick={() => onNavigate({ from: addDays(from, Math.round(span / 2)) })}>
              <ChevronGlyph />
            </button>
          </div>
          <Choices label="Период" value={String(span)} options={SPANS} onChange={(v) => onNavigate({ span: Number(v) })} />
          {canCreate ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openNewBooking({})}>
              Новая бронь
            </button>
          ) : null}
        </div>
      </div>

      <Legend />

      <div ref={wrapRef} className="tape" style={{ ['--day-w' as string]: `${dayW}px`, ['--head-w' as string]: `${headerW}px` }} data-dragging={!!drag?.moved}>
        {tape.isPending && !data ? (
          <Loading />
        ) : (
          <div className="tape-grid" style={{ width: headerW + trackW }}>
            {/* Шапка: месяцы, дни, загрузка */}
            <div className="tape-head-row tape-months">
              <div className="tape-corner" />
              <div className="tape-track" style={{ width: trackW }}>
                {days.map((d, i) =>
                  i === 0 || d.endsWith('-01') ? (
                    <span key={d} className="tape-month" style={{ left: i * dayW }}>
                      {monthName(d)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
            <div className="tape-head-row tape-days">
              <div className="tape-corner tape-corner-label">Номер</div>
              <div className="tape-track" style={{ width: trackW }}>
                {days.map((d, i) => (
                  <div key={d} className="tape-day" data-weekend={isWeekend(d)} data-today={d === today} style={{ left: i * dayW, width: dayW }}>
                    <span className="wd">{weekdayShort(d)}</span>
                    <span className="dn">{Number(d.slice(8, 10))}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="tape-head-row tape-occ">
              <div className="tape-corner tape-corner-label">Занято</div>
              <div className="tape-track" style={{ width: trackW }}>
                {data?.days.map((d, i) => (
                  <div key={d.date} className="tape-occ-cell" data-full={d.occupied >= d.available && d.available > 0} style={{ left: i * dayW, width: dayW }}>
                    {dayW >= 40 ? `${d.occupied}/${d.available}` : d.occupied}
                  </div>
                ))}
              </div>
            </div>

            {/* Тело */}
            <div className="tape-body">
              <div className="tape-stripes" style={{ left: headerW, width: trackW }} aria-hidden="true">
                {days.map((d, i) => (isWeekend(d) ? <span key={d} className="tape-weekend" style={{ left: i * dayW, width: dayW }} /> : null))}
                {todayIdx >= 0 && todayIdx < days.length ? <span className="tape-today" style={{ left: todayIdx * dayW + dayW / 2 }} /> : null}
              </div>

              {rowsByType.map(({ type, rooms }) => (
                <div key={type.id} className="tape-group">
                  <button
                    type="button"
                    className="tape-group-head"
                    aria-expanded={!collapsed.has(type.id)}
                    onClick={() =>
                      setCollapsed((s) => {
                        const n = new Set(s);
                        if (n.has(type.id)) n.delete(type.id);
                        else n.add(type.id);
                        return n;
                      })
                    }
                  >
                    <span className="g-name">{type.name}</span>
                    <span className="g-count">{rooms.length}</span>
                  </button>
                  {collapsed.has(type.id)
                    ? null
                    : rooms.map((room) => {
                        const notReady = arrivalsToday.has(room.id) && room.hkStatus !== 'inspected';
                        return (
                          <div key={room.id} className="tape-row">
                            <div className="tape-room" data-not-ready={notReady}>
                              <span className="r-num">{room.number}</span>
                              <span className="r-meta">
                                {notReady ? <span className="danger">не готов</span> : <span>{HK_STATUS[room.hkStatus]?.toLowerCase()}</span>}
                                {room.dnd ? <span> · не беспокоить</span> : null}
                              </span>
                            </div>
                            <div
                              className="tape-track tape-cells"
                              style={{ width: trackW }}
                              onPointerDown={(e) => {
                                if (!canCreate || e.button !== 0 || (e.target as HTMLElement).closest('.bar, .block')) return;
                                const i = dayIndexAt(e, e.currentTarget);
                                if (days[i]! < today) return;
                                setSelect({ roomId: room.id, a: i, b: i });
                              }}
                              onPointerMove={(e) => {
                                if (!select || select.roomId !== room.id) return;
                                const i = dayIndexAt(e, e.currentTarget);
                                if (i !== select.b) setSelect({ ...select, b: i });
                              }}
                            >
                              {select && select.roomId === room.id ? (
                                <span
                                  className="tape-select"
                                  style={{ left: Math.min(select.a, select.b) * dayW, width: (Math.abs(select.b - select.a) + 1) * dayW }}
                                />
                              ) : null}
                              {(blocksByRoom.get(room.id) ?? []).map((k) => {
                                const pos = place(k.startsOn, k.endsOn, from, to, dayW, false);
                                return (
                                  <span key={k.id} className="block" style={{ left: pos.left, width: pos.width }} title={k.reason}>
                                    {pos.width > 64 ? 'Ремонт' : ''}
                                  </span>
                                );
                              })}
                              {(barsByRoom.get(room.id) ?? []).map((b) => {
                                const pos = place(b.arrival, b.departure, from, to, dayW, true);
                                const isDragged = drag?.bar.id === b.id && drag.moved;
                                const due = b.due ?? 0;
                                const problem = b.prepaymentOverdue || (b.status === 'checked_in' && b.departure <= today && due > 0);
                                const movable = canMove && b.status !== 'checked_out';
                                return (
                                  <button
                                    key={b.id}
                                    type="button"
                                    className="bar"
                                    data-status={b.status}
                                    data-problem={problem}
                                    data-cut-left={pos.cutLeft}
                                    data-cut-right={pos.cutRight}
                                    data-dragging={isDragged}
                                    style={{
                                      left: pos.left,
                                      width: isDragged && drag.mode === 'resize' ? Math.max(dayW, pos.width + drag.dx) : pos.width,
                                      ...(isDragged && drag.mode === 'move'
                                        ? { translate: `${b.status === 'checked_in' ? 0 : drag.dx}px ${drag.dy}px` }
                                        : {}),
                                    }}
                                    title={`${b.guestName} · ${stayRange(b.arrival, b.departure, true)}${problem ? (b.prepaymentOverdue ? ' · предоплата не внесена' : ' · не оплачено') : ''}`}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0) return;
                                      e.stopPropagation();
                                      if (!movable) {
                                        setDrag({ bar: b, mode: 'move', startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
                                        return;
                                      }
                                      const rect = e.currentTarget.getBoundingClientRect();
                                      const nearRight = rect.right - e.clientX < 10 && !pos.cutRight;
                                      setDrag({ bar: b, mode: nearRight ? 'resize' : 'move', startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, moved: false });
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') openBooking(b.id);
                                    }}
                                  >
                                    <span className="bar-name">{b.guestName}</span>
                                    {b.isVip && pos.width > 90 ? <span className="bar-tag">VIP</span> : null}
                                    {problem && pos.width > 120 ? <span className="bar-flag">{b.prepaymentOverdue ? 'предоплата' : 'долг'}</span> : null}
                                    {movable && !pos.cutRight ? <span className="bar-grip" aria-hidden="true" /> : null}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <MoveDialog proposal={proposal} rooms={data?.rooms ?? []} busy={move.isPending} onCancel={() => setProposal(null)} onConfirm={(p) => move.mutate(p)} />
    </div>
  );
}

const ROW_H = 40;

/**
 * Полоса брони: от середины дня заезда до середины дня выезда - так соседние
 * брони одного номера (выезд и заезд в один день) не налезают друг на друга.
 */
function place(start: string, end: string, from: string, to: string, dayW: number, halfDays: boolean) {
  const cutLeft = start < from;
  const cutRight = end > to;
  const s = cutLeft ? 0 : diffDays(from, start) * dayW + (halfDays ? dayW / 2 : 0);
  const e = cutRight ? diffDays(from, to) * dayW : diffDays(from, end) * dayW + (halfDays ? dayW / 2 : 0);
  return { left: s + 1, width: Math.max(6, e - s - 2), cutLeft, cutRight };
}

function Legend() {
  return (
    <div className="tape-legend" aria-label="Обозначения">
      <span className="lg">
        <i className="bar-sample" data-status="tentative" />
        предварительная
      </span>
      <span className="lg">
        <i className="bar-sample" data-status="confirmed" />
        подтверждена
      </span>
      <span className="lg">
        <i className="bar-sample" data-status="checked_in" />
        живёт
      </span>
      <span className="lg">
        <i className="bar-sample" data-status="checked_out" />
        выехал
      </span>
      <span className="lg">
        <i className="bar-sample block-sample" />
        ремонт
      </span>
      <span className="lg danger">красное - нужно действие</span>
      <span className="lg muted only-desktop">протяните по пустым дням - новая бронь; бронь можно перетащить, за правый край - продлить</span>
    </div>
  );
}

function MoveDialog({
  proposal,
  rooms,
  busy,
  onCancel,
  onConfirm,
}: {
  proposal: Proposal | null;
  rooms: Tape['rooms'];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (p: Proposal) => void;
}) {
  const p = proposal;
  const roomOf = (id: string) => rooms.find((r) => r.id === id)?.number ?? '';
  return (
    <Dialog open={!!p} onClose={onCancel} title={p ? `Изменить бронь ${p.bar.number}?` : ''}>
      {p ? (
        <>
          <dl className="facts" style={{ marginTop: 'var(--s-4)' }}>
            <dt>Гость</dt>
            <dd>{p.bar.guestName}</dd>
            {p.roomId !== p.bar.roomId ? (
              <>
                <dt>Номер</dt>
                <dd>
                  {roomOf(p.bar.roomId)} → <strong>{roomOf(p.roomId)}</strong>
                </dd>
              </>
            ) : null}
            {p.arrival !== p.bar.arrival || p.departure !== p.bar.departure ? (
              <>
                <dt>Даты</dt>
                <dd>
                  {stayRange(p.bar.arrival, p.bar.departure, true)} → <strong>{stayRange(p.arrival, p.departure, true)}</strong>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="muted" style={{ marginTop: 'var(--s-4)' }}>
            Ночи, что остаются в брони, сохраняют цену; новые считаются по тарифу. Если номер занят, система не даст сохранить.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>
              Оставить как было
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onConfirm(p)}>
              {busy ? 'Сохраняю' : 'Перенести'}
            </button>
          </div>
        </>
      ) : null}
    </Dialog>
  );
}
