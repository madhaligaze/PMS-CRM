import { useEffect, useState, type ReactNode } from 'react';
import { Dialog } from './overlay';

/**
 * Действие с причиной: отмена, незаезд, сторно, пропуск уборки. ТЗ: «ничего
 * не удаляется бесследно - только отменяется с причиной». Готовые причины из
 * настроек гостиницы - выбором, своя - текстом.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  text,
  presets = [],
  confirmLabel,
  danger,
  busy,
  onConfirm,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  text?: ReactNode;
  presets?: string[];
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  extra?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);
  const value = reason.trim();
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      {text ? <p className="ink-2">{text}</p> : null}
      <div className="stack" style={{ marginTop: 'var(--s-4)' }}>
        {presets.length ? (
          <div className="choices" role="radiogroup" aria-label="Причина">
            {presets.map((p) => (
              <button key={p} type="button" role="radio" className="choice" aria-checked={reason === p} onClick={() => setReason(p)}>
                {p}
              </button>
            ))}
          </div>
        ) : null}
        <div className="field">
          <label className="field-label" htmlFor="reason-text">
            Причина
          </label>
          <textarea
            id="reason-text"
            className="textarea"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={presets.length ? 'Или напишите свою' : 'Что произошло'}
            data-autofocus
          />
        </div>
        {extra}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Не надо
        </button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={!value || busy} onClick={() => onConfirm(value)}>
          {busy ? 'Сохраняю' : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
