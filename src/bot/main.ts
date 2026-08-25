import { Bot, InlineKeyboard } from "grammy";
import { assertBotConfig, botConfig } from "./config.js";
import { addFavorite, addProfile, addWatch, loadStore, removeFavorite, removeProfile, removeWatch, setPipeline, setRole, toggleWatch, user, type PipelineStage } from "./store.js";
import { call, closeMcp } from "./mcp.js";
import { analyzeTender } from "./analysis.js";
import { clip, esc, requestList, tenderList } from "./format.js";
import { monitorOnce } from "./monitor.js";
import { describeFilter, parseFilter } from "./filters.js";

assertBotConfig(); await loadStore();
const bot = new Bot(botConfig.token);
const pending = new Map<number, "search" | "watch" | "card" | "analyze" | "filter">();
const favoriteTokens = new Map<string, string>();
const favoriteKey = (url: string) => Buffer.from(url).toString("base64url").slice(-24);

bot.use(async (ctx, next) => {
  const id = ctx.from?.id;
  if (!id || !botConfig.allowedUsers.has(id)) { if (ctx.message) await ctx.reply("Доступ запрещён. Ваш Telegram ID не внесён в TELEGRAM_ALLOWED_USERS."); return; }
  await next();
});
const menu = () => new InlineKeyboard().text("🔎 Поиск", "search").text("🎛 Фильтры", "filters").row().text("📄 Карточка", "card").text("🧠 Анализ", "analyze").row().text("⭐ Избранное", "favorites").text("🔔 Мониторинг", "watches").row().text("📋 Воронка", "pipeline").text("⏰ Дедлайны", "deadlines").row().text("🔐 Сессия РТС", "session").text("👤 Роль", "role").row().text("ℹ️ Помощь", "help");
const help = `Бот работает через локальный MCP-мост РТС.\n\n/search текст — простой поиск\n/filter имя | параметры — сохранить сложный фильтр\n/filters — профили фильтров\n/deadlines 14 — ближайшие сроки\n/card URL — карточка\n/analyze URL — анализ рисков\n/watch текст — простой мониторинг\n/watchfilter ID — мониторинг по профилю\n/favorites — избранное\n/queue — рабочая воронка\n/stage стадия URL — изменить стадию\n/session — состояние площадки\n/role — рабочая роль\n\nФормат фильтра: ключи=ноутбук, компьютер; исключить=ремонт; минцена=100000; максцена=3000000; заказчик=администрация; регион=Краснодар; окпд=26.20; дней=3-20; документы=да; сорт=срок`;

bot.command("start", ctx => ctx.reply("Помощник по закупкам Краснодарского края готов.", { reply_markup: menu() }));
bot.command("help", ctx => ctx.reply(help, { reply_markup: menu() }));
bot.command("session", async ctx => ctx.reply(clip(JSON.stringify(await call("rts_session_status"), null, 2))));
bot.command("role", ctx => ctx.reply("Выберите рабочую роль:", { reply_markup: new InlineKeyboard().text("Заказчик / оператор", "role:operator").text("Участник", "role:participant") }));
bot.command("search", async ctx => runSearch(ctx, ctx.match.trim()));
bot.command("card", async ctx => runCard(ctx, ctx.match.trim(), false));
bot.command("analyze", async ctx => runCard(ctx, ctx.match.trim(), true));
bot.command("watch", async ctx => { const q=ctx.match.trim(); if (!q) return void await ctx.reply("Укажите запрос: /watch канцелярские товары"); const w=await addWatch(ctx.from!.id,q); await ctx.reply(`Мониторинг «${q}» создан: ${w.id.slice(0,8)}`); });
bot.command("favorites", showFavorites);
bot.command("filter", async ctx => saveFilterCommand(ctx,ctx.match.trim()));
bot.command("filters", showFilters);
bot.command("watchfilter", async ctx=>{const p=user(ctx.from!.id).profiles.find(x=>x.id.startsWith(ctx.match.trim()));if(!p)return void await ctx.reply("Профиль не найден.");const w=await addWatch(ctx.from!.id,p.name,p.filter);await ctx.reply(`Мониторинг по фильтру «${p.name}» создан: ${w.id.slice(0,8)}`);});
bot.command("deadlines", async ctx=>showDeadlines(ctx,Number(ctx.match.trim()||14)));
bot.command("queue", showPipeline);
bot.command("stage", async ctx=>setStageCommand(ctx,ctx.match.trim()));
bot.command("digest", async ctx=>runDigest(ctx));

