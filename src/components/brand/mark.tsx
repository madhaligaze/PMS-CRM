import { forwardRef } from 'react';

/**
 * Знак Bizdin Auyl - шаңырақ, венец юрты, каким его видно изнутри, если
 * смотреть прямо вверх: тяжёлый обод и две тройки прямых перекладин. Символ
 * дома и семьи - «наш аул»; заодно это сетка шахматки, главного экрана системы.
 * На входе тот же шаңырақ рисуется, распадается на рейки и собирает из них
 * окно входа (features/auth/login.tsx).
 *
 * Перекладины прямые намеренно: выгнутые наружу читались как глобус, внутрь -
 * как мяч (сравнение - pw-finmap/bizdin/mark-variants.cjs). Знак - контуры,
 * а не шрифт; толщины рассчитаны на 64 единицы.
 */
export const MARK_RING = { cx: 32, cy: 32, r: 26 };
export const MARK_LATHS = [
  'M9.02 23.5 L54.98 23.5',
  'M7.5 32 L56.5 32',
  'M9.02 40.5 L54.98 40.5',
  'M23.5 9.02 L23.5 54.98',
  'M32 7.5 L32 56.5',
  'M40.5 9.02 L40.5 54.98',
];

type Props = { title?: string; className?: string; ringWidth?: number; lathWidth?: number };

export const Mark = forwardRef<SVGSVGElement, Props>(function Mark({ title = 'Bizdin Auyl', className, ringWidth = 4.5, lathWidth = 2.2 }, ref) {
  return (
    <svg ref={ref} viewBox="0 0 64 64" className={className} role="img" aria-label={title} fill="none" stroke="currentColor" strokeLinecap="butt">
      <circle className="mark-ring" cx={MARK_RING.cx} cy={MARK_RING.cy} r={MARK_RING.r} strokeWidth={ringWidth} />
      {MARK_LATHS.map((d) => (
        <path key={d} className="mark-lath" d={d} strokeWidth={lathWidth} />
      ))}
    </svg>
  );
});
