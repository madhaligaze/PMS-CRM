import type { ReactNode } from 'react';
import { amount, currencySign } from '@/lib/format';
import { BOOKING_STATUS } from '@/lib/labels';

/** Сумма: число табличными цифрами и валюта приглушённо. Приход - зелёным, долг - красным. */
export function Money({ value, currency, tone, signed }: { value: number; currency: string; tone?: 'in' | 'due'; signed?: boolean }) {
  const sign = signed && value > 0 ? '+' : value < 0 ? '−' : '';
  return (
    <span className={`money${tone ? ` ${tone}` : ''}`}>
      {sign}
      {amount(Math.abs(value))}
      <span className="cur">{currencySign(currency)}</span>
    </span>
  );
}

export function Status({ value }: { value: string }) {
  return (
    <span className="st" data-s={value}>
      {BOOKING_STATUS[value] ?? value}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  optional,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {optional ? <span className="opt"> - необязательно</span> : null}
      </label>
      {children}
      {error ? <div className="field-error">{error}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

export function Choices<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, ReactNode][];
  label: string;
}) {
  return (
    <div className="choices" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" className="choice" aria-checked={value === v} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Loading({ label = 'Загрузка' }: { label?: string }) {
  return (
    <div className="loading-block" aria-busy="true" aria-label={label}>
      <div className="loading-line" />
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
