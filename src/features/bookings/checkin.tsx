import { useMutation } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ifMatch, pid, unwrap } from '@/api/client';
import { isApiError } from '@/api/errors';
import { useGuest, useGuestDocuments, useInvalidate, useReadiness, useTape, type S } from '@/api/hooks';
import { uploadFile } from '@/api/upload';
import { useCan, useProperty } from '@/auth/session';
import { Choices, Field, Loading, Money } from '@/components/ui/bits';
import { toast } from '@/components/ui/toast';
import { dateTime } from '@/lib/format';
import { DOC_TYPE, HK_STATUS } from '@/lib/labels';
import { CitizenshipField, IinField } from '../guests/identity-fields';
import { PaymentDialog } from './folio';

type Booking = S['Booking'];
type Guest = S['Guest'];

type DocForm = {
  lastName: string;
  firstName: string;
  middleName: string;
  birthDate: string;
  gender: '' | 'm' | 'f';
  citizenship: string;
  docType: '' | 'passport' | 'id_card' | 'foreign_passport' | 'residence_permit' | 'other';
  docNumber: string;
  docIssuedBy: string;
  docIssuedOn: string;
  docExpiresOn: string;
  personalNumber: string;
  address: string;
  phone: string;
  email: string;
};

function formOf(g: Guest): DocForm {
  return {
    lastName: g.lastName,
    firstName: g.firstName,
    middleName: g.middleName ?? '',
    birthDate: g.birthDate ?? '',
    gender: g.gender ?? '',
    citizenship: g.citizenship ?? 'KAZ',
    docType: g.docType ?? '',
    docNumber: g.docNumber ?? '',
    docIssuedBy: g.docIssuedBy ?? '',
    docIssuedOn: g.docIssuedOn ?? '',
    docExpiresOn: g.docExpiresOn ?? '',
    personalNumber: g.personalNumber ?? '',
    address: g.address ?? '',
    phone: g.phone ?? '',
    email: g.email ?? '',
  };
}

function Step({ n, title, state, children }: { n: number; title: string; state: 'done' | 'todo' | 'problem' | 'optional'; children: ReactNode }) {
  const label = { done: 'Готово', todo: 'Нужно заполнить', problem: 'Мешает заселению', optional: 'По желанию' }[state];
  return (
    <section className="ci-step" data-state={state}>
      <header className="ci-step-head">
        <span className="ci-n">{n}</span>
        <h3>{title}</h3>
        <span className="ci-state">{label}</span>
      </header>
      <div className="ci-step-body">{children}</div>
    </section>
  );
}

