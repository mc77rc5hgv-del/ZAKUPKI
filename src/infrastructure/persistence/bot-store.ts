import fs from "node:fs/promises";
import path from "node:path";
import { botConfig } from "../../config/bot.js";
import type { TenderFilter } from "../../domain/procurement.js";
import { readStoreFile, writeStoreFile } from "../security/encrypted-store.js";

export type Watch = { id: string; name: string; filter: TenderFilter; enabled: boolean; createdAt: string; lastUrls: string[]; fingerprints: Record<string, string> };
export type FilterProfile = { id: string; name: string; filter: TenderFilter; createdAt: string };
export type PipelineStage = "new" | "review" | "decision" | "prepare" | "submitted" | "won" | "lost" | "archived";
export type PipelineHistoryEntry = { stage: PipelineStage; at: string };
export type PipelineItem = { url: string; title: string; stage: PipelineStage; note?: string; assignee?: string; deadlineAt?: string; updatedAt: string; history: PipelineHistoryEntry[] };
export type UserData = { role: "operator" | "participant"; favorites: Record<string, { title: string; url: string; addedAt: string }>; watches: Watch[]; profiles: FilterProfile[]; pipeline: Record<string, PipelineItem> };
type Database = { users: Record<string, UserData> };
let db: Database = { users: {} };
let loaded = false;

const file = () => path.join(botConfig.dataDir, "bot.json");
export async function loadStore() {
  if (loaded) return;
  await fs.mkdir(botConfig.dataDir, { recursive: true });
  db = await readStoreFile<Database>(file(), { users: {} });
  for (const value of Object.values(db.users)) {
    value.profiles ??= []; value.pipeline ??= {};
    value.watches = (value.watches ?? []).map((w: any) => w.filter ? { enabled: true, fingerprints: {}, ...w } : ({ id: w.id, name: w.query, filter: { query: w.query, status: w.status }, enabled: true, createdAt: w.createdAt, lastUrls: w.lastUrls ?? [], fingerprints: {} }));
    for (const item of Object.values(value.pipeline)) (item as any).history ??= [{ stage: item.stage, at: item.updatedAt }];
  }
  loaded = true;
}
async function save() { await writeStoreFile(file(), db); }
export function user(id: number): UserData {
  return db.users[id] ??= { role: "participant", favorites: {}, watches: [], profiles: [], pipeline: {} };
}
export async function setRole(id: number, role: UserData["role"]) { user(id).role = role; await save(); }
export async function addFavorite(id: number, url: string, title: string) { user(id).favorites[url] = { url, title, addedAt: new Date().toISOString() }; await save(); }
export async function removeFavorite(id: number, url: string) { delete user(id).favorites[url]; await save(); }
export async function addWatch(id: number, name: string, filter: TenderFilter = { query: name }) {
  const watch: Watch = { id: crypto.randomUUID(), name, filter, enabled: true, createdAt: new Date().toISOString(), lastUrls: [], fingerprints: {} };
  user(id).watches.push(watch); await save(); return watch;
}
export async function removeWatch(id: number, watchId: string) { user(id).watches = user(id).watches.filter(w => w.id !== watchId); await save(); }
export async function updateWatch(id: number, watchId: string, urls: string[], fingerprints: Record<string,string> = {}) { const w = user(id).watches.find(x => x.id === watchId); if (w) { w.lastUrls = urls.slice(0, 500); w.fingerprints = fingerprints; await save(); } }
export async function toggleWatch(id: number, watchId: string) { const w=user(id).watches.find(x=>x.id===watchId); if(w){w.enabled=!w.enabled; await save();} return w; }
export async function addProfile(id: number, name: string, filter: TenderFilter) { const profile={id:crypto.randomUUID(),name,filter,createdAt:new Date().toISOString()}; user(id).profiles.push(profile); await save(); return profile; }
export async function removeProfile(id: number, profileId: string) { user(id).profiles=user(id).profiles.filter(x=>x.id!==profileId); await save(); }
export async function setPipeline(id:number,url:string,title:string,stage:PipelineStage,note?:string,deadlineAt?:string,assignee?:string){
  const existing=user(id).pipeline[url];
  const history=existing?.history??[];
  if(!existing||existing.stage!==stage)history.push({stage,at:new Date().toISOString()});
  const item:PipelineItem={url,title,stage,note:note??existing?.note,assignee:assignee??existing?.assignee,deadlineAt:deadlineAt??existing?.deadlineAt,updatedAt:new Date().toISOString(),history:history.slice(-20)};
  user(id).pipeline[url]=item;await save();return item;
}
export async function removePipeline(id:number,url:string){delete user(id).pipeline[url];await save();}
export function allUsers() { return Object.entries(db.users).map(([id, data]) => ({ id: Number(id), data })); }
