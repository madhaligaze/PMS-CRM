/** Казахская и русская кириллица латиницей - для подсказки логина: «Жансая Тұрсынова» → «zhansaya.t». */
const MAP: Record<string, string> = {
  а: 'a', ә: 'a', б: 'b', в: 'v', г: 'g', ғ: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', і: 'i',
  к: 'k', қ: 'k', л: 'l', м: 'm', н: 'n', ң: 'n', о: 'o', ө: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ұ: 'u', ү: 'u',
  ф: 'f', х: 'kh', һ: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function translit(s: string): string {
  return [...s.toLowerCase()].map((ch) => MAP[ch] ?? (/[a-z0-9]/.test(ch) ? ch : '')).join('');
}

/** Логин из «Имя Фамилия»: имя и первая буква фамилии. */
export function suggestLogin(fullName: string): string {
  const [first = '', last = ''] = fullName.trim().split(/\s+/);
  const a = translit(first);
  const b = translit(last).slice(0, 1);
  return a ? (b ? `${a}.${b}` : a) : '';
}