bot.callbackQuery("search", async ctx => { pending.set(ctx.from.id,"search"); await ctx.answerCallbackQuery(); await ctx.reply("Введите ключевые слова, номер или заказчика:"); });
bot.callbackQuery("card", async ctx => { pending.set(ctx.from.id,"card"); await ctx.answerCallbackQuery(); await ctx.reply("Пришлите URL карточки запроса:"); });
bot.callbackQuery("analyze", async ctx => { pending.set(ctx.from.id,"analyze"); await ctx.answerCallbackQuery(); await ctx.reply("Пришлите URL карточки для полного анализа:"); });
bot.callbackQuery("watches", async ctx => { await ctx.answerCallbackQuery(); const watches=user(ctx.from.id).watches; if(!watches.length)return void await ctx.reply("Мониторингов пока нет.",{reply_markup:new InlineKeyboard().text("➕ Добавить", "watch:add")}); for(const w of watches)await ctx.reply(`${w.enabled?"🟢":"⏸"} ${w.name}\n${describeFilter(w.filter)}\nУдалить: /unwatch_${w.id}`,{reply_markup:new InlineKeyboard().text(w.enabled?"Приостановить":"Включить",`watch:toggle:${w.id}`)}); });
bot.callbackQuery("watch:add", async ctx => { pending.set(ctx.from.id,"watch"); await ctx.answerCallbackQuery(); await ctx.reply("Введите поисковую фразу для мониторинга:"); });
bot.callbackQuery("favorites", async ctx => { await ctx.answerCallbackQuery(); await showFavorites(ctx); });
bot.callbackQuery("session", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply(clip(JSON.stringify(await call("rts_session_status"),null,2))); });
bot.callbackQuery("role", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply("Выберите роль:",{reply_markup:new InlineKeyboard().text("Оператор", "role:operator").text("Участник", "role:participant")}); });
bot.callbackQuery("help", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply(help); });
bot.callbackQuery("filters", async ctx=>{await ctx.answerCallbackQuery();await showFilters(ctx);});
bot.callbackQuery("pipeline", async ctx=>{await ctx.answerCallbackQuery();await showPipeline(ctx);});
bot.callbackQuery("deadlines", async ctx=>{await ctx.answerCallbackQuery();await showDeadlines(ctx,14);});
bot.callbackQuery(/^profile:run:(.+)$/,async ctx=>{await ctx.answerCallbackQuery();const p=user(ctx.from.id).profiles.find(x=>x.id===ctx.match[1]);if(p)await runAdvanced(ctx,p.filter,p.name);});
bot.callbackQuery(/^profile:del:(.+)$/,async ctx=>{await removeProfile(ctx.from.id,ctx.match[1]);await ctx.answerCallbackQuery({text:"Профиль удалён"});await ctx.editMessageText("Профиль удалён.");});
bot.callbackQuery(/^watch:toggle:(.+)$/,async ctx=>{const w=await toggleWatch(ctx.from.id,ctx.match[1]);await ctx.answerCallbackQuery({text:w?.enabled?"Включён":"Приостановлен"});});
bot.callbackQuery(/^role:(operator|participant)$/, async ctx => { const role=ctx.match[1] as "operator"|"participant"; await setRole(ctx.from.id,role); await ctx.answerCallbackQuery({text:"Роль сохранена"}); await ctx.editMessageText(`Текущая роль: ${role === "operator" ? "заказчик / оператор" : "участник"}`); });
bot.callbackQuery(/^fav:add:(.+)$/, async ctx => { const url=favoriteTokens.get(ctx.match[1]); if(!url) return void await ctx.answerCallbackQuery({text:"Кнопка устарела — откройте карточку снова"}); await addFavorite(ctx.from.id,url,url); await ctx.answerCallbackQuery({text:"Добавлено"}); });
bot.callbackQuery(/^fav:del:(.+)$/, async ctx => { const url=Object.keys(user(ctx.from.id).favorites).find(x=>favoriteKey(x)===ctx.match[1]); if(!url) return void await ctx.answerCallbackQuery({text:"Уже удалено"}); await removeFavorite(ctx.from.id,url); await ctx.answerCallbackQuery({text:"Удалено"}); await ctx.editMessageText("Удалено из избранного."); });

