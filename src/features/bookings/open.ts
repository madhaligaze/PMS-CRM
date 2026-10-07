import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/** Открыть карточку брони поверх текущей страницы (?booking=<id>). */
export function useOpenBooking() {
  const navigate = useNavigate();
  return useCallback(
    (id: string | undefined) =>
      void navigate({
        to: '.',
        search: (prev: Record<string, unknown>) => ({ ...prev, booking: id }),
        replace: false,
      } as never),
    [navigate],
  );
}
