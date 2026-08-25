import { Bot, InlineKeyboard } from "grammy";
import { assertBotConfig, botConfig } from "../../config/bot.js";
import { addFavorite, addProfile, addWatch, loadStore, removeFavorite, removeProfile, removeWatch, setPipeline, setRole, toggleWatch, user, type PipelineStage } from "../../infrastructure/persistence/bot-store.js";
import { call, closeMcp } from "../../application/mcp-client.js";
import { analyzeTender } from "../../infrastructure/ai/tender-analysis.js";
import { clip, esc, requestList, tenderList } from "./format.js";
import { monitorOnce } from "./monitor.js";
import { describeFilter, parseFilter } from "./filters.js";
import { botCommands, helpText, mainMenu } from "./ui.js";

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

bot.command("start", ctx => ctx.reply("Помощник по закупкам Краснодарского края готов.", { reply_markup: mainMenu() }));
bot.command("help", ctx => ctx.reply(helpText, { reply_markup: mainMenu() }));
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
bot.command("workspace", async ctx=>showWorkspace(ctx));
bot.command("sitefilter", async ctx=>runSiteFilter(ctx,ctx.match.trim()));
bot.command("documents", async ctx=>downloadDocuments(ctx,ctx.match.trim()));
bot.command("tables", async ctx=>extractTables(ctx,ctx.match.trim()));
bot.command("dossier",async ctx=>buildDossierCommand(ctx,ctx.match.trim()));
bot.command("track",async ctx=>trackRequestCommand(ctx,ctx.match.trim()));
bot.command("compare",async ctx=>compareRequestsCommand(ctx,ctx.match.trim()));
bot.command("draft",async ctx=>draftOfferCommand(ctx,ctx.match.trim()));
bot.command("readiness",async ctx=>readinessCommand(ctx,ctx.match.trim()));
bot.command("economics",async ctx=>economicsCommand(ctx,ctx.match.trim()));
bot.command("workplan",async ctx=>workplanCommand(ctx,ctx.match.trim()));

