/**
 * ИИН и БИН: 12 цифр, последняя контрольная (то же правило, что на сервере,
 * backend/src/lib/iin.ts). Здесь - только подсказка при вводе: сохранить
 * номер с несошедшейся цифрой можно, решает сотрудник с документом в руках.
 */

const WEIGHTS_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const WEIGHTS_2 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2];

function controlDigit(first11: string): number | null {
  const digits = [...first11].map(Number);
  const weighted = (weights: number[]) => digits.reduce((acc, d, i) => acc + d * weights[i]!, 0) % 11;
  const first = weighted(WEIGHTS_1);
  if (first !== 10) return first;
  const second = weighted(WEIGHTS_2);
  return second === 10 ? null : second;
}

export function isValidIin(value: string): boolean {
  if (!/^\d{12}$/.test(value)) return false;
  return controlDigit(value.slice(0, 11)) === Number(value[11]);
}

/** Дата рождения и пол из ИИН: седьмая цифра - век и пол (3/4 - XX век, 5/6 - XXI, нечётная - мужской). */
export function iinPerson(value: string): { birthDate: string; gender: 'm' | 'f' } | null {
  if (!isValidIin(value)) return null;
  const marker = Number(value[6]);
  if (marker < 1 || marker > 6) return null;
  const year = 1700 + Math.ceil(marker / 2) * 100 + Number(value.slice(0, 2));
  const iso = `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return { birthDate: iso, gender: marker % 2 === 1 ? 'm' : 'f' };
}
