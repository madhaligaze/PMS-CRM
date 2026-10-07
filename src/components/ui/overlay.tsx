import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Держит элемент смонтированным, пока идёт анимация закрытия. */
function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted, shown };
}

/**
 * Запись для окна, которое закрывается: пока оно гаснет, в нём остаётся
 * прежнее содержимое, а не пустота. Открыто ли окно - решает сам `value`.
 */
export function useHeld<T>(value: T | null | undefined): T | null {
  const [held, setHeld] = useState<T | null>(value ?? null);
  if (value != null && value !== held) setHeld(value);
  return value ?? held;
}

/**
 * Открытые окна стопкой: Escape закрывает только верхнее. Окно оплаты поверх
 * карточки брони закрывается одно, карточка остаётся.
 */
const stack: number[] = [];
let seq = 0;

/** Escape закрывает верхнее окно, фокус уходит внутрь и возвращается туда, откуда пришёл. */
function useDialogBehavior(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    stack.push(id);
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea, button:not([data-close])');
    (first ?? node)?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || stack[stack.length - 1] !== id) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      if (!stack.length) html.style.overflow = overflow;
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  aside?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Постоянная высота: окно с вкладками не прыгает, когда содержимое короче. */
  tall?: boolean;
  children: ReactNode;
  label?: string;
};

/**
 * Окно работы с записью: бронь, гость, компания, сотрудник. По центру экрана,
 * шапка и кнопки на месте, прокручивается только содержимое. Появляется
 * растворением с небольшим подъёмом; вуаль - только прозрачностью.
 */
export function Modal({ open, onClose, title, subtitle, aside, footer, wide, tall, children, label }: ModalProps) {
  const { mounted, shown } = usePresence(open, 240);
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(open && mounted, onClose, ref);
  if (!mounted) return null;
  return createPortal(
    <>
      <div className="veil" data-shown={shown} />
      {/* Нажатие мимо окна закрывает его; по mousedown - выделение текста, ушедшее за край, окно не закроет. */}
      <div className="modal-layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          ref={ref}
          className={`modal${wide ? ' modal-wide' : ''}${tall ? ' modal-tall' : ''}`}
          data-shown={shown}
          role="dialog"
          aria-modal="true"
          aria-label={label ?? (typeof title === 'string' ? title : undefined)}
          tabIndex={-1}
        >
          <header className="modal-head">
            <div className="title">
              <h2 className="modal-title">{title}</h2>
              {subtitle ? <div className="modal-sub">{subtitle}</div> : null}
            </div>
            {aside}
            <button type="button" className="btn btn-ghost btn-sm btn-icon" data-close onClick={onClose} aria-label="Закрыть">
              <CloseGlyph />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer ? <footer className="modal-foot">{footer}</footer> : null}
        </div>
      </div>
    </>,
    document.body,
  );
}

type DialogProps = { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; label?: string };

/** Короткий вопрос или форма в одно действие: оплата, причина, подтверждение. */
export function Dialog({ open, onClose, title, children, wide, label }: DialogProps) {
  const { mounted, shown } = usePresence(open, 180);
  const ref = useRef<HTMLDivElement>(null);
  useDialogBehavior(open && mounted, onClose, ref);
  if (!mounted) return null;
  return createPortal(
    <>
      <div className="veil veil-dialog" data-shown={shown} />
      <div className="modal-layer modal-layer-dialog" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          ref={ref}
          className={`dialog${wide ? ' dialog-wide' : ''}`}
          data-shown={shown}
          role="dialog"
          aria-modal="true"
          aria-label={label ?? (typeof title === 'string' ? title : undefined)}
          tabIndex={-1}
        >
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    </>,
    document.body,
  );
}

export function CloseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 2l10 10M12 2L2 12" />
    </svg>
  );
}

export function ChevronGlyph({ dir = 'right' }: { dir?: 'left' | 'right' | 'down' }) {
  const d = dir === 'left' ? 'M9 2L4 7l5 5' : dir === 'down' ? 'M2 5l5 5 5-5' : 'M5 2l5 5-5 5';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d={d} />
    </svg>
  );
}
