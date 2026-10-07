import { dateTime, money } from '@/lib/format';
import { BOOKING_SOURCE, COUNTRY, DOC_TYPE, HK_STATUS, MEAL, PAYMENT_TYPE } from '@/lib/labels';

/** Человеческие подписи действий журнала. Неизвестное действие показывается кодом. */
const ACTIONS: Record<string, string> = {
  'auth.login': 'Вход в систему',
  'booking.create': 'Бронь создана',
  'booking.update': 'Бронь изменена',
  'booking.dates': 'Даты брони изменены',
  'booking.move': 'Переселение / перенос в другой номер',
  'booking.confirmed': 'Бронь подтверждена',
  'booking.cancelled': 'Бронь отменена',
  'booking.no_show': 'Незаезд',
  'booking.checked_in': 'Заселение',
  'booking.checked_out': 'Выселение',
  'payment.payment': 'Оплата',
  'payment.refund': 'Возврат',
  'payment.deposit': 'Депозит',
  'payment.deposit_return': 'Возврат депозита',
  'payment.storno': 'Сторно оплаты',
  'charge.create': 'Начисление',
  'charge.storno': 'Сторно начисления',
  'guest.create': 'Карточка гостя создана',
  'guest.update': 'Карточка гостя изменена',
  'guest.merge': 'Карточки объединены',
  'guest.merged_into': 'Карточка объединена с другой',
  'guest.pd_consent': 'Согласие на обработку данных',
  'guest.document.add': 'Скан документа добавлен',
  'guest.document.view': 'Просмотр скана документа',
  'room.hk_status': 'Состояние номера',
  'room.block': 'Номер заблокирован',
  'room.unblock': 'Блокировка снята',
  'room.dnd': '«Не беспокоить»',
  'room.create': 'Номер добавлен',
  'room.update': 'Номер изменён',
  'room_type.create': 'Тип номера добавлен',
  'room_type.update': 'Тип номера изменён',
  'shift.open': 'Смена открыта',
  'shift.close': 'Смена закрыта (Z-отчёт)',
  'shift.accept': 'Смена принята',
  'cash.withdrawal': 'Выемка наличных',
  'cash.deposit': 'Внесение наличных',
  'hk_task.create': 'Задача уборки создана',
  'hk_task.assign': 'Задача уборки назначена',
  'hk_task.start': 'Уборка начата',
  'hk_task.finish': 'Уборка закончена',
  'hk_task.inspect': 'Номер принят супервайзером',
  'hk_task.return': 'Возврат на доуборку',
  'hk_task.skip': 'Уборка пропущена',
  'hk.day_plan': 'План уборки на день',
  'maintenance.create': 'Заявка на ремонт',
  'maintenance.take': 'Заявка взята в работу',
  'maintenance.close': 'Заявка закрыта',
  'maintenance.cancel': 'Заявка отменена',
  'attendance.in': 'Приход',
  'attendance.out': 'Уход',
  'attendance.correct': 'Исправление отметки',
  'attendance.manual': 'Отметка добавлена вручную',
  'staff.create': 'Сотрудник нанят',
  'staff.update': 'Сотрудник изменён',
  'staff.rights': 'Права сотрудника',
  'staff.block': 'Вход заблокирован',
  'staff.unblock': 'Вход разблокирован',
  'staff.sessions_end': 'Сеансы сотрудника завершены',
  'staff.archive': 'Сотрудник уволен',
  'staff.restore': 'Сотрудник возвращён на работу',
  'staff.password_reset': 'Пароль сотрудника сброшен',
  'staff.pin_reset': 'PIN сотрудника сброшен',
  'position.create': 'Должность заведена',
  'position.update': 'Должность изменена',
  'position.archive': 'Должность убрана',
  'position.apply': 'Права должности применены ко всем',
  'setup.done': 'Гостиница зарегистрирована',
  'user.profile': 'Имя или телефон изменены',
  'user.password_change': 'Смена пароля',
  'user.pin_change': 'Смена PIN',
  'user.totp_enable': 'Второй фактор включён',
  'user.totp_disable': 'Второй фактор выключен',
  'property.settings': 'Настройки гостиницы',
  'rate_plan.create': 'Тариф создан',
  'rate_plan.update': 'Тариф изменён',
  'rate_price.create': 'Цена тарифа добавлена',
  'rate_price.update': 'Цена тарифа изменена',
  'company.create': 'Компания добавлена',
  'company.update': 'Компания изменена',
  'group.create': 'Групповая бронь создана',
  'system.seed': 'Демо-данные',
};

export const describeAction = (a: string) => ACTIONS[a] ?? a;

