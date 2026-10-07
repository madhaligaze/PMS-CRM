import { useState } from 'react';
import { Field } from '@/components/ui/bits';
import { iinPerson, isValidIin } from '@/lib/iin';
import { COUNTRIES } from '@/lib/labels';

/** Гражданство: частые страны списком, любая другая - кодом ISO из трёх букв, как в документе. */
export function CitizenshipField({ id, value, onChange, optional }: { id: string; value: string; onChange: (v: string) => void; optional?: boolean }) {
  const known = COUNTRIES.some(([c]) => c === value);
  const [typing, setTyping] = useState(false);
  const other = !known && (typing || value !== '');
  return (
    <Field label="Гражданство" htmlFor={id} optional={optional} hint={other ? 'Код страны ISO, три буквы, как в документе' : undefined}>
      <select
        id={id}
        className="select"
        value={other ? '__other' : value}
        onChange={(e) => {
          const v = e.target.value;
          setTyping(v === '__other');
          onChange(v === '__other' ? '' : v);
        }}
      >
        {optional ? <option value="">Не указано</option> : null}
        {COUNTRIES.map(([c, n]) => (
          <option key={c} value={c}>
            {n}
          </option>
        ))}
        <option value="__other">Другая страна</option>
      </select>
      {other ? (
        <input
          className="input"
          aria-label="Код страны"
          maxLength={3}
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder="Например, ITA"
          style={{ marginTop: 6 }}
        />
      ) : null}
    </Field>
  );
}

/**
 * ИИН: только цифры, до 12. Сошлась контрольная цифра - пустые дата рождения
 * и пол заполняются из номера; расхождение с введённой датой видно сразу.
 */
export function IinField({
  id,
  value,
  birthDate,
  onChange,
}: {
  id: string;
  value: string;
  birthDate: string;
  onChange: (v: string, person: { birthDate: string; gender: 'm' | 'f' } | null) => void;
}) {
  const person = iinPerson(value);
  const partial = value && value.length < 12 ? `12 цифр, введено ${value.length}` : undefined;
  const invalid = value.length === 12 && !isValidIin(value) ? 'Контрольная цифра не сходится: сверьте номер с документом' : undefined;
  const mismatch = person && birthDate && person.birthDate !== birthDate ? `По ИИН дата рождения ${person.birthDate.split('-').reverse().join('.')}` : undefined;
  return (
    <Field label="ИИН" htmlFor={id} optional error={invalid ?? mismatch} hint={partial}>
      <input
        id={id}
        className="input num"
        inputMode="numeric"
        autoComplete="off"
        maxLength={12}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D+/g, '').slice(0, 12);
          onChange(v, iinPerson(v));
        }}
      />
    </Field>
  );
}
