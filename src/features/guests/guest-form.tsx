import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useCompanies, useInvalidate, type S } from '@/api/hooks';
import { Choices, Field } from '@/components/ui/bits';
import { Modal } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { DOC_TYPE, LANGUAGES } from '@/lib/labels';
import { CitizenshipField, IinField } from './identity-fields';

type Guest = S['Guest'];

type Form = {
  lastName: string;
  firstName: string;
  middleName: string;
  phone: string;
  email: string;
  birthDate: string;
  gender: '' | 'm' | 'f';
  citizenship: string;
  docType: string;
  docNumber: string;
  personalNumber: string;
  language: string;
  companyId: string;
  isVip: boolean;
  marketingConsent: boolean;
  roomType: string;
  allergies: string;
  prefNotes: string;
  notes: string;
};

const empty: Form = {
  lastName: '',
  firstName: '',
  middleName: '',
  phone: '',
  email: '',
  birthDate: '',
  gender: '',
  citizenship: 'KAZ',
  docType: '',
  docNumber: '',
  personalNumber: '',
  language: 'ru',
  companyId: '',
  isVip: false,
  marketingConsent: false,
  roomType: '',
  allergies: '',
  prefNotes: '',
  notes: '',
};

function fromGuest(g: Guest): Form {
  return {
    lastName: g.lastName,
    firstName: g.firstName,
    middleName: g.middleName ?? '',
    phone: g.phone ?? '',
    email: g.email ?? '',
    birthDate: g.birthDate ?? '',
    gender: g.gender ?? '',
    citizenship: g.citizenship ?? '',
    docType: g.docType ?? '',
    docNumber: g.docNumber ?? '',
    personalNumber: g.personalNumber ?? '',
    language: g.language ?? 'ru',
    companyId: g.companyId ?? '',
    isVip: g.isVip,
    marketingConsent: g.marketingConsent,
    roomType: g.preferences.roomType ?? '',
    allergies: g.preferences.allergies ?? '',
    prefNotes: g.preferences.notes ?? '',
    notes: g.notes ?? '',
  };
}

