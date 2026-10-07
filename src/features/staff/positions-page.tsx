import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useAccessCatalog, useInvalidate, usePositions, type S } from '@/api/hooks';
import { CabinetTabs } from '@/app/cabinet-tabs';
import { useCan, useProperty } from '@/auth/session';
import { Empty, Field, Loading } from '@/components/ui/bits';
import { Dialog, Modal } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { History } from '@/features/bookings/history';
import { plural } from '@/lib/format';
import { RightsMatrix, rightsSummary, sameRights, type Catalog, type Rights } from './rights-matrix';
import './staff.css';

type Position = S['Position'];

/**
 * Должности: подпись и права по умолчанию для новых людей. Это не роли -
 * права живут у человека, должность их только подставляет при найме и
 * переводе. Правка должности людей не трогает; «Применить ко всем» - явно.
 */
export function PositionsPage() {
  const can = useCan();
  const positions = usePositions();
  const [open, setOpen] = useState<Position | 'new' | null>(null);

  return (
    <div className="page">
      <CabinetTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Должности</h1>
        </div>
        <div className="page-actions">
          {can('staff.manage') ? (
            <button type="button" className="btn btn-primary" onClick={() => setOpen('new')}>
              Новая должность
            </button>
          ) : null}
        </div>
      </div>
      {positions.isPending ? (
        <Loading />
      ) : !positions.data?.length ? (
        <Empty title="Должностей пока нет">Новая должность заводится и прямо при найме - впишите её в поле.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Должность</th>
                <th>Права по умолчанию</th>
                <th className="r">Работают</th>
              </tr>
            </thead>
            <tbody>
              {positions.data.map((p) => (
                <tr key={p.id} data-clickable onClick={() => setOpen(p)}>
                  <td>
                    {p.name}
                    {p.requireTotp ? <span className="sub">вход с кодом из приложения</span> : null}
                  </td>
                  <td>{rightsSummary(p.rights)}</td>
                  <td className="r num">{p.employees || <span className="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PositionModal position={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </div>
  );
}

function PositionModal({ position, open, onClose }: { position: Position | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const property = useProperty();
  const catalog = useAccessCatalog(open);
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [rights, setRights] = useState<Rights>({ sections: {}, powers: [] });
  const [requireTotp, setRequireTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyAsk, setApplyAsk] = useState(false);
  const [tab, setTab] = useState<'rights' | 'history'>('rights');
  const editable = can('staff.manage');
  const cap = property.access === 'staff' ? property.rights : null;
  // Применяют сохранённые права: с несохранённой правкой кнопки нет.
  const dirty = !!position && (name.trim() !== position.name || requireTotp !== position.requireTotp || !sameRights(rights, position.rights));

  useEffect(() => {
    if (!open) return;
    setName(position?.name ?? '');
    setRights(position?.rights ?? { sections: {}, powers: [] });
    setRequireTotp(position?.requireTotp ?? false);
    setError(null);
    setTab('rights');
  }, [open, position]);

  const fail = (e: unknown) => {
    if (isApiError(e)) setError(e.detail ? `${e.message}. ${e.detail}` : e.message);
    else toast.fail(e);
  };
  const save = useMutation({
    mutationFn: () =>
      position
        ? unwrap(api.PATCH('/api/v1/properties/{propertyId}/positions/{id}', { params: { path: { ...pid(), id: position.id } }, body: { name: name.trim(), rights, requireTotp } }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/positions', { params: { path: pid() }, body: { name: name.trim(), rights, requireTotp } })),
    onSuccess: (p) => {
      toast.info(position ? `Должность «${p.name}» сохранена` : `Должность «${p.name}» заведена`);
      void invalidate('staff');
      if (position && p.employees > 0) setApplyAsk(true);
      else onClose();
    },
    onError: fail,
  });
  const apply = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/positions/{id}/apply', { params: { path: { ...pid(), id: position!.id } } })),
    onSuccess: (r) => {
      toast.info(r.updated ? `Права обновлены у ${r.updated} ${plural(r.updated, 'сотрудника', 'сотрудников', 'сотрудников')}` : 'У всех на должности права и так такие');
      void invalidate('staff');
      setApplyAsk(false);
      onClose();
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/v1/properties/{propertyId}/positions/{id}', { params: { path: { ...pid(), id: position!.id } } })),
    onSuccess: () => {
      toast.info(`Должность «${position!.name}» убрана из списка`);
      void invalidate('staff');
      onClose();
    },
    onError: fail,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={position ? position.name : 'Новая должность'}
      subtitle={position ? (position.employees ? `Работают: ${position.employees}` : 'Никто не работает') : undefined}
      wide
      tall
      footer={
        editable ? (
          <>
            <button type="button" className="btn btn-primary" disabled={name.trim().length < 2 || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Сохраняем' : 'Сохранить'}
            </button>
            {position && position.employees > 0 && !dirty ? (
              <button type="button" className="btn btn-ghost" onClick={() => setApplyAsk(true)}>
                Применить ко всем на должности
              </button>
            ) : null}
            <span className="spacer" />
            {position && position.employees === 0 ? (
              <button type="button" className="btn btn-quiet danger-quiet" disabled={remove.isPending} onClick={() => remove.mutate()}>
                Убрать должность
              </button>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Название" htmlFor="pos-name">
            <input id="pos-name" className="input" value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Вход">
            <label className="check">
              <input type="checkbox" checked={requireTotp} disabled={!editable} onChange={(e) => setRequireTotp(e.target.checked)} />
              <span>Новым людям - только с кодом из приложения</span>
            </label>
          </Field>
        </div>
        {error ? (
          <div className="alert" role="alert">
            <strong>Не сохранено.</strong> {error}
          </div>
        ) : null}
        {position ? (
          <div className="tabs card-tabs" role="tablist">
            <button type="button" role="tab" className="tab" aria-selected={tab === 'rights'} onClick={() => setTab('rights')}>
              Права по умолчанию
            </button>
            <button type="button" role="tab" className="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>
              История
            </button>
          </div>
        ) : null}
        {tab === 'history' && position ? (
          <History entityType="position" entityId={position.id} />
        ) : catalog.data ? (
          <RightsMatrix catalog={catalog.data as Catalog} value={rights} onChange={setRights} cap={cap} readOnly={!editable} />
        ) : (
          <Loading />
        )}
      </div>

      <Dialog open={applyAsk} onClose={() => (setApplyAsk(false), onClose())} title={`Права должности - всем на ней?`}>
        <p>
          У {position?.employees ?? 0} {plural(position?.employees ?? 0, 'сотрудника', 'сотрудников', 'сотрудников')} на должности «{position?.name}» права станут такими: {rightsSummary(rights)}.
          Личные отличия пропадут.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={() => (setApplyAsk(false), onClose())}>
            Только должность
          </button>
          <button type="button" className="btn btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
            Применить ко всем
          </button>
        </div>
      </Dialog>
    </Modal>
  );
}