export function CheckInFlow({ b, onDone }: { b: Booking; onDone: () => void }) {
  const can = useCan();
  const property = useProperty();
  const readiness = useReadiness(b.id);
  const guest = useGuest(b.guest.id);
  const invalidate = useInvalidate();
  const [keyIssued, setKeyIssued] = useState(true);
  const [pay, setPay] = useState<'payment' | 'deposit' | null>(null);

  const problems = readiness.data?.problems ?? [];
  const has = (code: string) => problems.some((p) => p.code === code);

  const checkIn = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/bookings/{id}/check-in', { params: { path: { ...pid(), id: b.id } }, body: { keyIssued } })),
    onSuccess: (nb) => {
      toast.info(`${nb.guest.fullName} заселён в номер ${nb.roomNumber}`, keyIssued ? 'Ключ выдан' : undefined);
      void invalidate('booking', 'bookings', 'tape', 'dashboard', 'hk', 'readiness');
      onDone();
    },
    onError: (e) => {
      toast.fail(e);
      void readiness.refetch();
    },
  });

  if (readiness.isPending || guest.isPending) return <Loading />;
  if (!guest.data) return null;
  const g = guest.data;
  const balance = readiness.data?.balance ?? b.balance;
  const blocking = problems.filter((p) => p.blocking);

  return (
    <div className="checkin">
      <div className="ci-intro">
        <h3>Заселение в номер {b.roomNumber}</h3>
        <p className="muted">Данные гостя вводятся один раз: сразу попадают в базу гостей и в историю. Повторно приехавшего гостя система узнает по документу.</p>
      </div>

      <Step n={1} title="Документ гостя" state={has('guest.data_missing') ? 'todo' : 'done'}>
        <DocumentStep guest={g} canDocs={can('guest.documents')} onSaved={() => void readiness.refetch()} />
      </Step>

      <Step n={2} title="Согласие и правила проживания" state={has('guest.consent_missing') ? 'todo' : 'done'}>
        <ConsentStep guest={g} onSaved={() => void readiness.refetch()} />
      </Step>

      <Step n={3} title="Номер" state={has('room.not_ready') ? 'problem' : 'done'}>
        <RoomStep b={b} notReady={has('room.not_ready')} onChanged={() => void readiness.refetch()} />
      </Step>

      <Step n={4} title="Оплата и депозит" state="optional">
        {balance ? (
          <div className="row-between">
            <div>
              {balance.due > 0 ? (
                <>
                  К оплате <Money value={balance.due} currency={property.currency} tone="due" />
                </>
              ) : (
                <>
                  Оплачено полностью <Money value={balance.paid} currency={property.currency} tone="in" />
                </>
              )}
              {balance.deposit ? (
                <span className="muted">
                  {' '}
                  · депозит <Money value={balance.deposit} currency={property.currency} />
                </span>
              ) : null}
            </div>
            <div className="row">
              {can('payment.accept') && balance.due > 0 ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPay('payment')}>
                  Принять оплату
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="muted">Оплату принимает ресепшен.</p>
        )}
        <p className="field-hint" style={{ marginTop: 6 }}>
          Оплату можно принять и позже, до выезда. Депозит за номер берётся после заселения, во вкладке «Счёт».
        </p>
      </Step>

      <Step n={5} title="Ключ и заселение" state={blocking.length ? 'todo' : 'done'}>
        {blocking.length ? (
          <ul role="list" className="ci-blockers">
            {blocking.map((p) => (
              <li key={p.code}>{p.message}</li>
            ))}
          </ul>
        ) : null}
        {problems.filter((p) => !p.blocking).map((p) => (
          <div key={p.code} className="note" style={{ marginBottom: 8 }}>
            {p.message}
          </div>
        ))}
        <label className="check">
          <input type="checkbox" checked={keyIssued} onChange={(e) => setKeyIssued(e.target.checked)} />
          <span>Ключ или карта выданы гостю</span>
        </label>
        <div className="row form-actions">
          <button type="button" className="btn btn-primary" disabled={!!blocking.length || checkIn.isPending} onClick={() => checkIn.mutate()}>
            {checkIn.isPending ? 'Заселяем' : `Заселить в ${b.roomNumber}`}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDone}>
            Вернуться к брони
          </button>
        </div>
      </Step>

      {balance ? <PaymentDialog open={pay !== null} kind={pay ?? 'payment'} booking={b} balance={balance} onClose={() => setPay(null)} onDone={() => setPay(null)} /> : null}
    </div>
  );
}

