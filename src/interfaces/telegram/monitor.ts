import type { Bot } from "grammy";
import { call } from "../../application/mcp-client.js";
import { allUsers, updateWatch } from "../../infrastructure/persistence/bot-store.js";
import { clip, esc } from "./format.js";
import { createHash } from "node:crypto";

let running = false;
export async function monitorOnce(bot: Bot) {
  if (running) return; running = true;
  try {
    for (const { id, data } of allUsers()) for (const watch of data.watches.filter(x=>x.enabled)) {
      try {
        const result = await call<{ tenders: Array<{ title: string; url: string; summary?: string; price?:number; deadlineAt?:string; score?:number }> }>("rts_search_advanced", { ...watch.filter, scanLimit: 500, resultLimit: 100 });
        const known = new Set(watch.lastUrls); const fresh = result.tenders.filter(x => !known.has(x.url));
        const fingerprints=Object.fromEntries(result.tenders.map(x=>[x.url,createHash("sha256").update(JSON.stringify(x)).digest("hex")]));
        const changed=result.tenders.filter(x=>known.has(x.url)&&watch.fingerprints[x.url]&&watch.fingerprints[x.url]!==fingerprints[x.url]);
        if (watch.lastUrls.length && fresh.length) await bot.api.sendMessage(id, clip(`🔔 Новые закупки: «${esc(watch.name)}»\n\n${fresh.slice(0, 10).map(x => `• <a href="${esc(x.url)}">${esc(x.title)}</a>${x.price?` — ${x.price.toLocaleString("ru-RU")} ₽`:""}`).join("\n")}`), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
        if(changed.length) await bot.api.sendMessage(id,clip(`📝 Изменения в закупках: «${esc(watch.name)}»\n\n${changed.slice(0,10).map(x=>`• <a href="${esc(x.url)}">${esc(x.title)}</a>`).join("\n")}`),{parse_mode:"HTML",link_preview_options:{is_disabled:true}});
        await updateWatch(id, watch.id, result.tenders.map(x => x.url),fingerprints);
      } catch (e) { console.error("monitor", id, watch.id, e); }
    }
  } finally { running = false; }
}