bot.on("message:text", async ctx => {
  if (ctx.message.text.startsWith("/unwatch_")) { await removeWatch(ctx.from.id,ctx.message.text.slice(9)); return void await ctx.reply("Мониторинг удалён."); }
  const mode=pending.get(ctx.from.id); if (!mode) return; pending.delete(ctx.from.id);
  if (mode==="search") await runSearch(ctx,ctx.message.text);
  else if(mode==="filter") await saveFilterCommand(ctx,ctx.message.text);
  else if (mode==="watch") { await addWatch(ctx.from.id,ctx.message.text); await ctx.reply("Мониторинг создан."); }
  else await runCard(ctx,ctx.message.text,mode==="analyze");
});
bot.catch(e => console.error("bot", e.error));

async function runSearch(ctx:any, query:string) {
  if (!query) { pending.set(ctx.from.id,"search"); return ctx.reply("Введите поисковую фразу:"); }
  const wait=await ctx.reply("Ищу на площадке…");
  try { const data=await call<{requests:Array<{title:string;url:string;summary?:string}>}>("rts_list_requests",{query,limit:30}); await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(requestList(data.requests)),{parse_mode:"HTML",link_preview_options:{is_disabled:true}}); }
  catch(e){ await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`); }
}
async function runCard(ctx:any, url:string, analyze:boolean) {
  if (!url) { pending.set(ctx.from.id,analyze?"analyze":"card"); return ctx.reply("Пришлите URL карточки:"); }
  const wait=await ctx.reply(analyze?"Изучаю карточку и риски…":"Загружаю карточку…");
  try { const data=await call<any>("rts_get_request",{url}); const body=analyze?await analyzeTender(data,user(ctx.from.id).role):`${data.title}\n\n${data.text}\n\nДокументов: ${data.documents?.length??0}`; const key=crypto.randomUUID().slice(0,12); favoriteTokens.set(key,data.url); await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(esc(body)),{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("⭐ В избранное",`fav:add:${key}`).url("Открыть на РТС",data.url),link_preview_options:{is_disabled:true}}); }
  catch(e){ await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`); }
}
async function showFavorites(ctx:any) { const rows=Object.values(user(ctx.from.id).favorites); if(!rows.length)return ctx.reply("Избранное пусто."); for(const row of rows.slice(0,30)){const key=favoriteKey(row.url); await ctx.reply(`<a href="${esc(row.url)}">${esc(row.title)}</a>`,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("Удалить",`fav:del:${key}`)});} }

