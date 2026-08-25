export type RawRequest = { title: string; url: string; summary: string };
export type Tender = RawRequest & {
  number?: string; customer?: string; price?: number; currency: "RUB";
  publishedAt?: string; deadlineAt?: string; status?: string; location?: string;
  okpd2: string[]; hasDocuments: boolean; daysLeft?: number; score?: number;
  matched: string[]; warnings: string[];
};

export type TenderFilter = {
  query?: string; includeKeywords?: string[]; excludeKeywords?: string[];
  minPrice?: number; maxPrice?: number; customer?: string; location?: string;
  status?: string; okpd2?: string[]; deadlineFrom?: string; deadlineTo?: string;
  minDaysLeft?: number; maxDaysLeft?: number; requireDocuments?: boolean;
  sort?: "relevance" | "price_asc" | "price_desc" | "deadline_asc" | "published_desc";
};

const normalize = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const iso = (d: Date) => Number.isNaN(d.getTime()) ? undefined : d.toISOString();
function parseRuDate(value: string): string | undefined {
  const m = value.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  return iso(new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0)));
}
function labelled(text: string, labels: string[]): string | undefined {
  const escaped = labels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.match(new RegExp(`(?:${escaped})\\s*[:–-]?\\s*([^\\n]{2,300})`, "i"))?.[1]?.trim();
}
function parseMoney(text: string): number | undefined {
  const labelledValue = labelled(text, ["начальная цена", "нмцк", "максимальная цена", "цена", "сумма"]);
  const source = labelledValue ?? text;
  const candidates = [...source.matchAll(/(?:^|\s)(\d{1,3}(?:[\s\u00a0]\d{3})*(?:[,.]\d{1,2})?)\s*(?:₽|руб(?:\.|лей)?)/gi)];
  const raw = candidates[0]?.[1];
  if (!raw) return undefined;
  const value = Number(raw.replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}
function dateByLabels(text: string, labels: string[]) { const v = labelled(text, labels); return v ? parseRuDate(v) : undefined; }

export function normalizeTender(raw: RawRequest, now = new Date()): Tender {
  const text = `${raw.title}\n${raw.summary}`;
  const deadlineAt = dateByLabels(text, ["окончание подачи", "срок подачи", "прием предложений до", "дата окончания", "окончание приема"]);
  const publishedAt = dateByLabels(text, ["дата публикации", "опубликовано", "размещено"]);
  const number = labelled(text, ["номер закупки", "номер запроса", "извещение", "реестровый номер"])?.match(/[A-ZА-Я0-9][A-ZА-Я0-9._\/-]{3,}/i)?.[0]
    ?? raw.title.match(/(?:№\s*)?([A-ZА-Я0-9][A-ZА-Я0-9._\/-]{5,})/i)?.[1];
  const customer = labelled(text, ["заказчик", "организатор", "наименование заказчика"]);
  const location = labelled(text, ["место поставки", "регион поставки", "адрес поставки"]);
  const status = labelled(text, ["статус", "этап"]);
  const okpd2 = [...text.matchAll(/\b(?:ОКПД\s*2?\s*[:–-]?\s*)?(\d{2}(?:\.\d{1,3}){1,4})\b/gi)]
    .filter(x => !/^\.\d{4}/.test(text.slice((x.index ?? 0) + x[0].length)))
    .map(x => x[1]);
  const daysLeft = deadlineAt ? Math.ceil((new Date(deadlineAt).getTime() - now.getTime()) / 86_400_000) : undefined;
  const warnings: string[] = [];
  if (daysLeft !== undefined && daysLeft < 0) warnings.push("Срок подачи истёк");
  else if (daysLeft !== undefined && daysLeft <= 2) warnings.push("До окончания подачи менее 3 дней");
  if (!deadlineAt) warnings.push("Срок подачи не распознан");
  return { ...raw, number, customer, price: parseMoney(text), currency: "RUB", publishedAt, deadlineAt, status, location, okpd2: [...new Set(okpd2)], hasDocuments: /документ|вложен|файл|\.pdf|\.docx?|\.xlsx?/i.test(text), daysLeft, matched: [], warnings };
}

export function filterTenders(rows: Tender[], filter: TenderFilter): Tender[] {
  const include = (filter.includeKeywords ?? []).map(normalize).filter(Boolean);
  const exclude = (filter.excludeKeywords ?? []).map(normalize).filter(Boolean);
  const queryWords = normalize(filter.query ?? "").split(" ").filter(Boolean);
  const result = rows.flatMap(row => {
    const hay = normalize(`${row.title} ${row.summary} ${row.customer ?? ""} ${row.location ?? ""} ${row.okpd2.join(" ")}`);
    if (queryWords.length && !queryWords.every(x => hay.includes(x))) return [];
    if (include.length && !include.some(x => hay.includes(x))) return [];
    if (exclude.some(x => hay.includes(x))) return [];
    if (filter.minPrice !== undefined && (row.price === undefined || row.price < filter.minPrice)) return [];
    if (filter.maxPrice !== undefined && (row.price === undefined || row.price > filter.maxPrice)) return [];
    if (filter.customer && !hay.includes(normalize(filter.customer))) return [];
    if (filter.location && !normalize(row.location ?? row.summary).includes(normalize(filter.location))) return [];
    if (filter.status && !normalize(row.status ?? row.summary).includes(normalize(filter.status))) return [];
    if (filter.okpd2?.length && !filter.okpd2.some(code => row.okpd2.some(x => x.startsWith(code)))) return [];
    if (filter.deadlineFrom && (!row.deadlineAt || row.deadlineAt < new Date(filter.deadlineFrom).toISOString())) return [];
    if (filter.deadlineTo && (!row.deadlineAt || row.deadlineAt > new Date(filter.deadlineTo).toISOString())) return [];
    if (filter.minDaysLeft !== undefined && (row.daysLeft === undefined || row.daysLeft < filter.minDaysLeft)) return [];
    if (filter.maxDaysLeft !== undefined && (row.daysLeft === undefined || row.daysLeft > filter.maxDaysLeft)) return [];
    if (filter.requireDocuments && !row.hasDocuments) return [];
    const matched = [...include, ...queryWords].filter(x => hay.includes(x));
    const score = scoreTender(row, filter, matched);
    return [{ ...row, matched, score }];
  });
  const sort = filter.sort ?? "relevance";
  return result.sort((a, b) => sort === "price_asc" ? (a.price ?? Infinity) - (b.price ?? Infinity)
    : sort === "price_desc" ? (b.price ?? -1) - (a.price ?? -1)
    : sort === "deadline_asc" ? (a.deadlineAt ?? "9999").localeCompare(b.deadlineAt ?? "9999")
    : sort === "published_desc" ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "")
    : (b.score ?? 0) - (a.score ?? 0));
}

