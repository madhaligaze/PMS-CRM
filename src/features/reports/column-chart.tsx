import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type Column = {
  key: string;
  value: number;
  /** Подпись под столбцом (день месяца); пустая - не подписывать. */
  tick: string;
  /** Будущие дни: столбец светлее, это брони, а не факт. */
  muted?: boolean;
  tip: { title: string; lines: [label: string, value: string][] };
};

/** Круглые деления оси: 1, 2, 2.5, 5 × 10ⁿ. */
function niceStep(max: number, count: number): number {
  const raw = max / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/**
 * Столбцы по дням: одна величина, одна ось, тонкие столбцы со скруглённым
 * концом и квадратным основанием. Подсказка - по наведению и стрелками с
 * клавиатуры; значения продублированы таблицей на странице.
 */
export function ColumnChart({ data, yMax, yFormat, label, height = 200 }: { data: Column[]; yMax?: number; yFormat: (v: number) => string; label: string; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setActive(null), [data]);

  const max = Math.max(yMax ?? 0, ...data.map((d) => d.value), 1);
  const step = niceStep(max, 4);
  const top = yMax ?? Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 1000; v += step) ticks.push(v);
  const left = Math.max(...ticks.map((t) => yFormat(t).length)) * 6.8 + 10;
  const right = 4;
  const padTop = 10;
  const axis = 22;
  const plotW = Math.max(0, width - left - right);
  const plotH = height - padTop - axis;
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2, band * 0.72));
  const y = (v: number) => padTop + plotH - (Math.min(v, top) / top) * plotH;
  const every = Math.max(1, Math.ceil(30 / Math.max(band, 1)));

  const at = (clientX: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - left) / band);
    return i >= 0 && i < data.length ? i : null;
  };

  const cur = active !== null ? data[active] : null;
  const tipX = active !== null ? left + band * active + band / 2 : 0;

  return (
    <div
      ref={wrap}
      className="cc"
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={label}
      onPointerMove={(e) => width && setActive(at(e.clientX))}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={(e) => {
        if (!data.length) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          setActive((i) => {
            if (e.key === 'Home') return 0;
            if (e.key === 'End') return data.length - 1;
            const base = i ?? (e.key === 'ArrowRight' ? -1 : data.length);
            return Math.min(data.length - 1, Math.max(0, base + (e.key === 'ArrowRight' ? 1 : -1)));
          });
        }
        if (e.key === 'Escape') setActive(null);
      }}
    >
      {width ? (
        <svg width={width} height={height} aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}>
              <line className="cc-grid" x1={left} x2={width - right} y1={y(t) + 0.5} y2={y(t) + 0.5} />
              <text className="cc-ytick" x={left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {active !== null ? <rect className="cc-band" x={left + band * active} y={padTop} width={band} height={plotH} /> : null}
          {data.map((d, i) => {
            const h = (Math.min(d.value, top) / top) * plotH;
            const x = left + band * i + (band - barW) / 2;
            const r = Math.min(4, barW / 2, h);
            const base = padTop + plotH;
            return h > 0 ? (
              <path
                key={d.key}
                className="cc-bar"
                data-muted={d.muted || undefined}
                data-active={active === i || undefined}
                d={`M${x},${base} V${base - h + r} Q${x},${base - h} ${x + r},${base - h} H${x + barW - r} Q${x + barW},${base - h} ${x + barW},${base - h + r} V${base} Z`}
              />
            ) : null;
          })}
          <line className="cc-axis" x1={left} x2={width - right} y1={padTop + plotH + 0.5} y2={padTop + plotH + 0.5} />
          {data.map((d, i) =>
            i % every === 0 && d.tick ? (
              <text key={d.key} className="cc-xtick" x={left + band * i + band / 2} y={height - 6} textAnchor="middle">
                {d.tick}
              </text>
            ) : null,
          )}
        </svg>
      ) : null}
      {cur ? (
        <div className="cc-tip" style={{ left: Math.min(Math.max(tipX, 90), Math.max(90, width - 90)) }}>
          <div className="cc-tip-title">{cur.tip.title}</div>
          {cur.tip.lines.map(([l, v]) => (
            <div key={l} className="cc-tip-row">
              <span className="cc-tip-v">{v}</span>
              <span className="cc-tip-l">{l}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Подпись к столбцам, когда их два вида: прошедшие дни и будущие по броням. */
export function ChartKey({ items }: { items: { label: string; muted?: boolean }[] }) {
  return (
    <div className="cc-key">
      {items.map((i) => (
        <span key={i.label} className="cc-key-item">
          <span className="cc-swatch" data-muted={i.muted || undefined} aria-hidden="true" />
          {i.label}
        </span>
      ))}
    </div>
  );
}
