import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { api, pid, unwrap } from '@/api/client';
import { useCan } from '@/auth/session';
import { openNewBooking } from '@/features/bookings/new-booking';
import { useOpenBooking } from '@/features/bookings/open';
import { phone, stayRange } from '@/lib/format';
import { BOOKING_STATUS } from '@/lib/labels';
import { PRIMARY_NAV, SECONDARY_NAV } from './nav';

let isOpen = false;
const listeners = new Set<() => void>();
export function openPalette() {
  isOpen = true;
  listeners.forEach((l) => l());
}
function closePalette() {
  isOpen = false;
  listeners.forEach((l) => l());
}

type Item = { id: string; group: string; label: string; hint?: string; run: () => void };

/**
 * Ctrl K: найти гостя, бронь (по номеру или фамилии), перейти в раздел,
 * начать бронь. Клавиатура - быстрее мыши на ресепшене.
 */
export function CommandPalette() {
  const open = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => isOpen,
  );
  if (!open) return null;
  return createPortal(<Palette />, document.body);
}

function Palette() {
  const can = useCan();
  const navigate = useNavigate();
  const openBooking = useOpenBooking();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const t = window.setTimeout(() => setTerm(q.trim()), 180);
    return () => window.clearTimeout(t);
  }, [q]);

  const guests = useQuery({
    queryKey: ['guests', pid().propertyId, 'palette', term],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests', { params: { path: pid(), query: { q: term, limit: 5 } } })),
    enabled: term.length >= 2 && can('guest.view'),
  });
  const bookings = useQuery({
    queryKey: ['bookings', pid().propertyId, 'palette', term],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/bookings', { params: { path: pid(), query: { q: term, limit: 5 } } })),
    enabled: term.length >= 2 && can('booking.view'),
  });

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const t = q.trim().toLowerCase();
    for (const b of bookings.data?.items ?? []) {
      out.push({
        id: `b-${b.id}`,
        group: 'Брони',
        label: `${b.number} · ${b.guestName}`,
        hint: `${b.roomNumber} · ${stayRange(b.arrival, b.departure)} · ${BOOKING_STATUS[b.status]?.toLowerCase()}`,
        run: () => openBooking(b.id),
      });
    }
    for (const g of guests.data?.items ?? []) {
      out.push({
        id: `g-${g.id}`,
        group: 'Гости',
        label: g.fullName,
        hint: `${phone(g.phone)}${g.stays ? ` · визитов ${g.stays}` : ''}`,
        run: () => void navigate({ to: '/guests/$guestId', params: { guestId: g.id } }),
      });
    }
    const actions: Item[] = [
      ...(can('booking.create') ? [{ id: 'a-new', group: 'Действия', label: 'Новая бронь', run: () => openNewBooking({}) }] : []),
      ...[...PRIMARY_NAV, ...SECONDARY_NAV]
        .filter((n) => can(...n.any))
        .map((n) => ({ id: `n-${n.to}`, group: 'Разделы', label: n.label, run: () => void navigate({ to: n.to }) })),
    ];
    out.push(...actions.filter((a) => !t || a.label.toLowerCase().includes(t)));
    return out;
  }, [q, bookings.data, guests.data, can, navigate, openBooking]);

  useEffect(() => setActive(0), [items.length, term]);

  const run = (i: Item | undefined) => {
    if (!i) return;
    closePalette();
    i.run();
  };

  let lastGroup = '';
  return (
    <>
      <div className="veil veil-dialog" data-shown="true" onClick={closePalette} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Поиск и команды">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Гость, телефон, номер брони или раздел"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closePalette();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
            if (e.key === 'Enter') run(items[active]);
          }}
          aria-activedescendant={items[active]?.id}
        />
        <ul role="listbox" className="palette-list">
          {items.map((i, idx) => {
            const header = i.group !== lastGroup ? i.group : null;
            lastGroup = i.group;
            return (
              <li key={i.id} role="presentation">
                {header ? <div className="palette-group">{header}</div> : null}
                <button
                  id={i.id}
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  className="palette-item"
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(i)}
                >
                  <span>{i.label}</span>
                  {i.hint ? <span className="muted">{i.hint}</span> : null}
                </button>
              </li>
            );
          })}
          {term.length >= 2 && !guests.isFetching && !bookings.isFetching && !items.some((i) => i.group !== 'Разделы' && i.group !== 'Действия') ? (
            <li className="palette-empty">Гостей и броней по «{term}» не нашли</li>
          ) : null}
        </ul>
      </div>
    </>
  );
}
