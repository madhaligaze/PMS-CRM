import { useId, useMemo, useRef, useState } from 'react';

type Option = { value: string; label: string; hint?: string };

/**
 * Поле с выпадающим списком, в которое можно вписать своё: должность при
 * найме. Список подсказывает уже заведённые - их не печатают каждый раз, когда
 * нанимают нескольких людей на одну должность; новое значение уходит как есть
 * и заводится на сервере.
 *
 * Клавиатура: стрелки ходят по списку, Enter выбирает, Escape закрывает список.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  newLabel = (v) => `Новая: «${v}»`,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string, option: Option | null) => void;
  options: Option[];
  placeholder?: string;
  newLabel?: (v: string) => string;
  disabled?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [typed, setTyped] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.trim().toLowerCase();
  const exact = options.find((o) => o.label.toLowerCase() === query) ?? null;
  // Пока человек не печатал, список показывает всё: выбирают, а не ищут.
  const items = useMemo(() => {
    const list = typed && query ? options.filter((o) => o.label.toLowerCase().includes(query)) : options;
    const out: (Option & { create?: boolean })[] = [...list];
    if (typed && query && !exact) out.push({ value: value.trim(), label: newLabel(value.trim()), create: true });
    return out;
  }, [options, typed, query, exact, value, newLabel]);

  const pick = (o: Option & { create?: boolean }) => {
    onChange(o.create ? o.value : o.label, o.create ? null : o);
    setOpen(false);
    setTyped(false);
  };

  return (
    <div className="combo" data-open={open && items.length > 0}>
      <input
        ref={inputRef}
        id={id}
        className="input select"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setTyped(true);
          setOpen(true);
          setActive(0);
          const v = e.target.value;
          const match = options.find((o) => o.label.toLowerCase() === v.trim().toLowerCase()) ?? null;
          onChange(v, match);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(items.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && items.length ? (
        <ul id={listId} role="listbox" className="combo-list">
          {items.map((o, i) => (
            <li
              key={`${o.create ? 'new' : 'opt'}-${o.value}`}
              role="option"
              aria-selected={i === active}
              className={`combo-item${o.create ? ' combo-new' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(o);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{o.label}</span>
              {o.hint ? <span className="combo-hint">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
