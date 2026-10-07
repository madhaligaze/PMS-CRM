import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useGuestPages } from '@/api/hooks';
import { useCan } from '@/auth/session';
import { Choices, Empty, Loading } from '@/components/ui/bits';
import { dayShort, phone } from '@/lib/format';
import { COUNTRY } from '@/lib/labels';
import { GuestFormModal } from './guest-form';
import { GuestsTabs } from './guests-tabs';
import './guests.css';

type Filter = '' | 'regular' | 'corporate' | 'vip' | 'blacklisted';
const FILTERS: [Filter, string][] = [
  ['', 'Все'],
  ['regular', 'Постоянные'],
  ['corporate', 'Корпоративные'],
  ['vip', 'VIP'],
  ['blacklisted', 'Чёрный список'],
];

export function GuestsPage() {
  const search = useSearch({ strict: false }) as { q?: string; filter?: Filter };
  const navigate = useNavigate();
  const can = useCan();
  const [q, setQ] = useState(search.q ?? '');
  const [term, setTerm] = useState(search.q ?? '');
  const [creating, setCreating] = useState(false);
  const filter: Filter = search.filter && FILTERS.some(([f]) => f === search.filter) ? search.filter : '';

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);

  const list = useGuestPages({ ...(term ? { q: term } : {}), ...(filter ? { filter } : {}) });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="page">
      <GuestsTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Гости</h1>
        </div>
        <div className="page-actions">
          <input className="input" style={{ width: 300 }} placeholder="ФИО, телефон или документ" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск гостя" />
          {can('guest.edit') ? (
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              Новый гость
            </button>
          ) : null}
        </div>
      </div>

      <div className="list-filter">
        <Choices
          label="Каких гостей показать"
          value={filter}
          onChange={(f) => void navigate({ to: '/guests', search: (prev: Record<string, unknown>) => ({ ...prev, filter: f || undefined }) } as never)}
          options={FILTERS}
        />
      </div>

      {list.isPending ? (
        <Loading />
      ) : !items.length ? (
        <Empty title={term ? 'Никого не нашли' : 'Здесь пока пусто'}>{term ? 'Проверьте написание или поищите по телефону.' : null}</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Гость</th>
                <th>Телефон</th>
                <th className="only-desktop">Гражданство</th>
                <th className="r">Визитов</th>
                <th>Последний визит</th>
                <th className="only-desktop">Компания</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} data-clickable onClick={() => void navigate({ to: '/guests/$guestId', params: { guestId: g.id } })}>
                  <td>
                    <Link to="/guests/$guestId" params={{ guestId: g.id }} className="guest-name" onClick={(e) => e.stopPropagation()}>
                      {g.fullName}
                    </Link>
                    {g.isVip ? <span className="tag tag-strong" style={{ marginLeft: 6 }}>VIP</span> : null}
                    {g.blacklisted ? <span className="tag tag-danger" style={{ marginLeft: 6 }}>чёрный список</span> : null}
                  </td>
                  <td className="nowrap">{phone(g.phone)}</td>
                  <td className="only-desktop">{g.citizenship ? (COUNTRY[g.citizenship] ?? g.citizenship) : '-'}</td>
                  <td className="r num">{g.stays || '-'}</td>
                  <td className="nowrap">{g.lastStay ? dayShort(g.lastStay) : <span className="muted">не был</span>}</td>
                  <td className="only-desktop">{g.companyName ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.hasNextPage ? (
            <div className="more">
              <button type="button" className="btn btn-ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Загружаем' : 'Показать ещё'}
              </button>
            </div>
          ) : null}
        </div>
      )}

      <GuestFormModal open={creating} onClose={() => setCreating(false)} onSaved={(g) => void navigate({ to: '/guests/$guestId', params: { guestId: g.id } })} />
    </div>
  );
}