function DocumentStep({ guest, canDocs, onSaved }: { guest: Guest; canDocs: boolean; onSaved: () => void }) {
  const [form, setForm] = useState<DocForm>(() => formOf(guest));
  const [mrz, setMrz] = useState('');
  const [mrzNote, setMrzNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const invalidate = useInvalidate();
  const docs = useGuestDocuments(guest.id, canDocs);

  useEffect(() => setForm(formOf(guest)), [guest.id, guest.version]);
  const set = (patch: Partial<DocForm>) => setForm((f) => ({ ...f, ...patch }));

  const parse = useMutation({
    mutationFn: (text: string) => unwrap(api.POST('/api/v1/properties/{propertyId}/documents/parse-mrz', { params: { path: pid() }, body: { text } })),
    onSuccess: (r) => {
      set({
        lastName: r.lastName ? capitalize(r.lastName) : form.lastName,
        firstName: r.firstName ? capitalize(r.firstName) : form.firstName,
        middleName: r.middleName ? capitalize(r.middleName) : form.middleName,
        birthDate: r.birthDate ?? form.birthDate,
        gender: r.sex ?? form.gender,
        citizenship: r.nationality || form.citizenship,
        docType: r.docType === 'passport' ? (r.nationality === 'KAZ' ? 'passport' : 'foreign_passport') : r.docType === 'id_card' ? 'id_card' : 'other',
        docNumber: r.documentNumber,
        docExpiresOn: r.expiryDate ?? form.docExpiresOn,
        personalNumber: r.personalNumber ?? form.personalNumber,
      });
      setMrzNote(
        r.valid
          ? { ok: true, text: 'Данные из документа подставлены, контрольные цифры сошлись. Имя - латиницей из MRZ: исправьте на кириллицу, если нужно.' }
          : { ok: false, text: 'Контрольные цифры не сошлись: сверьте номер документа и даты с документом.' },
      );
    },
    onError: (e) => setMrzNote({ ok: false, text: isApiError(e) ? e.message : 'Не удалось разобрать строки' }),
  });

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/v1/properties/{propertyId}/guests/{id}', {
          params: { path: { ...pid(), id: guest.id } },
          headers: ifMatch(guest.version),
          body: {
            lastName: form.lastName.trim(),
            firstName: form.firstName.trim(),
            middleName: form.middleName.trim() || null,
            birthDate: form.birthDate || null,
            gender: form.gender || null,
            citizenship: form.citizenship.trim().toUpperCase() || null,
            docType: form.docType || null,
            docNumber: form.docNumber.trim() || null,
            docIssuedBy: form.docIssuedBy.trim() || null,
            docIssuedOn: form.docIssuedOn || null,
            docExpiresOn: form.docExpiresOn || null,
            personalNumber: form.personalNumber.trim() || null,
            address: form.address.trim() || null,
            phone: form.phone.trim() || null,
            email: form.email.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      setError(null);
      toast.info('Данные гостя сохранены');
      void invalidate('guest', 'booking', 'guests');
      onSaved();
    },
    onError: (e) => {
      if (isApiError(e, 'guest.duplicate')) setError(`С этим документом в базе уже есть гость: ${e.detail ?? ''}. Объединить карточки может старший администратор.`);
      else if (isApiError(e, 'version.conflict')) setError('Карточку только что изменил другой сотрудник: откройте бронь заново.');
      else if (isApiError(e)) setError(e.message);
      else toast.fail(e);
    },
  });

  async function onFile(file: File) {
    setUploading(true);
    try {
      const fileId = await uploadFile(file, 'guest_document');
      await unwrap(
        api.POST('/api/v1/properties/{propertyId}/guests/{id}/documents', {
          params: { path: { ...pid(), id: guest.id } },
          body: { fileId, kind: form.docType === 'id_card' ? 'id_front' : 'passport' },
        }),
      );
      toast.info('Скан сохранён в защищённом хранилище', 'Видят только ресепшен и управляющий; каждый просмотр пишется в журнал.');
      void invalidate('guest');
    } catch (e) {
      toast.fail(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const filled = useMemo(() => !!(form.docType && form.docNumber && form.birthDate && form.citizenship), [form]);

  return (
    <div className="stack">
      <div className="field">
        <label className="field-label" htmlFor="ci-mrz">
          Сканер документа
        </label>
        <textarea
          id="ci-mrz"
          className="textarea mrz"
          rows={3}
          spellCheck={false}
          placeholder={'Наведите сканер на машиночитаемую зону паспорта или удостоверения личности.\nСтроки появятся здесь и разберутся сами.'}
          value={mrz}
          onChange={(e) => {
            setMrz(e.target.value);
            const lines = e.target.value.trim().split(/\r?\n/).filter((l) => l.replace(/\s/g, '').length >= 28);
            if (lines.length >= 2 && !parse.isPending) parse.mutate(e.target.value);
          }}
        />
        <div className="row">
          <button type="button" className="btn btn-ghost btn-sm" disabled={mrz.trim().length < 20 || parse.isPending} onClick={() => parse.mutate(mrz)}>
            Разобрать
          </button>
          {canDocs ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
              <button type="button" className="btn btn-ghost btn-sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? 'Загружаем скан' : 'Сфотографировать или загрузить скан'}
              </button>
              {docs.data?.length ? <span className="muted">Сканов в карточке: {docs.data.length}</span> : null}
            </>
          ) : null}
        </div>
        {mrzNote ? <div className={mrzNote.ok ? 'field-hint' : 'field-error'}>{mrzNote.text}</div> : null}
      </div>

      <div className="grid-3">
        <Field label="Фамилия" htmlFor="ci-last">
          <input id="ci-last" className="input" value={form.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Field>
        <Field label="Имя" htmlFor="ci-first">
          <input id="ci-first" className="input" value={form.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Field>
        <Field label="Отчество" htmlFor="ci-mid" optional>
          <input id="ci-mid" className="input" value={form.middleName} onChange={(e) => set({ middleName: e.target.value })} />
        </Field>
        <Field label="Дата рождения" htmlFor="ci-birth">
          <input id="ci-birth" type="date" className="input" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
        </Field>
        <Field label="Пол">
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
        <CitizenshipField id="ci-cz" value={form.citizenship} onChange={(v) => set({ citizenship: v })} />
        <Field label="Документ" htmlFor="ci-doctype">
          <select id="ci-doctype" className="select" value={form.docType} onChange={(e) => set({ docType: e.target.value as DocForm['docType'] })}>
            <option value="">Выберите</option>
            {Object.entries(DOC_TYPE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Номер документа" htmlFor="ci-docno">
          <input id="ci-docno" className="input" value={form.docNumber} onChange={(e) => set({ docNumber: e.target.value })} autoComplete="off" />
        </Field>
        <IinField
          id="ci-iin"
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
        <Field label="Кем выдан" htmlFor="ci-issuer" optional>
          <input id="ci-issuer" className="input" value={form.docIssuedBy} onChange={(e) => set({ docIssuedBy: e.target.value })} />
        </Field>
        <Field label="Дата выдачи" htmlFor="ci-issued" optional>
          <input id="ci-issued" type="date" className="input" value={form.docIssuedOn} onChange={(e) => set({ docIssuedOn: e.target.value })} />
        </Field>
        <Field label="Действует до" htmlFor="ci-expires" optional>
          <input id="ci-expires" type="date" className="input" value={form.docExpiresOn} onChange={(e) => set({ docExpiresOn: e.target.value })} />
        </Field>
      </div>
      <div className="grid-3">
        <Field label="Адрес" htmlFor="ci-address" optional>
          <input id="ci-address" className="input" value={form.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Телефон" htmlFor="ci-phone">
          <input id="ci-phone" className="input" inputMode="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="Почта" htmlFor="ci-email" optional>
          <input id="ci-email" className="input" type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
      </div>
      {error ? (
        <div className="alert" role="alert">
          <strong>Не сохранено.</strong> {error}
        </div>
      ) : null}
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={!filled || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Сохраняем' : 'Сохранить данные гостя'}
        </button>
        {!filled ? <span className="field-hint">Для заселения нужны документ, номер, дата рождения и гражданство.</span> : null}
      </div>
    </div>
  );
}

function ConsentStep({ guest, onSaved }: { guest: Guest; onSaved: () => void }) {
  const property = useProperty();
  const invalidate = useInvalidate();
  const [method, setMethod] = useState<'paper' | 'tablet'>('paper');
  const [signed, setSigned] = useState(false);
  const save = useMutation({
    mutationFn: () => unwrap(api.POST('/api/v1/properties/{propertyId}/guests/{id}/consent', { params: { path: { ...pid(), id: guest.id } }, body: { method } })),
    onSuccess: () => {
      toast.info('Согласие отмечено');
      void invalidate('guest');
      onSaved();
    },
    onError: toast.fail,
  });
  if (guest.pdConsentAt) {
    return (
      <p>
        Подписано {dateTime(guest.pdConsentAt, property.timezone)}
        <span className="muted"> · {guest.pdConsentMethod === 'tablet' ? 'на планшете' : 'на бумаге'}</span>
      </p>
    );
  }
  return (
    <div className="stack">
      <label className="check">
        <input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
        <span>Гость подписал согласие на обработку персональных данных и правила проживания</span>
      </label>
      <div className="row">
        <Choices
          label="Как подписано"
          value={method}
          onChange={setMethod}
          options={[
            ['paper', 'На бумаге'],
            ['tablet', 'На планшете'],
          ]}
        />
        <button type="button" className="btn btn-primary btn-sm" disabled={!signed || save.isPending} onClick={() => save.mutate()}>
          Отметить
        </button>
      </div>
    </div>
  );
}

function RoomStep({ b, notReady, onChanged }: { b: Booking; notReady: boolean; onChanged: () => void }) {
  const tape = useTape(b.arrival, b.departure);
  const invalidate = useInvalidate();
  const [picking, setPicking] = useState(false);
  const alternatives = useMemo(() => {
    const t = tape.data;
    if (!t) return [];
    const busy = new Set([
      ...t.bookings.filter((x) => x.id !== b.id && x.arrival < b.departure && x.departure > b.arrival).map((x) => x.roomId),
      ...t.blocks.map((k) => k.roomId),
    ]);
    return t.rooms
      .filter((r) => r.isActive && r.id !== b.roomId && !busy.has(r.id) && r.hkStatus === 'inspected')
      .map((r) => ({ ...r, typeName: t.roomTypes.find((x) => x.id === r.roomTypeId)?.name ?? '' }));
  }, [tape.data, b]);
  const move = useMutation({
    mutationFn: (roomId: string) =>
      unwrap(api.PATCH('/api/v1/properties/{propertyId}/bookings/{id}', { params: { path: { ...pid(), id: b.id } }, headers: ifMatch(b.version), body: { roomId, reprice: 'keep' } })),
    onSuccess: (nb) => {
      toast.info(`Бронь перенесена в номер ${nb.roomNumber}`, 'Цена ночей сохранена.');
      void invalidate('booking', 'tape', 'dashboard', 'readiness');
      setPicking(false);
      onChanged();
    },
    onError: toast.fail,
  });
  return (
    <div className="stack">
      <p>
        Номер <strong>{b.roomNumber}</strong>, {b.roomTypeName} · <span className={notReady ? 'danger' : undefined}>{HK_STATUS[b.roomHkStatus]?.toLowerCase()}</span>
      </p>
      {notReady ? (
        <>
          <p className="muted">Продать можно только номер, проверенный супервайзером. Подождите проверку или переселите в готовый номер.</p>
          {!picking ? (
            <div className="row">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
                Выбрать готовый номер
              </button>
              <button type="button" className="btn btn-quiet btn-sm" onClick={onChanged}>
                Проверить снова
              </button>
            </div>
          ) : alternatives.length ? (
            <div className="room-pick">
              {alternatives.map((r) => (
                <button key={r.id} type="button" className="choice room-choice" disabled={move.isPending} onClick={() => move.mutate(r.id)}>
                  <span className="rc-num">{r.number}</span>
                  <span className="rc-type">{r.typeName}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="field-error">Свободных проверенных номеров на эти даты нет.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

/** MRZ отдаёт имена заглавными: «ERIKSSON» → «Eriksson». */
function capitalize(s: string) {
  return s
    .toLowerCase()
    .split(/([\s-])/)
    .map((p) => (p.length ? p[0]!.toUpperCase() + p.slice(1) : p))
    .join('');
}
