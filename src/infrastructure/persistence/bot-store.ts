import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { botConfig } from "../../config/bot.js";
import type { TenderFilter } from "../../domain/procurement.js";
import { readStoreFile, writeStoreFile } from "../security/encrypted-store.js";

export type Watch = { id: string; name: string; filter: TenderFilter; enabled: boolean; createdAt: string; lastUrls: string[]; fingerprints: Record<string, string> };
export type FilterProfile = { id: string; name: string; filter: TenderFilter; createdAt: string };
export type PipelineStage = "new" | "review" | "decision" | "prepare" | "submitted" | "won" | "lost" | "archived";
export type PipelineHistoryEntry = { stage: PipelineStage; at: string };
export type PipelineItem = { url: string; title: string; stage: PipelineStage; note?: string; assignee?: string; deadlineAt?: string; updatedAt: string; history: PipelineHistoryEntry[] };
export type TrackedChange = { url: string; title: string; detectedAt: string; changes: Array<{ field: string; before: unknown; after: unknown; severity: "info" | "warning" | "critical" }> };
export type UserData = { role: "operator" | "participant"; favorites: Record<string, { title: string; url: string; addedAt: string }>; watches: Watch[]; profiles: FilterProfile[]; pipeline: Record<string, PipelineItem>; trackedChanges: Record<string, TrackedChange> };
type Database = { users: Record<string, UserData> };

const MAX_ITEMS = 1_000, MAX_PROFILES = 100, MAX_TEXT = 500, MAX_NOTE = 5_000, MAX_URL = 2_048;
const stages = new Set<PipelineStage>(["new", "review", "decision", "prepare", "submitted", "won", "lost", "archived"]);
const sorts = new Set<NonNullable<TenderFilter["sort"]>>(["relevance", "price_asc", "price_desc", "deadline_asc", "published_desc"]);
const configuredOrigin = new URL(process.env.RTS_BASE_URL ?? "https://krd-market.rts-tender.ru/zapros/").origin;
const dictionary = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
let db: Database = { users: dictionary<UserData>() };
let loaded = false;

