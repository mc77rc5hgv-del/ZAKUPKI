import OpenAI from "openai";
import { botConfig } from "../../config/bot.js";

const instructions = `Ты — помощник специалиста по государственным закупкам РФ. Анализируй только переданный текст карточки и документов, не выдумывай факты. Разделяй установленные факты, риски и вопросы для ручной проверки. Учитывай сроки, обеспечение, допуски, лицензии, опыт, место поставки, оплату, штрафы, односторонний отказ, соответствие предмета компетенциям поставщика. Это аналитическая поддержка, не юридическое заключение. Не рекомендуй обход правил площадки.`;

export async function analyzeTender(data: unknown, role: "operator" | "participant") {
  if (!process.env.OPENAI_API_KEY) return fallback(data);
  const openai = new OpenAI();
  const response = await openai.responses.create({
    model: botConfig.openaiModel,
    instructions,
    input: `Роль пользователя: ${role}. Подготовь сжатый русский отчет: резюме, ключевые сроки, требования, экономика, риски с критичностью, перечень недостающих данных, чек-лист действий. Данные:\n${JSON.stringify(data).slice(0, 120_000)}`,
    store: false,
  });
  return response.output_text;
}

function fallback(data: unknown) {
  const text = JSON.stringify(data, null, 2);
  const dates = [...text.matchAll(/\b\d{2}[.\/-]\d{2}[.\/-]\d{4}(?:\s+\d{2}:\d{2})?/g)].map(x => x[0]);
  const money = [...text.matchAll(/\b[\d ]+(?:[,.]\d{2})?\s*(?:₽|руб)/gi)].map(x => x[0]);
  return `Базовый анализ (OPENAI_API_KEY не настроен)\n\nНайденные даты: ${[...new Set(dates)].slice(0, 20).join(", ") || "нет"}\nСуммы: ${[...new Set(money)].slice(0, 20).join(", ") || "нет"}\n\nПроверьте вручную: срок подачи, обеспечение, требования к участнику, ТЗ, проект договора, оплату, штрафы, лицензии и место поставки.`;
}
