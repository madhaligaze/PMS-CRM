import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { useCompanies, useInvalidate, type S } from '@/api/hooks';
import { useCan } from '@/auth/session';
import { Empty, Field, Loading } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { dash, phone } from '@/lib/format';
import { isValidIin } from '@/lib/iin';
import { GuestsTabs } from './guests-tabs';
import './guests.css';

type Company = S['Company'];

/** Компании-клиенты: корпоративные гости, заказчики мероприятий, плательщики по счёту. */
export function CompaniesPage() {
  const can = useCan();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<Company | 'new' | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const list = useCompanies(term || undefined);

  return (
    <div className="page">
      <GuestsTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">Компании</h1>
        </div>
        <div className="page-actions">
          <input className="input" style={{ width: 260 }} placeholder="Найти компанию" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск компании" />
          {can('company.edit') ? (
            <button type="button" className="btn btn-primary" onClick={() => setOpen('new')}>
              Новая компания
            </button>
          ) : null}
        </div>
      </div>
      {list.isPending ? (
        <Loading />
      ) : !list.data?.items.length ? (
        <Empty title={term ? 'Ничего не нашли' : 'Компаний пока нет'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Компания</th>
                <th>БИН</th>
                <th>Контакт</th>
                <th className="r">Гостей</th>
                <th className="r">Броней</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((c) => (
                <tr key={c.id} data-clickable onClick={() => setOpen(c)}>
                  <td>
                    {c.name}
                    {c.notes ? <span className="sub">{c.notes}</span> : null}
                  </td>
                  <td className="num">{dash(c.taxId)}</td>
                  <td>
                    {dash(c.contactName)}
                    <span className="sub">
                      {phone(c.phone)}
                      {c.email ? ` · ${c.email}` : ''}
                    </span>
                  </td>
                  <td className="r num">{c.guests}</td>
                  <td className="r num">{c.bookings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CompanyModal company={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </div>
  );
}

function CompanyModal({ company, open, onClose }: { company: Company | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const invalidate = useInvalidate();
  const [form, setForm] = useState({ name: '', taxId: '', legalAddress: '', phone: '', email: '', contactName: '', notes: '' });
  useEffect(() => {
    if (open)
      setForm({
        name: company?.name ?? '',
        taxId: company?.taxId ?? '',
        legalAddress: company?.legalAddress ?? '',
        phone: company?.phone ?? '',
        email: company?.email ?? '',
        contactName: company?.contactName ?? '',
        notes: company?.notes ?? '',
      });
  }, [open, company]);
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));
  const guests = useQuery({
    queryKey: ['companies', pid().propertyId, company?.id, 'guests'],
    queryFn: () => unwrap(api.GET('/api/v1/properties/{propertyId}/companies/{id}/guests', { params: { path: { ...pid(), id: company!.id } } })),
    enabled: !!company && open && can('guest.view'),
  });
  const body = () => ({
    name: form.name.trim(),
    taxId: form.taxId.trim() || null,
    legalAddress: form.legalAddress.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    contactName: form.contactName.trim() || null,
    notes: form.notes.trim() || null,
  });
  const save = useMutation({
    mutationFn: () =>
      company
        ? unwrap(api.PATCH('/api/v1/properties/{propertyId}/companies/{id}', { params: { path: { ...pid(), id: company.id } }, headers: ifMatch(company.version), body: body() }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/companies', { params: { path: pid() }, body: body() })),
    onSuccess: () => {
      toast.info(company ? 'Компания сохранена' : 'Компания добавлена');
      void invalidate('companies');
      onClose();
    },
    onError: toast.fail,
  });
  const editable = can('company.edit');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={company ? company.name : 'Новая компания'}
      footer={
        editable ? (
          <>
            <button type="button" className="btn btn-primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
              Сохранить
            </button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Отмена
            </button>
          </>
        ) : undefined
      }
    >
      <div className="stack">
        <div className="grid-2">
          <Field label="Название" htmlFor="co-name">
            <input id="co-name" className="input" value={form.name} disabled={!editable} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field
            label="БИН"
            htmlFor="co-tax"
            optional
            hint="Для ИП - ИИН владельца"
            error={form.taxId.length === 12 && !isValidIin(form.taxId) ? 'Контрольная цифра не сходится: сверьте номер с документами компании' : undefined}
          >
            <input
              id="co-tax"
              className="input num"
              inputMode="numeric"
              maxLength={12}
              value={form.taxId}
              disabled={!editable}
              onChange={(e) => set({ taxId: e.target.value.replace(/\D+/g, '').slice(0, 12) })}
            />
          </Field>
          <Field label="Контактное лицо" htmlFor="co-contact" optional>
            <input id="co-contact" className="input" value={form.contactName} disabled={!editable} onChange={(e) => set({ contactName: e.target.value })} />
          </Field>
          <Field label="Телефон" htmlFor="co-phone" optional>
            <input id="co-phone" className="input" value={form.phone} disabled={!editable} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Почта" htmlFor="co-email" optional>
            <input id="co-email" className="input" type="email" value={form.email} disabled={!editable} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Юридический адрес" htmlFor="co-addr" optional>
            <input id="co-addr" className="input" value={form.legalAddress} disabled={!editable} onChange={(e) => set({ legalAddress: e.target.value })} />
          </Field>
        </div>
        <Field label="Условия и заметки" htmlFor="co-notes" optional>
          <textarea id="co-notes" className="textarea" rows={3} value={form.notes} disabled={!editable} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        {company && guests.data ? (
          <section className="section">
            <h3 className="section-title">Сотрудники компании в базе гостей</h3>
            {guests.data.length ? (
              <ul role="list" className="doc-list">
                {guests.data.map((g) => (
                  <li key={g.id} className="row-between">
                    <Link to="/guests/$guestId" params={{ guestId: g.id }} className="link" onClick={onClose}>
                      {g.fullName}
                    </Link>
                    <span className="muted">{g.stays ? `визитов ${g.stays}` : 'не был'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Пока никого.</p>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
