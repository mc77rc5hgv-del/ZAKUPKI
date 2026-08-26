#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, forgetProfile, getPage, open, PROFILE_DELETE_CONFIRMATION, safeDownloadPath, status } from "../../infrastructure/rts/browser.js";
import { config, portalUrl } from "../../infrastructure/rts/config.js";
import { extractRequestPages, extractRequests, visibleSnapshot } from "../../infrastructure/rts/extract.js";
import { analyzeDeterministic, filterTenders, normalizeTender } from "../../domain/procurement.js";
import { applySemanticFilters, inspectPortal } from "../../infrastructure/rts/inventory.js";
import { buildDossier, trackDossier } from "../../infrastructure/rts/dossier.js";
import { compareDossiers } from "../../domain/dossier.js";
import { prepareOfferDraft } from "../../infrastructure/rts/offer-draft.js";
import { assessReadiness, buildWorkplan, calculateBidEconomics } from "../../domain/participation.js";
import { withPageQueue } from "../../infrastructure/rts/operation-queue.js";

const server = new McpServer({ name: "krd-market-rts", version: "0.1.0" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (error: unknown) => ({ isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] });
// All tools share one Playwright page — serialize every tool call through the
// shared queue so two concurrent invocations never touch it at once.
const queuedTool = (name: string, description: string, shape: any, handler: (args: any) => Promise<any>) =>
  server.tool(name, description, shape, ((args: any) => withPageQueue(() => handler(args))) as any);

queuedTool("rts_session_status", "Open the persistent RTS browser session and report login/Anti-DDoS state. Login and CAPTCHA must be completed manually in the opened browser.", {}, async () => {
  try { await open(); return text(await status()); } catch (e) { return fail(e); }
});

queuedTool("rts_open", "Navigate inside krd-market.rts-tender.ru and return a safe visible-page snapshot.", {
  path: z.string().default("/zapros/").describe("Portal-relative path or same-origin URL"),
}, async ({ path }) => {
  try { const p = await open(path); return text({ url: p.url(), title: await p.title(), ...(await visibleSnapshot(p)) }); } catch (e) { return fail(e); }
});

queuedTool("rts_inspect_portal", "Inventory the current authenticated RTS page: semantic capabilities, controls, forms and tables. Use this after login to discover account-specific functions.", {
  path: z.string().default("/zapros/"), includeText: z.boolean().default(false),
}, async ({path,includeText})=>{try{const p=await open(path);const result=await inspectPortal(p);if(!includeText)result.text="";return text(result);}catch(e){return fail(e);}});

queuedTool("rts_apply_site_filters", "Fill recognized filters in the native RTS search form without submitting a bid or other legally significant action.", {
  query:z.string().optional(),number:z.string().optional(),customer:z.string().optional(),minPrice:z.number().optional(),maxPrice:z.number().optional(),status:z.string().optional(),dateFrom:z.string().optional(),dateTo:z.string().optional(),okpd2:z.string().optional(),location:z.string().optional(),submitSearch:z.boolean().default(true),
},async ({submitSearch,...values})=>{try{const p=await open("/zapros/");const result=await applySemanticFilters(p,values);if(submitSearch){const button=p.getByRole("button",{name:/найти|поиск|применить|показать/i}).first();if(await button.count()&&await button.isEnabled()){await button.click();await p.waitForLoadState("domcontentloaded").catch(()=>{});}}return text({...result,url:p.url(),requests:await extractRequests(p,100)});}catch(e){return fail(e);}});

queuedTool("rts_workspace", "Discover authenticated workspace sections such as applications, offers, contracts, clarifications, protocols and organization profile.", {},async()=>{try{const p=await getPage();const inventory=await inspectPortal(p);const workspace=inventory.capabilities.filter(x=>["applications","offer","contracts","clarifications","protocols","organization","auth"].includes(x.kind));return text({url:p.url(),title:inventory.title,workspace,links:inventory.controls.filter(x=>x.kind==="link"&&workspace.some(w=>w.controls.includes(x.id)))});}catch(e){return fail(e);}});

queuedTool("rts_list_requests", "List procurement/request links from the public request page. Filters are applied through visible search controls when recognizable.", {
  query: z.string().optional(), status: z.string().optional(), limit: z.number().int().min(1).max(100).default(30),
}, async ({ query, status: wantedStatus, limit }) => {
  try {
    const p = await open("/zapros/");
    if (query) {
      const input = p.locator('input[type="search"],input[placeholder*="Поиск" i],input[name*="search" i]').first();
      if (await input.count()) { await input.fill(query); await input.press("Enter"); await p.waitForLoadState("domcontentloaded").catch(() => {}); }
    }
    let rows = await extractRequests(p, limit);
    if (wantedStatus) rows = rows.filter(x => x.summary.toLowerCase().includes(wantedStatus.toLowerCase()));
    return text({ url: p.url(), count: rows.length, requests: rows, note: rows.length ? undefined : "No request links recognized; call rts_open to inspect current controls or complete Anti-DDoS/login manually." });
  } catch (e) { return fail(e); }
});

const filterShape = {
  query: z.string().optional(), includeKeywords: z.array(z.string()).optional(), excludeKeywords: z.array(z.string()).optional(),
  minPrice: z.number().nonnegative().optional(), maxPrice: z.number().nonnegative().optional(), customer: z.string().optional(),
  location: z.string().optional(), status: z.string().optional(), okpd2: z.array(z.string()).optional(),
  deadlineFrom: z.string().optional(), deadlineTo: z.string().optional(), minDaysLeft: z.number().int().optional(), maxDaysLeft: z.number().int().optional(),
  requireDocuments: z.boolean().optional(), sort: z.enum(["relevance", "price_asc", "price_desc", "deadline_asc", "published_desc"]).optional(),
};

queuedTool("rts_search_advanced", "Search requests and apply normalized tender filters: keywords, exclusions, price, customer, location, status, OKPD2, deadlines and document availability.", {
  ...filterShape, scanLimit: z.number().int().min(1).max(500).default(200), resultLimit: z.number().int().min(1).max(100).default(30),
}, async ({ scanLimit, resultLimit, ...filter }) => {
  try {
    const p = await open("/zapros/");
    if (filter.query) {
      const input = p.locator('input[type="search"],input[placeholder*="Поиск" i],input[name*="search" i]').first();
      if (await input.count()) { await input.fill(filter.query); await input.press("Enter"); await p.waitForLoadState("domcontentloaded").catch(() => {}); }
    }
    const raw = await extractRequestPages(p, scanLimit);
    const tenders = filterTenders(raw.map(x => normalizeTender(x)), filter).slice(0, resultLimit);
    return text({ url: p.url(), scanned: raw.length, count: tenders.length, filter, tenders });
  } catch (e) { return fail(e); }
});

queuedTool("rts_analyze_summary", "Normalize and deterministically assess an extracted request summary for completeness, deadlines and obvious operational warnings.", {
  title: z.string(), url: z.string(), summary: z.string(),
}, async raw => { try { return text(analyzeDeterministic(normalizeTender(raw))); } catch (e) { return fail(e); } });

queuedTool("rts_deadlines", "Return upcoming request deadlines sorted by urgency.", {
  query: z.string().optional(), days: z.number().int().min(0).max(365).default(14), limit: z.number().int().min(1).max(100).default(50),
}, async ({ query, days, limit }) => {
  try {
    const p = await open("/zapros/"); const raw = await extractRequestPages(p, 500);
    const tenders = filterTenders(raw.map(x => normalizeTender(x)), { query, minDaysLeft: 0, maxDaysLeft: days, sort: "deadline_asc" }).slice(0, limit);
    return text({ days, count: tenders.length, tenders });
  } catch (e) { return fail(e); }
});

queuedTool("rts_get_request", "Open a same-origin request card and extract its visible content and document links.", {
  url: z.string().describe("Same-origin request URL or path"),
}, async ({ url }) => {
  try {
    const p = await open(url); const snap = await visibleSnapshot(p);
    const documents = await p.locator("a[href]").evaluateAll(links => (links as HTMLAnchorElement[]).map(a => ({ name: (a.innerText || a.download || "document").trim(), url: a.href })).filter(x => /download|document|file|attachment|\.pdf|\.docx?|\.xlsx?|\.zip/i.test(x.url + x.name)).slice(0, 200));
    return text({ url: p.url(), title: await p.title(), text: snap.text, documents });
  } catch (e) { return fail(e); }
});

queuedTool("rts_build_dossier", "Build a complete machine-readable tender dossier: normalized fields, deterministic analysis, documents, tables, capabilities and content fingerprint.",{url:z.string()},async({url})=>{try{const p=await open(url);return text(await buildDossier(p));}catch(e){return fail(e);}});

queuedTool("rts_track_request", "Capture the current tender dossier, persist a local snapshot and report material changes since the previous capture.",{url:z.string()},async({url})=>{try{const p=await open(url);const dossier=await buildDossier(p);return text({dossier,tracking:await trackDossier(dossier)});}catch(e){return fail(e);}});

queuedTool("rts_compare_requests", "Compare two tender cards by normalized commercial fields, deadlines, documents and content.",{firstUrl:z.string(),secondUrl:z.string()},async({firstUrl,secondUrl})=>{try{const p=await open(firstUrl);const first=await buildDossier(p);await open(secondUrl);const second=await buildDossier(p);return text({first,second,comparison:compareDossiers(first,second)});}catch(e){return fail(e);}});

queuedTool("rts_prepare_offer_draft", "Preview or fill a price-offer draft in the current request form. Never submits, signs or publishes the offer.",{url:z.string(),price:z.number().positive(),quantity:z.number().positive().optional(),deliveryDays:z.number().int().nonnegative().optional(),validityDays:z.number().int().positive().optional(),comment:z.string().max(10000).optional(),execute:z.boolean().default(false),confirm:z.boolean().default(false)},async({url,execute,confirm,...draft})=>{try{if(execute&&(!config.allowWrites||!confirm))throw new Error("Draft execution is disabled. Set RTS_ALLOW_WRITES=true and pass confirm=true. Preview with execute=false first.");const p=await open(url);return text(await prepareOfferDraft(p,draft,execute));}catch(e){return fail(e);}});

queuedTool("rts_assess_readiness", "Assess operational readiness to participate: deadlines, economics, documents, qualification, contract and delivery checks.",{url:z.string()},async({url})=>{try{const p=await open(url);const dossier=await buildDossier(p);return text({dossier,readiness:assessReadiness(dossier)});}catch(e){return fail(e);}});

queuedTool("rts_bid_economics", "Calculate break-even price, target bid, profit, margin and maximum safe discount.",{startingPrice:z.number().positive(),directCosts:z.number().nonnegative(),logistics:z.number().nonnegative().optional(),overheads:z.number().nonnegative().optional(),guaranteeCost:z.number().nonnegative().optional(),financingCost:z.number().nonnegative().optional(),otherCosts:z.number().nonnegative().optional(),taxPercent:z.number().min(0).max(100).optional(),contingencyPercent:z.number().min(0).max(100).optional(),targetProfitPercent:z.number().min(0).max(100).optional()},async input=>{try{return text(calculateBidEconomics(input));}catch(e){return fail(e);}});

queuedTool("rts_build_workplan", "Build a backward preparation plan from the tender submission deadline with owners and internal due dates.",{url:z.string()},async({url})=>{try{const p=await open(url);const dossier=await buildDossier(p);return text({dossier,workplan:buildWorkplan(dossier)});}catch(e){return fail(e);}});

queuedTool("rts_extract_tables", "Extract visible tables from a same-origin RTS page as structured rows.", {url:z.string()},async({url})=>{try{const p=await open(url);const inventory=await inspectPortal(p);return text({url:p.url(),title:inventory.title,tables:inventory.tables});}catch(e){return fail(e);}});

queuedTool("rts_download_all_documents", "Download all recognized same-origin documents from a request card through the authenticated browser session.", {url:z.string(),maxFiles:z.number().int().min(1).max(100).default(30)},async({url,maxFiles})=>{try{const p=await open(url);const links=await p.locator("a[href]").evaluateAll(nodes=>(nodes as HTMLAnchorElement[]).map(a=>({name:(a.innerText||a.download||"document").trim(),url:a.href})).filter(x=>/download|document|file|attachment|\.pdf|\.docx?|\.xlsx?|\.zip/i.test(x.url+x.name)).slice(0,maxFiles));const saved=[];for(const item of links){const target=portalUrl(item.url);const response=await p.context().request.get(target);if(!response.ok()){saved.push({...item,error:`HTTP ${response.status()}`});continue;}const destination=safeDownloadPath(item.name||new URL(target).pathname.split("/").pop()||"document");await fs.writeFile(destination,await response.body());saved.push({...item,path:destination,status:response.status()});}return text({count:saved.length,documents:saved});}catch(e){return fail(e);}});

queuedTool("rts_download", "Download a same-origin document through the authenticated browser session.", {
  url: z.string(), filename: z.string().optional(),
}, async ({ url, filename }) => {
  try {
    const p = await getPage(); const target = portalUrl(url);
    const download = await Promise.all([p.waitForEvent("download"), p.evaluate(href => { const a=document.createElement("a"); a.href=href; a.click(); }, target)]).then(x => x[0]);
    const destination = safeDownloadPath(filename || download.suggestedFilename()); await download.saveAs(destination);
    return text({ path: destination, filename: download.suggestedFilename() });
  } catch (e) { return fail(e); }
});

queuedTool("rts_act", "Perform an explicit UI action on the current portal page. Mutating actions require RTS_ALLOW_WRITES=true and confirm=true.", {
  action: z.enum(["click", "fill", "select"]), selector: z.string(), value: z.string().optional(), confirm: z.boolean().default(false),
}, async ({ action, selector, value, confirm }) => {
  try {
    if (!config.allowWrites || !confirm) throw new Error("Write actions are disabled. Set RTS_ALLOW_WRITES=true and pass confirm=true after reviewing rts_open output.");
    const p = await getPage(); const locator = p.locator(selector).first();
    if (await locator.count() !== 1) throw new Error("Selector did not resolve to an element");
    if (action === "click") await locator.click();
    else if (action === "fill") await locator.fill(value ?? "");
    else await locator.selectOption(value ?? "");
    await p.waitForTimeout(500);
    return text({ ok: true, url: p.url(), title: await p.title(), ...(await visibleSnapshot(p)) });
  } catch (e) { return fail(e); }
});

queuedTool("rts_screenshot", "Save a screenshot of the current portal page.", { filename: z.string().default("rts-market.png"), fullPage: z.boolean().default(true) }, async ({ filename, fullPage }) => {
  try { const p = await getPage(); const destination = safeDownloadPath(filename); await p.screenshot({ path: destination, fullPage }); return text({ path: destination }); } catch (e) { return fail(e); }
});

queuedTool("rts_close", "Close the local browser session (profile remains on disk).", {}, async () => { await closeBrowser(); return text({ closed: true }); });

queuedTool("rts_forget_profile", "Close the browser and permanently delete the dedicated local profile. Disabled unless RTS_ALLOW_PROFILE_DELETION=true and an exact confirmation is supplied.", {
  confirm: z.literal(PROFILE_DELETE_CONFIRMATION),
}, async ({ confirm }) => { try { await forgetProfile(confirm); return text({ forgotten: true }); } catch (e) { return fail(e); } });

process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
await server.connect(new StdioServerTransport());
import fs from "node:fs/promises";