/** Карточка гостя: создать или изменить. Документ при заселении - в мастере заселения. */
export function GuestFormModal({ open, guest, onClose, onSaved }: { open: boolean; guest?: Guest | null; onClose: () => void; onSaved?: (g: Guest) => void }) {
  const [form, setForm] = useState<Form>(empty);
  const [error, setError] = useState<string | null>(null);
  const companies = useCompanies();
  const invalidate = useInvalidate();
  useEffect(() => {
    if (open) {
      setForm(guest ? fromGuest(guest) : empty);
      setError(null);
    }
  }, [open, guest]);
  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const body = () => ({
    lastName: form.lastName.trim(),
    firstName: form.firstName.trim(),
    middleName: form.middleName.trim() || null,
    phone: form.phone.trim() || null,
    email: form.email.trim() || null,
    birthDate: form.birthDate || null,
    gender: form.gender || null,
    citizenship: form.citizenship.trim().toUpperCase() || null,
    docType: (form.docType || null) as never,
    docNumber: form.docNumber.trim() || null,
    personalNumber: form.personalNumber || null,
    language: form.language || null,
    companyId: form.companyId || null,
    isVip: form.isVip,
    marketingConsent: form.marketingConsent,
    preferences: {
      ...(form.roomType.trim() ? { roomType: form.roomType.trim() } : {}),
      ...(form.allergies.trim() ? { allergies: form.allergies.trim() } : {}),
      ...(form.prefNotes.trim() ? { notes: form.prefNotes.trim() } : {}),
    },
    notes: form.notes.trim() || null,
  });

  const save = useMutation({
    mutationFn: () =>
      guest
        ? unwrap(api.PATCH('/api/v1/properties/{propertyId}/guests/{id}', { params: { path: { ...pid(), id: guest.id } }, headers: ifMatch(guest.version), body: body() }))
        : unwrap(api.POST('/api/v1/properties/{propertyId}/guests', { params: { path: pid() }, body: body() })),
    onSuccess: (g) => {
      toast.info(guest ? 'Карточка сохранена' : 'Гость добавлен в базу');
      void invalidate('guests', 'guest');
      onSaved?.(g);
      onClose();
    },
    onError: (e) => {
      if (isApiError(e, 'guest.duplicate')) setError(`Гость с таким документом уже есть: ${e.detail ?? ''}`);
      else if (isApiError(e, 'version.conflict')) setError('Карточку уже изменил другой сотрудник. Закройте форму и откройте снова.');
      else if (isApiError(e, 'validation')) setError(Object.values(e.fieldErrors).join('; ') || e.message);
      else if (isApiError(e)) setError(e.message);
      else toast.fail(e);
    },
  });

  const valid = form.lastName.trim() && form.firstName.trim();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={guest ? 'Изменить карточку' : 'Новый гость'}
      subtitle={guest ? guest.fullName : undefined}
      wide
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Сохраняю' : 'Сохранить'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="grid-3">
          <Field label="Фамилия" htmlFor="gf-last">
            <input id="gf-last" className="input" value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
          </Field>
          <Field label="Имя" htmlFor="gf-first">
            <input id="gf-first" className="input" value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
          </Field>
          <Field label="Отчество" htmlFor="gf-mid" optional>
            <input id="gf-mid" className="input" value={form.middleName} onChange={(e) => set({ middleName: e.target.value })} />
          </Field>
          <Field label="Телефон" htmlFor="gf-phone">
            <input id="gf-phone" className="input" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
          </Field>
          <Field label="Почта" htmlFor="gf-email" optional>
            <input id="gf-email" className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
          <Field label="Язык общения" htmlFor="gf-lang">
            <select id="gf-lang" className="select" value={form.language} onChange={(e) => set({ language: e.target.value })}>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
              {form.language && !LANGUAGES.some(([code]) => code === form.language) ? <option value={form.language}>{form.language}</option> : null}
            </select>
          </Field>
          <Field label="Дата рождения" htmlFor="gf-birth" optional>
            <input id="gf-birth" type="date" className="input" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
          </Field>
          <Field label="Пол" optional>
            <Choices
              label="Пол"
              value={form.gender}
              onChange={(v) => set({ gender: v })}
              options={[
                ['m', 'Мужской'],
                ['f', 'Женский'],
              ]}
            />
          </Field>
          <CitizenshipField id="gf-cz" value={form.citizenship} onChange={(v) => set({ citizenship: v })} optional />
          <Field label="Документ" htmlFor="gf-doctype" optional>
            <select id="gf-doctype" className="select" value={form.docType} onChange={(e) => set({ docType: e.target.value })}>
              <option value="">Не указан</option>
              {Object.entries(DOC_TYPE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Номер документа" htmlFor="gf-docno" optional>
            <input id="gf-docno" className="input" value={form.docNumber} onChange={(e) => set({ docNumber: e.target.value })} />
          </Field>
          <IinField
            id="gf-iin"
            value={form.personalNumber}
            birthDate={form.birthDate}
            onChange={(v, person) =>
              set({
                personalNumber: v,
                ...(person && !form.birthDate ? { birthDate: person.birthDate } : {}),
                ...(person && !form.gender ? { gender: person.gender } : {}),
              })
            }
          />
          <Field label="Компания" htmlFor="gf-company" optional>
            <select id="gf-company" className="select" value={form.companyId} onChange={(e) => set({ companyId: e.target.value })}>
              <option value="">Частное лицо</option>
              {(companies.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <h3 className="section-title" style={{ marginTop: 'var(--s-3)' }}>
          Предпочтения и пометки
        </h3>
        <div className="grid-3">
          <Field label="Номер" htmlFor="gf-room" optional>
            <input id="gf-room" className="input" value={form.roomType} onChange={(e) => set({ roomType: e.target.value })} placeholder="Например: тихий, второй этаж" />
          </Field>
          <Field label="Аллергии в питании" htmlFor="gf-all" optional>
            <input id="gf-all" className="input" value={form.allergies} onChange={(e) => set({ allergies: e.target.value })} />
          </Field>
          <Field label="Пожелания" htmlFor="gf-pref" optional>
            <input id="gf-pref" className="input" value={form.prefNotes} onChange={(e) => set({ prefNotes: e.target.value })} />
          </Field>
        </div>
        <Field label="Заметки для персонала" htmlFor="gf-notes" optional>
          <textarea id="gf-notes" className="textarea" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
        <div className="row">
          <label className="check">
            <input type="checkbox" checked={form.isVip} onChange={(e) => set({ isVip: e.target.checked })} />
            <span>VIP</span>
          </label>
          <label className="check" style={{ marginLeft: 'var(--s-5)' }}>
            <input type="checkbox" checked={form.marketingConsent} onChange={(e) => set({ marketingConsent: e.target.checked })} />
            <span>Согласен получать рассылки (поздравления, предложения)</span>
          </label>
        </div>
        {error ? (
          <div className="alert" role="alert">
            <strong>Не сохранено.</strong> {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
