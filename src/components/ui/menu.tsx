import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Выпадающее меню у кнопки: закрывается кликом мимо и Escape. В подвале окна
 * открывается вверх (side="top"), иначе ушло бы за край экрана. Escape ловится
 * раньше окна (фаза перехвата): закрывается меню, а окно под ним остаётся.
 */
export function Menu({
  trigger,
  children,
  align = 'right',
  side = 'bottom',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'left' | 'right';
  side?: 'top' | 'bottom';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open ? (
        <div className="menu" role="menu" aria-label={label} style={{ [side === 'top' ? 'bottom' : 'top']: 'calc(100% + 6px)', [align]: 0 }}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}
