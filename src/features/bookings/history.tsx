import { useEntityHistory, type HistoryEntity } from '@/api/hooks';
import { useProperty } from '@/auth/session';
import { Empty, Loading } from '@/components/ui/bits';
import { dateTime } from '@/lib/format';
import { describeAction, describeChange } from '@/features/audit/describe';

/** История изменений записи из журнала действий: кто, что, когда, было и стало. */
export function History({ entityType, entityId }: { entityType: HistoryEntity; entityId: string }) {
  const q = useEntityHistory(entityType, entityId);
  const property = useProperty();
  if (q.isPending) return <Loading />;
  if (!q.data?.length) return <Empty title="Изменений пока нет" />;
  return (
    <ol className="history" role="list">
      {q.data.map((e) => (
        <li key={e.id}>
          <div className="h-head">
            <span className="h-what">{describeAction(e.action)}</span>
            <span className="h-meta">
              {dateTime(e.at, property.timezone)} · {e.actorName}
            </span>
          </div>
          {e.changes ? (
            <ul role="list" className="h-changes">
              {Object.entries(e.changes).map(([k, v]) => (
                <li key={k}>{describeChange(k, [v[0], v[1]], { currency: property.currency, tz: property.timezone })}</li>
              ))}
            </ul>
          ) : null}
          {e.reason ? <div className="h-reason">Причина: {e.reason}</div> : null}
        </li>
      ))}
    </ol>
  );
}
