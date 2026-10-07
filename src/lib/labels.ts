/** Подписи перечислений API. Коды стабильны, подписи - для людей. */

export const BOOKING_STATUS: Record<string, string> = {
  tentative: 'Предварительная',
  confirmed: 'Подтверждена',
  checked_in: 'Заселён',
  checked_out: 'Выселен',
  cancelled: 'Отменена',
  no_show: 'Незаезд',
};

export const BOOKING_SOURCE: Record<string, string> = {
  phone: 'Телефон, колл-центр',
  walk_in: 'Ресепшен, с улицы',
  website: 'Сайт',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  booking_com: 'Booking.com',
  ota_other: 'Другая OTA',
  email: 'Почта',
  other: 'Другое',
};

export const PAYMENT_TYPE: Record<string, string> = {
  cash: 'Наличные',
  cashless: 'Безналичные',
  special: 'Спеццена',
};

export const PAYMENT_METHOD: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  qr: 'QR / перевод',
  transfer: 'Банковский перевод',
  invoice: 'Безнал по счёту',
};

export const PAYMENT_KIND: Record<string, string> = {
  payment: 'Оплата',
  refund: 'Возврат',
  deposit: 'Депозит',
  deposit_return: 'Возврат депозита',
};

export const CHARGE_KIND: Record<string, string> = {
  minibar: 'Мини-бар',
  restaurant: 'Ресторан',
  laundry: 'Прачечная',
  transfer: 'Трансфер',
  damage: 'Порча имущества',
  breakfast: 'Завтрак',
  service: 'Услуга',
  other: 'Прочее',
};

export const HK_STATUS: Record<string, string> = {
  dirty: 'Грязный',
  cleaning: 'В уборке',
  clean: 'Убран',
  inspected: 'Проверен',
  repair: 'На ремонте',
};

export const HK_TASK_KIND: Record<string, string> = {
  departure: 'После выезда',
  stayover: 'Ежедневная',
  request: 'По запросу',
  general: 'Генеральная',
};

export const HK_TASK_STATUS: Record<string, string> = {
  open: 'Ждёт',
  in_progress: 'В работе',
  done: 'Убрано',
  inspected: 'Принято',
  skipped: 'Пропущено',
  cancelled: 'Отменено',
};

export const OCCUPANCY: Record<string, string> = {
  free: 'Свободен',
  occupied: 'Живут',
  arrival: 'Заезд',
  departure: 'Выезд',
  turnover: 'Выезд и заезд',
  blocked: 'Ремонт',
};

export const URGENCY: Record<string, string> = {
  low: 'Не срочно',
  normal: 'Обычная',
  high: 'Срочно',
  critical: 'Авария',
};

export const MAINT_STATUS: Record<string, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  done: 'Закрыта',
  cancelled: 'Отменена',
};

export const DOC_TYPE: Record<string, string> = {
  passport: 'Паспорт РК',
  id_card: 'Удостоверение личности',
  foreign_passport: 'Иностранный паспорт',
  residence_permit: 'Вид на жительство',
  other: 'Другой документ',
};

export const MEAL: Record<string, string> = { none: 'Без питания', breakfast: 'Завтрак' };

export const PRICE_MODE: Record<string, string> = { rate: 'По тарифу', discount: 'Скидка', special: 'Спеццена' };

/** Частые гражданства сверху списка; остальные - кодом ISO. */
export const COUNTRIES: [string, string][] = [
  ['KAZ', 'Казахстан'],
  ['RUS', 'Россия'],
  ['UZB', 'Узбекистан'],
  ['CHN', 'Китай'],
  ['TUR', 'Турция'],
  ['KOR', 'Республика Корея'],
  ['IND', 'Индия'],
  ['DEU', 'Германия'],
  ['USA', 'США'],
  ['GBR', 'Великобритания'],
  ['BLR', 'Беларусь'],
  ['ARE', 'ОАЭ'],
  ['FRA', 'Франция'],
  ['JPN', 'Япония'],
];
export const COUNTRY = Object.fromEntries(COUNTRIES) as Record<string, string>;

/** Язык общения с гостем: на нём поздравления и сообщения. Код ISO 639-1. */
export const LANGUAGES: [string, string][] = [
  ['kk', 'Казахский'],
  ['ru', 'Русский'],
  ['en', 'Английский'],
  ['zh', 'Китайский'],
  ['tr', 'Турецкий'],
  ['ko', 'Корейский'],
  ['de', 'Немецкий'],
  ['fr', 'Французский'],
];
export const LANGUAGE = Object.fromEntries(LANGUAGES) as Record<string, string>;
