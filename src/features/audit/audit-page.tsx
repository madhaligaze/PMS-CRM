import { useEffect, useState } from 'react';
import { useAuditPages, useDirectory } from '@/api/hooks';
import { CabinetTabs } from '@/app/cabinet-tabs';
import { useProperty } from '@/auth/session';
import { Empty, Loading } from '@/components/ui/bits';
import { dayTitle, localDate, time } from '@/lib/format';
import { describeAction, describeChange } from './describe';
import './audit.css';

/** Что искать в журнале: человеческие названия видов записей. */
const ENTITIES: [string, string][] = [
  ['', 'Все записи'],
  ['booking', 'Брони'],
  ['guest', 'Гости'],
  ['payment', 'Оплаты'],
  ['shift', 'Кассовые смены'],
  ['room', 'Номера'],
  ['hk_task', 'Уборки'],
  ['maintenance', 'Ремонт'],
  ['user', 'Сотрудники и вход'],
  ['position', 'Должности'],
  ['property', 'Настройки гостиницы'],
];

/**
 * Журнал действий: кто, что и когда сделал - с прежним и новым значением.
 * Записи только добавляются: исправить или удалить их не может никто.
 */
export function AuditPage() {
  const property = useProperty();
  const tz = property.timezone;
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const people = useDirectory();
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const list = useAuditPages({
    ...(term ? { q: term } : {}),
    ...(entityType ? { entityType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const ctx = { currency: property.currency, tz };

  // Записи по дням гостиницы: заголовок дня, под ним действия по времени.
  const days: { day: string; rows: typeof items }[] = [];
  for (const it of items) {
    const day = localDate(it.at, tz);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(it);
    else days.push({ day, rows: [it] });
  }

  return (
    <div className="page">
      <CabinetTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Журнал действий</h1>
        </div>
      </div>
      <div className="audit-filters">
        <input className="input" placeholder="Бронь, гость, сотрудник или причина" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск по журналу" />
        <select className="select" value={entityType} onChange={(e) => setEntityType(e.target.value)} aria-label="Вид записи">
          {ENTITIES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {people.data ? (
          <select className="select" value={actorId} onChange={(e) => setActorId(e.target.value)} aria-label="Кто сделал">
            <option value="">Все сотрудники</option>
            {people.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.fullName}
              </option>
            ))}
          </select>
        ) : null}
        <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" />
        <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" />
      </div>

      {list.isPending ? (
        <Loading />
      ) : !items.length ? (
        <Empty title="Записей нет">Попробуйте другой период или уберите фильтры.</Empty>
      ) : (
        <>
          {days.map((d) => (
            <section key={d.day} className="audit-day">
              <h2 className="section-title">{dayTitle(d.day)}</h2>
              <ol role="list" className="audit-list">
                {d.rows.map((e) => (
                  <li key={e.id} className="audit-row">
                    <time className="audit-time">{time(e.at, tz)}</time>
                    <div className="audit-body">
                      <div className="audit-what">
                        <strong>{describeAction(e.action)}</strong>
                        {e.entityLabel ? <span> · {e.entityLabel}</span> : null}
                      </div>
                      {e.changes ? (
                        <ul role="list" className="audit-changes">
                          {Object.entries(e.changes).map(([k, v]) => (
                            <li key={k}>{describeChange(k, [v[0], v[1]], ctx)}</li>
                          ))}
                        </ul>
                      ) : null}
                      {e.reason ? <div className="audit-reason">Причина: {e.reason}</div> : null}
                    </div>
                    <span className="audit-who">{e.actorName}</span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          {list.hasNextPage ? (
            <div className="more">
              <button type="button" className="btn btn-ghost" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Загружаем' : 'Показать ещё'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
