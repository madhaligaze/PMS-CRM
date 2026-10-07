import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, pid, unwrap } from '@/api/client';
import type { S } from '@/api/hooks';
import { useCan } from '@/auth/session';
import { phone as fmtPhone, plural } from '@/lib/format';

export type GuestDraft = { lastName: string; firstName: string; middleName: string; phone: string; email: string };
export const emptyGuest: GuestDraft = { lastName: '', firstName: '', middleName: '', phone: '', email: '' };

export type GuestChoice = { kind: 'existing'; guest: S['GuestListItem'] } | { kind: 'new'; draft: GuestDraft };

function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Гость брони: найти в базе или завести нового. Пока вводится новый, система
 * ищет совпадения по телефону и ФИО - «одна запись гостя» начинается здесь.
 */
export function GuestPicker({ value, onChange }: { value: GuestChoice; onChange: (v: GuestChoice) => void }) {
  const can = useCan();
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const search = useQuery({
    queryKey: ['guests', pid().propertyId, 'picker', dq],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/guests', { params: { path: pid(), query: { q: dq, limit: 8 } } })),
    enabled: can('guest.view') && dq.length >= 2 && value.kind === 'new',
  });
  const draft = value.kind === 'new' ? value.draft : null;
  const dPhone = useDebounced(draft?.phone ?? '');
  const dLast = useDebounced(draft?.lastName ?? '');
  const match = useQuery({
    queryKey: ['guests', pid().propertyId, 'match', dPhone, dLast],
    queryFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/guests/match', { params: { path: pid() }, body: { phone: dPhone || null, lastName: dLast || null } })),
    enabled: can('guest.view') && value.kind === 'new' && dPhone.replace(/\D/g, '').length >= 7,
  });

  if (value.kind === 'existing') {
    const g = value.guest;
    return (
      <div className="picked-guest">
        <div>
          <div className="pg-name">
            {g.fullName}
            {g.isVip ? <span className="tag tag-strong">VIP</span> : null}
            {g.blacklisted ? <span className="tag tag-danger">чёрный список</span> : null}
          </div>
          <div className="muted">
            {fmtPhone(g.phone)} · {g.stays ? `${g.stays} ${plural(g.stays, 'визит', 'визита', 'визитов')}` : 'первый визит'}
          </div>
        </div>
        <button type="button" className="btn btn-quiet" onClick={() => onChange({ kind: 'new', draft: emptyGuest })}>
          Другой гость
        </button>
      </div>
    );
  }

  const set = (patch: Partial<GuestDraft>) => onChange({ kind: 'new', draft: { ...draft!, ...patch } });
  const matches = (match.data ?? []).filter((m) => m.strength === 'strong' || m.reasons.includes('phone'));

  return (
    <div className="stack">
      {can('guest.view') ? (
        <div className="field picker-search">
          <label className="field-label" htmlFor="guest-q">
            Найти в базе
          </label>
          <input id="guest-q" className="input" placeholder="Фамилия, телефон или номер документа" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          {dq.length >= 2 && search.data?.items.length ? (
            <ul role="list" className="picker-list">
              {search.data.items.map((g) => (
                <li key={g.id}>
                  <button type="button" onClick={() => onChange({ kind: 'existing', guest: g })}>
                    <span className="pl-name">{g.fullName}</span>
                    <span className="muted">
                      {fmtPhone(g.phone)}
                      {g.stays ? ` · ${g.stays} ${plural(g.stays, 'визит', 'визита', 'визитов')}` : ''}
                    </span>
                    {g.blacklisted ? <span className="tag tag-danger">чёрный список</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : dq.length >= 2 && search.isSuccess ? (
            <div className="field-hint">В базе не нашли - заведите нового гостя ниже.</div>
          ) : null}
        </div>
      ) : null}

      <div className="grid-2">
        <div className="field">
          <label className="field-label" htmlFor="g-last">
            Фамилия
          </label>
          <input id="g-last" className="input" value={draft!.lastName} onChange={(e) => set({ lastName: e.target.value })} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="g-first">
            Имя
          </label>
          <input id="g-first" className="input" value={draft!.firstName} onChange={(e) => set({ firstName: e.target.value })} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="g-phone">
            Телефон
          </label>
          <input id="g-phone" className="input" inputMode="tel" placeholder="+7 701 123 45 67" value={draft!.phone} onChange={(e) => set({ phone: e.target.value })} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="g-email">
            Почта <span className="opt">- необязательно</span>
          </label>
          <input id="g-email" className="input" type="email" value={draft!.email} onChange={(e) => set({ email: e.target.value })} autoComplete="off" />
        </div>
      </div>

      {matches.length ? (
        <div className="note">
          <div style={{ marginBottom: 6 }}>Похоже, этот гость уже есть в базе:</div>
          {matches.slice(0, 3).map((m) => (
            <div key={m.guest.id} className="row-between" style={{ padding: '4px 0' }}>
              <span>
                <strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{m.guest.fullName}</strong> · {fmtPhone(m.guest.phone)}
                {m.guest.stays ? ` · ${m.guest.stays} ${plural(m.guest.stays, 'визит', 'визита', 'визитов')}` : ''}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ kind: 'existing', guest: m.guest })}>
                Это он
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