const FIELDS: Record<string, string> = {
  status: 'Статус',
  roomId: 'Номер',
  room: 'Номер',
  arrival: 'Заезд',
  departure: 'Выезд',
  dates: 'Даты',
  adults: 'Взрослых',
  children: 'Детей',
  meal: 'Питание',
  source: 'Источник',
  paymentType: 'Тип оплаты',
  priceMode: 'Цена',
  discountPercent: 'Скидка, %',
  specialNightly: 'Спеццена за ночь',
  priceReason: 'Основание цены',
  accommodationTotal: 'Проживание',
  baseTotal: 'По тарифу',
  mealTotal: 'Завтраки',
  comment: 'Комментарий',
  guest: 'Гость',
  total: 'Сумма',
  hkStatus: 'Состояние',
  lastName: 'Фамилия',
  firstName: 'Имя',
  middleName: 'Отчество',
  phone: 'Телефон',
  email: 'Почта',
  docNumber: 'Документ',
  docType: 'Вид документа',
  docIssuedBy: 'Кем выдан',
  docIssuedOn: 'Дата выдачи',
  docExpiresOn: 'Действует до',
  personalNumber: 'ИИН',
  citizenship: 'Гражданство',
  birthDate: 'Дата рождения',
  gender: 'Пол',
  address: 'Адрес',
  language: 'Язык общения',
  isVip: 'VIP',
  blacklisted: 'Чёрный список',
  openingCash: 'Остаток на начало',
  expectedCash: 'Расчётные наличные',
  countedCash: 'Пересчитано',
  discrepancy: 'Расхождение',
  dnd: 'Не беспокоить',
  block: 'Блокировка',
  note: 'Примечание',
  assigneeId: 'Исполнитель',
  skipReason: 'Причина пропуска',
  prepaymentAmount: 'Предоплата',
  prepaymentDueAt: 'Срок предоплаты',
  fullName: 'Имя',
  login: 'Логин',
  position: 'Должность',
  access: 'Доступ',
  isActive: 'Вход открыт',
  name: 'Название',
  owner: 'Владелец',
  updated: 'Сотрудников',
  client: 'Устройство',
  reason: 'Причина',
  kind: 'Отметка',
  at: 'Время',
  demo: 'Описание',
  date: 'Дата',
  stayovers: 'Ежедневных уборок',
};

const MONEY_FIELDS = new Set(['accommodationTotal', 'baseTotal', 'mealTotal', 'total', 'specialNightly', 'openingCash', 'expectedCash', 'countedCash', 'discrepancy', 'prepaymentAmount']);

export type DescribeCtx = { currency: string; tz: string };

const CLIENTS: Record<string, string> = { web: 'браузер', mobile: 'телефон', kiosk: 'планшет прихода' };

function fmt(field: string, v: unknown, { currency, tz }: DescribeCtx): string {
  if (v === null || v === undefined || v === '') return '-';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (MONEY_FIELDS.has(field) && typeof v === 'number') return money(v, currency);
  if (field === 'kind' && (v === 'in' || v === 'out')) return v === 'in' ? 'приход' : 'уход';
  if (field === 'client' && typeof v === 'string') return CLIENTS[v] ?? v;
  if (field === 'gender' && typeof v === 'string') return v === 'f' ? 'женский' : 'мужской';
  if (field === 'citizenship' && typeof v === 'string') return COUNTRY[v] ?? v;
  if (field === 'docType' && typeof v === 'string') return DOC_TYPE[v] ?? v;
  if (field === 'meal' && typeof v === 'string') return MEAL[v] ?? v;
  if (field === 'source' && typeof v === 'string') return BOOKING_SOURCE[v] ?? v;
  if (field === 'paymentType' && typeof v === 'string') return PAYMENT_TYPE[v] ?? v;
  if (field === 'hkStatus' && typeof v === 'string') return HK_STATUS[v] ?? v;
  // Моменты - по часам гостиницы, а не браузера.
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v, tz);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** «Выезд: 10.10 → 11.10». Поля-идентификаторы показываются без значений; суммы - в валюте гостиницы. */
export function describeChange(field: string, [before, after]: [unknown, unknown], ctx: DescribeCtx): string {
  const label = FIELDS[field] ?? field;
  if (/Id$|^id$/.test(field)) return `${label}: изменено`;
  if (before === null || before === undefined) return `${label}: ${fmt(field, after, ctx)}`;
  if (after === null || after === undefined) return `${label}: было ${fmt(field, before, ctx)}`;
  return `${label}: ${fmt(field, before, ctx)} → ${fmt(field, after, ctx)}`;
}