function scoreTender(row: Tender, filter: TenderFilter, matched: string[]) {
  let score = 35 + Math.min(35, matched.length * 10);
  if (row.price !== undefined) score += 5;
  if (row.deadlineAt) score += 5;
  if (row.hasDocuments) score += 5;
  if (filter.customer && normalize(row.customer ?? "").includes(normalize(filter.customer))) score += 10;
  if (row.daysLeft !== undefined && row.daysLeft >= 3) score += 5;
  if (row.daysLeft !== undefined && row.daysLeft < 0) score -= 50;
  return Math.max(0, Math.min(100, score));
}

export function analyzeDeterministic(tender: Tender) {
  const checks = [
    { key: "deadline", ok: Boolean(tender.deadlineAt), value: tender.deadlineAt, message: "Срок подачи" },
    { key: "price", ok: tender.price !== undefined, value: tender.price, message: "Начальная/максимальная цена" },
    { key: "customer", ok: Boolean(tender.customer), value: tender.customer, message: "Заказчик" },
    { key: "documents", ok: tender.hasDocuments, value: tender.hasDocuments, message: "Документы" },
    { key: "location", ok: Boolean(tender.location), value: tender.location, message: "Место поставки" },
  ];
  const completeness = Math.round(checks.filter(x => x.ok).length / checks.length * 100);
  return { tender, completeness, checks, warnings: tender.warnings, recommendation: completeness >= 80 && !tender.warnings.some(x => /истёк/.test(x)) ? "Перейти к изучению документации" : "Сначала уточнить отсутствующие или критические данные" };
}
