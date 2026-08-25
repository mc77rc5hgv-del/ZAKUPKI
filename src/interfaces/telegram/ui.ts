import { InlineKeyboard } from "grammy";

export const mainMenu = () => new InlineKeyboard()
  .text("🔎 Поиск", "search").text("🎛 Фильтры", "filters").row()
  .text("📄 Карточка", "card").text("🧠 Анализ", "analyze").row()
  .text("🗂 Досье", "dossier").text("📝 Черновик", "drafthelp").row()
  .text("✅ Готовность", "readiness").text("💰 Экономика", "economicshelp").row()
  .text("⭐ Избранное", "favorites").text("🔔 Мониторинг", "watches").row()
  .text("📋 Воронка", "pipeline").text("⏰ Дедлайны", "deadlines").row()
  .text("🧭 Кабинет РТС", "workspace").text("🛠 Фильтры сайта", "sitefilters").row()
  .text("🔐 Сессия РТС", "session").text("👤 Роль", "role").row()
  .text("ℹ️ Помощь", "help");

export const helpText = `Бот работает через локальный MCP-мост РТС.

/search текст — простой поиск
/filter имя | параметры — сохранить сложный фильтр
/filters — профили фильтров
/deadlines 14 — ближайшие сроки
/card URL — карточка
/analyze URL — анализ рисков
/dossier URL — полное досье закупки
/track URL — сохранить снимок и найти изменения
/compare URL1 URL2 — сравнить закупки
/draft URL | цена=...; количество=...; поставка=... — план черновика предложения
/readiness URL — готовность к участию и блокирующие риски
/economics параметры — предельная цена и безопасное снижение
/workplan URL — план подготовки от дедлайна назад
/watch текст — простой мониторинг
/watchfilter ID — мониторинг по профилю
/favorites — избранное
/queue — рабочая воронка
/stage стадия URL — изменить стадию
/session — состояние площадки
/workspace — функции текущего кабинета РТС
/sitefilter параметры — применить фильтры прямо на сайте
/documents URL — скачать все документы карточки
/tables URL — извлечь таблицы карточки
/role — рабочая роль

Формат фильтра: ключи=ноутбук, компьютер; исключить=ремонт; минцена=100000; максцена=3000000; заказчик=администрация; регион=Краснодар; окпд=26.20; дней=3-20; документы=да; сорт=срок`;

export const botCommands = [
  { command: "search", description: "Поиск закупок" },
  { command: "filter", description: "Создать сложный фильтр" },
  { command: "filters", description: "Профили фильтров" },
  { command: "deadlines", description: "Ближайшие сроки" },
  { command: "digest", description: "Дайджест по профилям" },
  { command: "card", description: "Карточка закупки" },
  { command: "analyze", description: "AI-анализ рисков" },
  { command: "dossier", description: "Полное досье закупки" },
  { command: "track", description: "Контроль изменений карточки" },
  { command: "compare", description: "Сравнить две закупки" },
  { command: "draft", description: "Черновик ценового предложения" },
  { command: "readiness", description: "Готовность к участию" },
  { command: "economics", description: "Экономика и предельная цена" },
  { command: "workplan", description: "План подготовки заявки" },
  { command: "watch", description: "Мониторинг новых закупок" },
  { command: "queue", description: "Рабочая воронка" },
  { command: "favorites", description: "Избранное" },
  { command: "session", description: "Состояние РТС" },
  { command: "workspace", description: "Возможности кабинета РТС" },
  { command: "sitefilter", description: "Применить фильтры на площадке" },
  { command: "documents", description: "Скачать документы карточки" },
  { command: "tables", description: "Извлечь таблицы карточки" },
  { command: "role", description: "Рабочая роль" },
  { command: "help", description: "Помощь" },
];