bot.callbackQuery("search", async ctx => { pending.set(ctx.from.id,"search"); await ctx.answerCallbackQuery(); await ctx.reply("Введите ключевые слова, номер или заказчика:"); });
bot.callbackQuery("card", async ctx => { pending.set(ctx.from.id,"card"); await ctx.answerCallbackQuery(); await ctx.reply("Пришлите URL карточки запроса:"); });
bot.callbackQuery("analyze", async ctx => { pending.set(ctx.from.id,"analyze"); await ctx.answerCallbackQuery(); await ctx.reply("Пришлите URL карточки для полного анализа:"); });
bot.callbackQuery("watches", async ctx => { await ctx.answerCallbackQuery(); const watches=user(ctx.from.id).watches; if(!watches.length)return void await ctx.reply("Мониторингов пока нет.",{reply_markup:new InlineKeyboard().text("➕ Добавить", "watch:add")}); for(const w of watches)await ctx.reply(`${w.enabled?"🟢":"⏸"} ${w.name}\n${describeFilter(w.filter)}\nУдалить: /unwatch_${w.id}`,{reply_markup:new InlineKeyboard().text(w.enabled?"Приостановить":"Включить",`watch:toggle:${w.id}`)}); });
bot.callbackQuery("watch:add", async ctx => { pending.set(ctx.from.id,"watch"); await ctx.answerCallbackQuery(); await ctx.reply("Введите поисковую фразу для мониторинга:"); });
bot.callbackQuery("favorites", async ctx => { await ctx.answerCallbackQuery(); await showFavorites(ctx); });
bot.callbackQuery("session", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply(clip(JSON.stringify(await call("rts_session_status"),null,2))); });
bot.callbackQuery("role", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply("Выберите роль:",{reply_markup:new InlineKeyboard().text("Оператор", "role:operator").text("Участник", "role:participant")}); });
bot.callbackQuery("help", async ctx => { await ctx.answerCallbackQuery(); await ctx.reply(helpText); });
bot.callbackQuery("filters", async ctx=>{await ctx.answerCallbackQuery();await showFilters(ctx);});
bot.callbackQuery("pipeline", async ctx=>{await ctx.answerCallbackQuery();await showPipeline(ctx);});
bot.callbackQuery("deadlines", async ctx=>{await ctx.answerCallbackQuery();await showDeadlines(ctx,14);});
bot.callbackQuery("workspace",async ctx=>{await ctx.answerCallbackQuery();await showWorkspace(ctx);});
bot.callbackQuery("sitefilters",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Введите /sitefilter запрос=ноутбук; заказчик=...; минцена=100000; максцена=3000000; статус=...; окпд=26.20; регион=Краснодар");});
bot.callbackQuery("dossier",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Пришлите /dossier URL карточки закупки");});
bot.callbackQuery("drafthelp",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Предварительный просмотр: /draft URL | цена=125000; количество=10; поставка=7; срок=30; комментарий=текст\n\nБот не отправляет и не подписывает предложение.");});
bot.callbackQuery("readiness",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("Пришлите /readiness URL карточки закупки");});
bot.callbackQuery("economicshelp",async ctx=>{await ctx.answerCallbackQuery();await ctx.reply("/economics цена=1000000; себестоимость=650000; логистика=50000; накладные=30000; гарантия=10000; финансирование=20000; налог=6; резерв=5; прибыль=12");});
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
async function showWorkspace(ctx:any){const wait=await ctx.reply("Инвентаризирую текущий кабинет РТС…");try{const data=await call<any>("rts_workspace");const rows=(data.workspace??[]).map((x:any)=>`• ${x.kind}: ${Math.round(x.confidence*100)}% — ${x.evidence.join(", ")}`).join("\n");await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(`Кабинет: ${data.title}\n${data.url}\n\n${rows||"Закрытые разделы не распознаны. Проверьте ручной вход в браузере."}`));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function runSiteFilter(ctx:any,input:string){if(!input)return ctx.reply("Формат: /sitefilter запрос=ноутбук; заказчик=...; минцена=100000; максцена=3000000; статус=...; окпд=26.20; регион=Краснодар");try{const f=parseFilter(input);const data=await call<any>("rts_apply_site_filters",{query:f.query??f.includeKeywords?.[0],customer:f.customer,minPrice:f.minPrice,maxPrice:f.maxPrice,status:f.status,okpd2:f.okpd2?.[0],location:f.location,submitSearch:true});await ctx.reply(clip(`Фильтры площадки применены: ${data.applied?.map((x:any)=>x.field).join(", ")||"нет"}\nНе найдены на форме: ${data.missing?.join(", ")||"нет"}\nРезультатов: ${data.requests?.length??0}`));}catch(e){await ctx.reply(`Ошибка: ${String(e)}`);}}
async function downloadDocuments(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /documents https://...");const wait=await ctx.reply("Скачиваю документы через авторизованную сессию…");try{const data=await call<any>("rts_download_all_documents",{url,maxFiles:30});await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(`Скачано: ${data.documents?.filter((x:any)=>x.path).length??0}/${data.count}\n${(data.documents??[]).map((x:any)=>`• ${x.name}: ${x.path??x.error}`).join("\n")}`));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function extractTables(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /tables https://...");try{const data=await call<any>("rts_extract_tables",{url});await ctx.reply(clip(JSON.stringify(data.tables,null,2)));}catch(e){await ctx.reply(`Ошибка: ${String(e)}`);}}
async function buildDossierCommand(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /dossier https://...");const wait=await ctx.reply("Собираю полное досье закупки…");try{const d=await call<any>("rts_build_dossier",{url});const t=d.tender;const result=`<b>${esc(d.title)}</b>\n\nНомер: ${esc(t.number??"не распознан")}\nЦена: ${t.price!==undefined?t.price.toLocaleString("ru-RU")+" ₽":"не распознана"}\nЗаказчик: ${esc(t.customer??"не распознан")}\nСрок: ${esc(t.deadlineAt??"не распознан")}\nОсталось дней: ${t.daysLeft??"—"}\nОКПД2: ${esc(t.okpd2?.join(", ")||"—")}\nДокументов: ${d.documents.length}\nТаблиц: ${d.tables.length}\nПолнота: ${d.analysis?.completeness??"—"}%\nОтпечаток: <code>${d.fingerprint.slice(0,16)}</code>\n\n${t.warnings?.length?"⚠️ "+esc(t.warnings.join("; ")):"Критические предупреждения не обнаружены."}`;await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(result),{parse_mode:"HTML",reply_markup:new InlineKeyboard().url("Открыть на РТС",d.url)});}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function trackRequestCommand(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /track https://...");const wait=await ctx.reply("Сравниваю карточку с предыдущим снимком…");try{const data=await call<any>("rts_track_request",{url});const comparison=data.tracking.comparison;const body=data.tracking.firstCapture?"Создан первый контрольный снимок.":comparison.changed?`Обнаружены изменения:\n${comparison.changes.map((x:any)=>`• ${x.severity}: ${x.field}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join("\n")}`:"Изменений после предыдущего снимка нет.";await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(body));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function compareRequestsCommand(ctx:any,input:string){const urls=input.match(/https?:\/\/\S+/g)??[];if(urls.length<2)return ctx.reply("Формат: /compare URL1 URL2");const wait=await ctx.reply("Сравниваю закупки…");try{const data=await call<any>("rts_compare_requests",{firstUrl:urls[0],secondUrl:urls[1]});const a=data.first.tender,b=data.second.tender;const body=`1. ${data.first.title}\n2. ${data.second.title}\n\nЦена: ${a.price??"—"} / ${b.price??"—"}\nСрок: ${a.deadlineAt??"—"} / ${b.deadlineAt??"—"}\nЗаказчик: ${a.customer??"—"} / ${b.customer??"—"}\nДокументы: ${data.first.documents.length} / ${data.second.documents.length}\n\nРазличия:\n${data.comparison.changes.map((x:any)=>`• ${x.field}: ${JSON.stringify(x.before)} → ${JSON.stringify(x.after)}`).join("\n")||"Существенных различий не распознано."}`;await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(body));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
async function draftOfferCommand(ctx:any,input:string){const [urlRaw,specRaw]=input.split("|");const url=urlRaw?.trim();if(!url||!specRaw)return ctx.reply("Формат: /draft URL | цена=125000; количество=10; поставка=7; срок=30; комментарий=текст");const fields=Object.fromEntries(specRaw.split(";").map(x=>x.split("=").map(y=>y.trim())).filter(x=>x.length===2));const price=Number((fields["цена"]??"").replace(/[\s,]/g,(x:string)=>x===","?".":""));if(!Number.isFinite(price)||price<=0)return ctx.reply("Укажите корректную положительную цену.");try{const data=await call<any>("rts_prepare_offer_draft",{url,price,quantity:fields["количество"]?Number(fields["количество"]):undefined,deliveryDays:fields["поставка"]?Number(fields["поставка"]):undefined,validityDays:fields["срок"]?Number(fields["срок"]):undefined,comment:fields["комментарий"],execute:false,confirm:false});await ctx.reply(clip(`Предпросмотр черновика\n\nПоля формы:\n${data.plan.map((x:any)=>`• ${x.field} → ${x.controlId}: ${x.value}`).join("\n")||"Подходящие поля не найдены"}\nНе найдены: ${data.missing?.join(", ")||"нет"}\nОшибки: ${data.errors?.join("; ")||"нет"}\n\nНичего не отправлено и не подписано.`));}catch(e){await ctx.reply(`Ошибка: ${String(e)}`);}}
async function readinessCommand(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /readiness https://...");const wait=await ctx.reply("Проверяю готовность к участию…");try{const data=await call<any>("rts_assess_readiness",{url});const r=data.readiness;const body=`Готовность: ${r.score}/100\nРешение: ${r.decision}\n\n${r.items.map((x:any)=>`${x.status==="ready"?"✅":x.status==="blocked"?"⛔":"⚠️"} ${x.title}: ${x.evidence??"нужно проверить"}\n   ${x.action}`).join("\n\n")}`;await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(body));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}
const numeric=(value:string|undefined)=>value===undefined?undefined:Number(value.replace(/\s/g,"").replace(",","."));
async function economicsCommand(ctx:any,input:string){const fields=Object.fromEntries(input.split(";").map(x=>x.split("=").map(y=>y.trim())).filter(x=>x.length===2));if(!fields["цена"]||!fields["себестоимость"])return ctx.reply("Формат: /economics цена=1000000; себестоимость=650000; логистика=50000; накладные=30000; гарантия=10000; финансирование=20000; налог=6; резерв=5; прибыль=12");try{const data=await call<any>("rts_bid_economics",{startingPrice:numeric(fields["цена"]),directCosts:numeric(fields["себестоимость"]),logistics:numeric(fields["логистика"]),overheads:numeric(fields["накладные"]),guaranteeCost:numeric(fields["гарантия"]),financingCost:numeric(fields["финансирование"]),otherCosts:numeric(fields["прочее"]),taxPercent:numeric(fields["налог"]),contingencyPercent:numeric(fields["резерв"]),targetProfitPercent:numeric(fields["прибыль"])});await ctx.reply(clip(`Экономика участия\n\nЗатраты: ${data.costBase.toLocaleString("ru-RU")} ₽\nБезубыточность: ${data.breakEvenPrice.toLocaleString("ru-RU",{maximumFractionDigits:2})} ₽\nЦелевая цена: ${data.targetBidPrice.toLocaleString("ru-RU",{maximumFractionDigits:2})} ₽\nПрибыль на НМЦК: ${data.profitAtStart.toLocaleString("ru-RU",{maximumFractionDigits:2})} ₽\nМаржа: ${data.marginAtStart.toFixed(2)}%\nМаксимальное снижение: ${data.maxDiscountPercent.toFixed(2)}%\nДопустимо: ${data.viable?"ДА":"НЕТ"}\n${data.warnings.join("; ")}`));}catch(e){await ctx.reply(`Ошибка: ${String(e)}`);}}
async function workplanCommand(ctx:any,url:string){if(!url)return ctx.reply("Укажите URL: /workplan https://...");const wait=await ctx.reply("Формирую план подготовки…");try{const data=await call<any>("rts_build_workplan",{url});const w=data.workplan;await ctx.api.editMessageText(ctx.chat.id,wait.message_id,clip(`Дедлайн: ${w.deadlineAt??"не распознан"}\n\n${w.tasks.map((x:any)=>`${x.status==="overdue"?"🔴":"⬜"} ${x.title}\n${x.owner} · ${x.dueAt??"срок назначить вручную"}`).join("\n\n")}\n\n${w.warnings.join("; ")}`));}catch(e){await ctx.api.editMessageText(ctx.chat.id,wait.message_id,`Ошибка: ${String(e)}`);}}

await bot.api.setMyCommands(botCommands);
setInterval(() => void monitorOnce(bot), botConfig.monitorIntervalMs).unref();
process.once("SIGINT",async()=>{await closeMcp();bot.stop();}); process.once("SIGTERM",async()=>{await closeMcp();bot.stop();});
console.log("KRD Market Telegram bot started"); await bot.start();