function text(value: unknown, max: number, field: string): string {
  if (typeof value !== "string") throw new Error(`${field}: ожидается строка`);
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!clean || clean.length > max) throw new Error(`${field}: недопустимая длина`);
  return clean;
}
function optionalText(value: unknown, max: number, field: string): string | undefined {
  return value === undefined || value === null || value === "" ? undefined : text(value, max, field);
}
function rtsUrl(value: unknown): string {
  const raw = text(value, MAX_URL, "URL");
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("URL: неверный формат"); }
  if (parsed.protocol !== "https:" || parsed.origin !== configuredOrigin || parsed.username || parsed.password) throw new Error("Разрешены только HTTPS-ссылки площадки РТС");
  return parsed.href;
}
function safeDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = new Date(text(value, 64, field));
  if (Number.isNaN(date.getTime())) throw new Error(`${field}: неверная дата`);
  return date.toISOString();
}
function finite(value: unknown, field: string, min = 0, max = 1e15): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${field}: неверное число`);
  return value;
}
function words(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error(`${field}: неверный список`);
  return value.map((item) => text(item, 100, field));
}
function cleanFilter(input: unknown): TenderFilter {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Фильтр: ожидается объект");
  const value = input as Record<string, unknown>;
  const sort = value.sort === undefined ? undefined : text(value.sort, 32, "Сортировка") as NonNullable<TenderFilter["sort"]>;
  if (sort && !sorts.has(sort)) throw new Error("Сортировка: неизвестное значение");
  if (value.requireDocuments !== undefined && typeof value.requireDocuments !== "boolean") throw new Error("requireDocuments: ожидается boolean");
  const result: TenderFilter = {
    query: optionalText(value.query, MAX_TEXT, "Запрос"), includeKeywords: words(value.includeKeywords, "Ключевые слова"), excludeKeywords: words(value.excludeKeywords, "Исключения"),
    minPrice: finite(value.minPrice, "Минимальная цена"), maxPrice: finite(value.maxPrice, "Максимальная цена"), customer: optionalText(value.customer, MAX_TEXT, "Заказчик"),
    location: optionalText(value.location, MAX_TEXT, "Регион"), status: optionalText(value.status, 100, "Статус"), okpd2: words(value.okpd2, "ОКПД2"),
    deadlineFrom: safeDate(value.deadlineFrom, "Начало срока"), deadlineTo: safeDate(value.deadlineTo, "Конец срока"), minDaysLeft: finite(value.minDaysLeft, "Минимум дней", -3650, 36500),
    maxDaysLeft: finite(value.maxDaysLeft, "Максимум дней", -3650, 36500), requireDocuments: value.requireDocuments as boolean | undefined, sort,
  };
  return Object.fromEntries(Object.entries(result).filter(([, item]) => item !== undefined)) as TenderFilter;
}
function cleanId(value: unknown): string { const result = text(value, 100, "ID"); if (!/^[A-Za-z0-9._:-]+$/.test(result)) throw new Error("ID: недопустимый формат"); return result; }
function boundedValue(value: unknown): unknown { try { const raw = JSON.stringify(value); return raw && raw.length > 10_000 ? `${raw.slice(0, 9_999)}…` : value; } catch { return "[не сериализуется]"; } }
function cleanChanges(changes: unknown): TrackedChange["changes"] {
  if (!Array.isArray(changes) || changes.length > 100) throw new Error("Некорректный список изменений");
  return changes.map((change: any) => { if (!change || !["info", "warning", "critical"].includes(change.severity)) throw new Error("Некорректная важность изменения"); return { field: text(change.field, 100, "Поле"), before: boundedValue(change.before), after: boundedValue(change.after), severity: change.severity }; });
}
function assertCapacity(record: Record<string, unknown>, key: string) { if (!Object.hasOwn(record, key) && Object.keys(record).length >= MAX_ITEMS) throw new Error(`Достигнут лимит ${MAX_ITEMS} записей`); }
function newUser(): UserData { return { role: "participant", favorites: dictionary(), watches: [], profiles: [], pipeline: dictionary(), trackedChanges: dictionary() }; }

function migrateUser(raw: unknown): UserData {
  const source = raw && typeof raw === "object" ? raw as Partial<UserData> : {};
  const result = newUser();
  result.role = source.role === "operator" ? "operator" : "participant";
  for (const item of Object.values(source.favorites ?? {}).slice(0, MAX_ITEMS)) try { const url = rtsUrl(item?.url); result.favorites[url] = { url, title: text(item?.title ?? url, MAX_TEXT, "Название"), addedAt: safeDate(item?.addedAt, "Дата") ?? new Date().toISOString() }; } catch {}
  result.watches = (source.watches ?? []).slice(0, MAX_PROFILES).flatMap((watch: any) => { try { const value = watch.filter ? watch : { id: watch.id, name: watch.query, filter: { query: watch.query, status: watch.status }, createdAt: watch.createdAt, lastUrls: watch.lastUrls }; return [{ id: cleanId(value.id), name: text(value.name, MAX_TEXT, "Название"), filter: cleanFilter(value.filter), enabled: value.enabled !== false, createdAt: safeDate(value.createdAt, "Дата") ?? new Date().toISOString(), lastUrls: (value.lastUrls ?? []).slice(0, 500).flatMap((url: unknown) => { try { return [rtsUrl(url)]; } catch { return []; } }), fingerprints: dictionary<string>() }]; } catch { return []; } });
  result.profiles = (source.profiles ?? []).slice(0, MAX_PROFILES).flatMap((profile) => { try { return [{ id: cleanId(profile.id), name: text(profile.name, MAX_TEXT, "Название"), filter: cleanFilter(profile.filter), createdAt: safeDate(profile.createdAt, "Дата") ?? new Date().toISOString() }]; } catch { return []; } });
  for (const item of Object.values(source.pipeline ?? {}).slice(0, MAX_ITEMS)) try { const url = rtsUrl(item.url); if (!stages.has(item.stage)) continue; result.pipeline[url] = { url, title: text(item.title, MAX_TEXT, "Название"), stage: item.stage, note: optionalText(item.note, MAX_NOTE, "Заметка"), assignee: optionalText(item.assignee, 200, "Ответственный"), deadlineAt: safeDate(item.deadlineAt, "Срок"), updatedAt: safeDate(item.updatedAt, "Дата") ?? new Date().toISOString(), history: (item.history ?? []).slice(-20).filter((entry) => stages.has(entry.stage)).map((entry) => ({ stage: entry.stage, at: safeDate(entry.at, "Дата") ?? new Date().toISOString() })) }; } catch {}
  for (const item of Object.values(source.trackedChanges ?? {}).slice(0, MAX_ITEMS)) try { const url = rtsUrl(item.url); result.trackedChanges[url] = { url, title: text(item.title, MAX_TEXT, "Название"), detectedAt: safeDate(item.detectedAt, "Дата") ?? new Date().toISOString(), changes: cleanChanges(item.changes) }; } catch {}
  return result;
}

const file = () => path.join(botConfig.dataDir, "bot.json");
export async function loadStore() {
  if (loaded) return;
  await fs.mkdir(botConfig.dataDir, { recursive: true, mode: 0o700 });
  const stored = await readStoreFile<Database>(file(), { users: {} });
  const users = dictionary<UserData>();
  if (stored?.users && typeof stored.users === "object") for (const [key, value] of Object.entries(stored.users)) if (/^\d{1,20}$/.test(key)) users[key] = migrateUser(value);
  db = { users }; loaded = true;
}
async function save() { await writeStoreFile(file(), db); }
export function user(userId: number): UserData { if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("Некорректный Telegram ID"); return db.users[userId] ??= newUser(); }
export async function setRole(userId: number, role: UserData["role"]) { if (role !== "operator" && role !== "participant") throw new Error("Неизвестная роль"); user(userId).role = role; await save(); }
export async function addFavorite(userId: number, rawUrl: string, rawTitle: string) { const url = rtsUrl(rawUrl), data = user(userId); assertCapacity(data.favorites, url); data.favorites[url] = { url, title: text(rawTitle, MAX_TEXT, "Название"), addedAt: new Date().toISOString() }; await save(); }
export async function removeFavorite(userId: number, rawUrl: string) { delete user(userId).favorites[rtsUrl(rawUrl)]; await save(); }
export async function addWatch(userId: number, rawName: string, rawFilter: TenderFilter = { query: rawName }) { const data = user(userId); if (data.watches.length >= MAX_PROFILES) throw new Error(`Достигнут лимит ${MAX_PROFILES} наблюдений`); const watch: Watch = { id: randomUUID(), name: text(rawName, MAX_TEXT, "Название"), filter: cleanFilter(rawFilter), enabled: true, createdAt: new Date().toISOString(), lastUrls: [], fingerprints: dictionary() }; data.watches.push(watch); await save(); return watch; }
export async function removeWatch(userId: number, watchId: string) { const data = user(userId); data.watches = data.watches.filter((watch) => watch.id !== cleanId(watchId)); await save(); }
export async function updateWatch(userId: number, watchId: string, urls: string[], fingerprints: Record<string, string> = {}) { const watch = user(userId).watches.find((item) => item.id === cleanId(watchId)); if (watch) { watch.lastUrls = urls.slice(0, 500).map(rtsUrl); const safe = dictionary<string>(); for (const [url, fingerprint] of Object.entries(fingerprints).slice(0, 500)) try { safe[rtsUrl(url)] = text(fingerprint, 256, "Отпечаток"); } catch {} watch.fingerprints = safe; await save(); } }
export async function toggleWatch(userId: number, watchId: string) { const watch = user(userId).watches.find((item) => item.id === cleanId(watchId)); if (watch) { watch.enabled = !watch.enabled; await save(); } return watch; }
export async function addProfile(userId: number, rawName: string, rawFilter: TenderFilter) { const data = user(userId); if (data.profiles.length >= MAX_PROFILES) throw new Error(`Достигнут лимит ${MAX_PROFILES} профилей`); const profile = { id: randomUUID(), name: text(rawName, MAX_TEXT, "Название"), filter: cleanFilter(rawFilter), createdAt: new Date().toISOString() }; data.profiles.push(profile); await save(); return profile; }
export async function removeProfile(userId: number, profileId: string) { const data = user(userId); data.profiles = data.profiles.filter((profile) => profile.id !== cleanId(profileId)); await save(); }
export async function setPipeline(userId: number, rawUrl: string, rawTitle: string, stage: PipelineStage, note?: string, deadlineAt?: string, assignee?: string) { if (!stages.has(stage)) throw new Error("Неизвестный этап воронки"); const url = rtsUrl(rawUrl), data = user(userId); assertCapacity(data.pipeline, url); const existing = data.pipeline[url], history = existing?.history ?? []; if (!existing || existing.stage !== stage) history.push({ stage, at: new Date().toISOString() }); const item: PipelineItem = { url, title: text(rawTitle, MAX_TEXT, "Название"), stage, note: note === undefined ? existing?.note : note === "" ? "" : text(note, MAX_NOTE, "Заметка"), assignee: assignee === undefined ? existing?.assignee : optionalText(assignee, 200, "Ответственный"), deadlineAt: deadlineAt === undefined ? existing?.deadlineAt : safeDate(deadlineAt, "Срок"), updatedAt: new Date().toISOString(), history: history.slice(-20) }; data.pipeline[url] = item; await save(); return item; }
export async function removePipeline(userId: number, rawUrl: string) { delete user(userId).pipeline[rtsUrl(rawUrl)]; await save(); }
export async function recordTrackedChange(userId: number, rawUrl: string, rawTitle: string, changes: TrackedChange["changes"]) { const url = rtsUrl(rawUrl), data = user(userId); assertCapacity(data.trackedChanges, url); data.trackedChanges[url] = { url, title: text(rawTitle, MAX_TEXT, "Название"), detectedAt: new Date().toISOString(), changes: cleanChanges(changes) }; await save(); }
export async function dismissTrackedChange(userId: number, rawUrl: string) { delete user(userId).trackedChanges[rtsUrl(rawUrl)]; await save(); }
export function allUsers() { return Object.entries(db.users).map(([idValue, data]) => ({ id: Number(idValue), data })); }
