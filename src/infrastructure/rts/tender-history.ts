import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Tender } from "../../domain/procurement.js";
import { config } from "./config.js";

// A small local archive of tenders our own browser has already seen (through
// search or a dossier build), used only to compute price statistics for the
// Mini App's analytics screen. This is not a crawl of the whole portal and
// carries no participant-count or auction-result data — RTS does not expose
// that on the pages we read — so statistics here are always scoped to "what
// this deployment has already browsed", and the UI must say so.

export type ObservedTender = { url: string; title: string; customer?: string; price?: number; okpd2: string[]; location?: string; capturedAt: string };
type Database = { tenders: Record<string, ObservedTender> };

const MAX_ENTRIES = 20_000;
const file = () => path.join(config.historyDir, "observed-tenders.json");

async function load(): Promise<Database> {
  try {
    const raw = JSON.parse(await fs.readFile(file(), "utf8"));
    return { tenders: raw?.tenders && typeof raw.tenders === "object" ? raw.tenders : {} };
  } catch { return { tenders: {} }; }
}

async function save(db: Database): Promise<void> {
  await fs.mkdir(config.historyDir, { recursive: true, mode: 0o700 });
  const temp = `${file()}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(temp, file());
  await fs.chmod(file(), 0o600).catch(() => {});
}

export async function recordObservedTenders(tenders: Tender[]): Promise<void> {
  const withPrice = tenders.filter(t => t.url && t.price !== undefined && Number.isFinite(t.price));
  if (!withPrice.length) return;
  const db = await load();
  const now = new Date().toISOString();
  for (const t of withPrice) db.tenders[t.url] = { url: t.url, title: t.title.slice(0, 300), customer: t.customer?.slice(0, 200), price: t.price, okpd2: t.okpd2.slice(0, 20), location: t.location?.slice(0, 200), capturedAt: now };
  const entries = Object.values(db.tenders);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    for (const stale of entries.slice(0, entries.length - MAX_ENTRIES)) delete db.tenders[stale.url];
  }
  await save(db);
}

export type PriceStats = { count: number; min: number; max: number; avg: number; median: number };

export async function priceStatistics(filter: { okpd2?: string; customer?: string; query?: string } = {}): Promise<PriceStats | undefined> {
  const db = await load();
  const okpd2 = filter.okpd2?.trim();
  const customer = filter.customer?.trim().toLowerCase();
  const query = filter.query?.trim().toLowerCase();
  const rows = Object.values(db.tenders).filter(t =>
    (!okpd2 || t.okpd2.some(code => code.startsWith(okpd2))) &&
    (!customer || (t.customer ?? "").toLowerCase().includes(customer)) &&
    (!query || `${t.title} ${t.customer ?? ""}`.toLowerCase().includes(query)));
  if (!rows.length) return undefined;
  const prices = rows.map(t => t.price!).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const sum = prices.reduce((a, b) => a + b, 0);
  return { count: prices.length, min: Math.round(prices[0]), max: Math.round(prices[prices.length - 1]), avg: Math.round(sum / prices.length), median: Math.round(median) };
}