async function saveFilterCommand(ctx:any,input:string){
  if(!input){pending.set(ctx.from.id,"filter");return ctx.reply("Введите: название | ключи=...; исключить=...; минцена=...; максцена=...; регион=...; дней=3-20; документы=да");}
  const [nameRaw,specRaw]=input.split("|");const name=(specRaw?nameRaw:"Мой фильтр").trim();const spec=(specRaw??nameRaw).trim();
  try{const filter=parseFilter(spec);const p=await addProfile(ctx.from.id,name,filter);await ctx.reply(`Профиль «${p.name}» сохранён.\n${describeFilter(p.filter)}\n\nЗапуск: /filters\nМониторинг: /watchfilter ${p.id.slice(0,8)}`);}catch(e){await ctx.reply(`Ошибка фильтра: ${String(e)}`);}
}
async function showFilters(ctx:any){const rows=user(ctx.from.id).profiles;if(!rows.length)return ctx.reply("Профилей нет. Создайте: /filter Офисная техника | ключи=ноутбук, компьютер; максцена=3000000; дней=3-30");for(const p of rows.slice(0,30))await ctx.reply(`<b>${esc(p.name)}</b>\n${esc(describeFilter(p.filter))}\nID: <code>${p.id.slice(0,8)}</code>`,{parse_mode:"HTML",reply_markup:new InlineKeyboard().text("▶️ Запустить",`profile:run:${p.id}`).text("🗑 Удалить",`profile:del:${p.id}`)});}
async function runAdvanced(ctx:any,filter:any,name="Фильтр"){const wait=await ctx.reply(`Применяю «${name}»…`);try{const data=await call<any>("rts_search_advanced",{...filter,scanLimit:500,resultLimit:50});await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(`<b>${esc(name)}</b>\nПросмотрено: ${data.scanned}, найдено: ${data.count}\n\n${tenderList(data.tenders)}`),{parse_mode:"HTML",link_preview_options:{is_disabled:true}});}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function showDeadlines(ctx:any,days:number){if(!Number.isFinite(days)||days<0||days>365)days=14;const wait=await ctx.reply(`Собираю сроки на ${days} дней…`);try{const data=await call<any>("rts_deadlines",{days,limit:50});await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(`<b>Дедлайны на ${days} дней</b>\n\n${tenderList(data.tenders)}`),{parse_mode:"HTML",link_preview_options:{is_disabled:true}});}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function setStageCommand(ctx:any,input:string){const stages:PipelineStage[]=["new","review","decision","prepare","submitted","won","lost","archived"];const [stage,url,...note]=input.split(/\s+/);if(!stages.includes(stage as PipelineStage)||!url)return ctx.reply(`Формат: /stage review URL комментарий\nСтадии: ${stages.join(", ")}`);await setPipeline(ctx.from.id,url,url,stage as PipelineStage,note.join(" "));await ctx.reply(`Стадия установлена: ${stage}`);}
async function showPipeline(ctx:any){const rows=Object.values(user(ctx.from.id).pipeline).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));if(!rows.length)return ctx.reply("Воронка пуста. Добавьте: /stage review URL первичная проверка");const groups=rows.reduce<Record<string,typeof rows>>((a,x)=>{(a[x.stage]??=[]).push(x);return a;},{});await ctx.reply(clip(Object.entries(groups).map(([stage,items])=>`<b>${stage}</b>\n${items.map(x=>`• <a href="${esc(x.url)}">${esc(x.title)}</a>${x.note?` — ${esc(x.note)}`:""}`).join("\n")}`).join("\n\n")),{parse_mode:"HTML",link_preview_options:{is_disabled:true}});}
async function runDigest(ctx:any){const profiles=user(ctx.from.id).profiles;if(!profiles.length)return ctx.reply("Сначала создайте хотя бы один профиль /filter");for(const p of profiles.slice(0,10))await runAdvanced(ctx,p.filter,p.name);}

await bot.api.setMyCommands([{command:"search",description:"Поиск закупок"},{command:"filter",description:"Создать сложный фильтр"},{command:"filters",description:"Профили фильтров"},{command:"deadlines",description:"Ближайшие сроки"},{command:"digest",description:"Дайджест по профилям"},{command:"card",description:"Карточка закупки"},{command:"analyze",description:"AI-анализ рисков"},{command:"watch",description:"Мониторинг новых закупок"},{command:"queue",description:"Рабочая воронка"},{command:"favorites",description:"Избранное"},{command:"session",description:"Состояние РТС"},{command:"role",description:"Рабочая роль"},{command:"help",description:"Помощь"}]);
setInterval(() => void monitorOnce(bot), botConfig.monitorIntervalMs).unref();
process.once("SIGINT",async()=>{await closeMcp();bot.stop();}); process.once("SIGTERM",async()=>{await closeMcp();bot.stop();});
console.log("KRD Market Telegram bot started"); await bot.start();
