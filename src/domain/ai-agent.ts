import { z } from "zod";

const nullableText = z.string().nullable();
const nullableMoney = z.number().nonnegative().nullable();

export const requirementSchema = z.object({
  name: z.string(),
  requiredValue: z.string(),
  unit: nullableText,
  critical: z.boolean(),
  acceptableDeviation: nullableText,
  evidence: z.string(),
});

export const lineItemSchema = z.object({
  name: z.string(),
  quantity: z.number().positive().nullable(),
  unit: nullableText,
  requirements: z.array(requirementSchema),
});

export const productCandidateSchema = z.object({
  lineItemName: z.string(),
  title: z.string(),
  seller: z.string(),
  marketplace: z.string(),
  url: z.string(),
  priceRub: nullableMoney,
  deliveryRub: nullableMoney,
  totalUnitCostRub: nullableMoney,
  availability: z.string(),
  matchType: z.enum(["exact", "better", "acceptable", "worse"]),
  matchScore: z.number().min(0).max(100),
  confirmedRequirements: z.array(z.string()),
  deviations: z.array(z.string()),
  sellerRisks: z.array(z.string()),
  checkedAt: z.string(),
});

const riskSchema = z.object({
  level: z.enum(["critical", "high", "medium", "low"]),
  title: z.string(),
  evidence: z.string(),
  action: z.string(),
});

export const sourcingReportSchema = z.object({
  summary: z.string(),
  tenderTitle: nullableText,
  customer: nullableText,
  deliveryRegion: nullableText,
  deadline: nullableText,
  budgetRub: nullableMoney,
  lineItems: z.array(lineItemSchema),
  candidates: z.array(productCandidateSchema),
  risks: z.array(riskSchema),
  suspiciousConstraints: z.array(z.string()),
  goNoGo: z.enum(["GO", "CONDITIONAL", "NO_GO"]),
  goNoGoReasons: z.array(z.string()),
  questionsToCustomer: z.array(z.string()),
  deliveryEstimateNote: z.string(),
  disclaimer: z.string(),
});

export type SourcingReport = z.infer<typeof sourcingReportSchema>;

const allowedDomains = [
  "ozon.ru", "wildberries.ru", "market.yandex.ru", "aliexpress.ru",
  "vseinstrumenti.ru", "dns-shop.ru", "citilink.ru", "mvideo.ru",
  "eldorado.ru", "onlinetrade.ru", "komus.ru", "sima-land.ru",
  "220-volt.ru", "petrovich.ru", "leroymerlin.ru", "regard.ru",
  "hoff.ru", "detmir.ru", "askona.ru", "sportmaster.ru",
] as const;

export const russianSupplierDomains = [...allowedDomains];

export function isAllowedSupplierUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    return allowedDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function normalizeSourcingReport(report: SourcingReport): SourcingReport {
  const candidates = report.candidates
    .filter(candidate => isAllowedSupplierUrl(candidate.url))
    .map(candidate => ({
      ...candidate,
      matchScore: Math.max(0, Math.min(100, Math.round(candidate.matchScore))),
      totalUnitCostRub: candidate.priceRub === null
        ? null
        : Math.round((candidate.priceRub + (candidate.deliveryRub ?? 0)) * 100) / 100,
    }))
    .sort((a, b) => {
      const matchOrder = { exact: 0, better: 1, acceptable: 2, worse: 3 };
      const byType = matchOrder[a.matchType] - matchOrder[b.matchType];
      if (byType) return byType;
      return (a.totalUnitCostRub ?? Number.MAX_SAFE_INTEGER) - (b.totalUnitCostRub ?? Number.MAX_SAFE_INTEGER);
    });
  return { ...report, candidates };
}

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

export function sourcingReportCsv(report: SourcingReport): string {
  const header = ["Позиция", "Товар", "Продавец", "Площадка", "Цена, ₽", "Доставка, ₽", "Итого за единицу, ₽", "Соответствие", "Оценка, %", "Отклонения", "Риски продавца", "Ссылка", "Проверено"];
  const rows = report.candidates.map(item => [
    item.lineItemName, item.title, item.seller, item.marketplace, item.priceRub,
    item.deliveryRub, item.totalUnitCostRub, item.matchType, item.matchScore,
    item.deviations.join("; "), item.sellerRisks.join("; "), item.url, item.checkedAt,
  ]);
  return `\uFEFF${[header, ...rows].map(row => row.map(csvCell).join(";")).join("\r\n")}`;
}
