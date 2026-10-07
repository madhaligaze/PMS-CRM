import type { S } from '@/api/hooks';

export type Rights = S['Rights'];
export type Level = 'none' | 'view' | 'edit';
export type Catalog = {
  sections: { key: string; title: string; group: string; levels: Level[]; hint: string }[];
  powers: { key: string; title: string; hint: string }[];
};

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2 };

/** Подписи уровней по тому, какие уровни у раздела есть: у заселения «смотреть» нечего - там «Да». */
function levelLabel(level: Level, levels: Level[]): string {
  if (level === 'none') return 'Нет';
  if (level === 'view') return 'Видит';
  return levels.includes('view') ? 'Правит' : 'Да';
}

export const levelOf = (r: Rights, key: string): Level => (r.sections as Record<string, Level | undefined>)[key] ?? 'none';

export function setLevel(r: Rights, key: string, level: Level): Rights {
  const sections = { ...(r.sections as Record<string, Level>) };
  if (level === 'none') delete sections[key];
  else sections[key] = level;
  return { ...r, sections: sections as Rights['sections'] };
}

export function togglePower(r: Rights, key: string, on: boolean): Rights {
  const powers = r.powers.filter((p) => p !== key);
  if (on) powers.push(key as Rights['powers'][number]);
  return { ...r, powers };
}

/** Одинаковы ли права по смыслу: порядок разделов и полномочий не важен. */
export function sameRights(a: Rights, b: Rights): boolean {
  const sa = a.sections as Record<string, string>;
  const sb = b.sections as Record<string, string>;
  const keys = new Set([...Object.keys(sa), ...Object.keys(sb)]);
  for (const k of keys) if ((sa[k] ?? 'none') !== (sb[k] ?? 'none')) return false;
  return a.powers.length === b.powers.length && a.powers.every((p) => b.powers.includes(p));
}

/** Коротко для списка: «5 разделов, 2 полномочия». */
export function rightsSummary(r: Rights): string {
  const n = Object.keys(r.sections).length;
  const p = r.powers.length;
  if (!n && !p) return 'ничего не открыто';
  const sec = n % 10 === 1 && n % 100 !== 11 ? 'раздел' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'раздела' : 'разделов';
  const pw = p % 10 === 1 && p % 100 !== 11 ? 'полномочие' : p % 10 >= 2 && p % 10 <= 4 && (p % 100 < 12 || p % 100 > 14) ? 'полномочия' : 'полномочий';
  return [n ? `${n} ${sec}` : null, p ? `${p} ${pw}` : null].filter(Boolean).join(', ');
}

/**
 * Права по разделам. Уровень выбирается словом в строку - «Нет · Видит ·
 * Правит»: два флажка «видит» и «правит» допускали бы «правит, но не видит».
 * Кто сам не администратор, раздаёт не выше своего (cap): выше своего уровень
 * виден, но не выбирается, и подсказка говорит почему. Уже выданное выше
 * своего остаётся - сузить его можно, поднять нельзя.
 */
export function RightsMatrix({
  catalog,
  value,
  onChange,
  cap,
  readOnly,
}: {
  catalog: Catalog;
  value: Rights;
  onChange: (next: Rights) => void;
  /** Права того, кто раздаёт; null - владелец или администратор, ограничений нет. */
  cap: Rights | null;
  readOnly?: boolean;
}) {
  const groups = [...new Set(catalog.sections.map((s) => s.group))];
  return (
    <div className="rights">
      {groups.map((group) => (
        <section key={group} className="rights-group">
          <h4 className="rights-group-title">{group}</h4>
          {catalog.sections
            .filter((s) => s.group === group)
            .map((s) => {
              const current = levelOf(value, s.key);
              return (
                <div key={s.key} className="rights-row">
                  <div className="rights-what">
                    <div className="rights-title">{s.title}</div>
                    <div className="rights-hint">{s.hint}</div>
                  </div>
                  <div className="rights-levels" role="radiogroup" aria-label={s.title}>
                    {s.levels.map((level) => {
                      const above = cap !== null && RANK[level] > RANK[levelOf(cap, s.key)] && RANK[level] > RANK[current];
                      return (
                        <button
                          key={level}
                          type="button"
                          role="radio"
                          className="rights-level"
                          aria-checked={current === level}
                          disabled={readOnly || above}
                          title={above ? 'Выше ваших прав: открывает владелец или администратор' : undefined}
                          onClick={() => onChange(setLevel(value, s.key, level))}
                        >
                          {levelLabel(level, s.levels)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
        </section>
      ))}
      <section className="rights-group">
        <h4 className="rights-group-title">Особые полномочия</h4>
        {catalog.powers.map((p) => {
          const on = value.powers.includes(p.key as Rights['powers'][number]);
          const above = cap !== null && !on && !cap.powers.includes(p.key as Rights['powers'][number]);
          return (
            <label key={p.key} className="rights-row rights-power" title={above ? 'Этого полномочия нет у вас самих' : undefined}>
              <span className="check">
                <input type="checkbox" checked={on} disabled={readOnly || above} onChange={(e) => onChange(togglePower(value, p.key, e.target.checked))} />
              </span>
              <span className="rights-what">
                <span className="rights-title">{p.title}</span>
                <span className="rights-hint">{p.hint}</span>
              </span>
            </label>
          );
        })}
      </section>
    </div>
  );
}
