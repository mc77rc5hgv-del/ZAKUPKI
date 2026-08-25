#!/usr/bin/env node
import fs from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { closeBrowser, getPage, open, safeDownloadPath, status } from "./browser.js";
import { config, portalUrl } from "./config.js";
import { extractRequestPages, extractRequests, visibleSnapshot } from "./extract.js";
import { analyzeDeterministic, filterTenders, normalizeTender } from "./procurement.js";

const server = new McpServer({ name: "krd-market-rts", version: "0.1.0" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const fail = (error: unknown) => ({ isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }] });

server.tool("rts_session_status", "Open the persistent RTS browser session and report login/Anti-DDoS state. Login and CAPTCHA must be completed manually in the opened browser.", {}, async () => {
  try { await open(); return text(await status()); } catch (e) { return fail(e); }
});

server.tool("rts_open", "Navigate inside krd-market.rts-tender.ru and return a safe visible-page snapshot.", {
  path: z.string().default("/zapros/").describe("Portal-relative path or same-origin URL"),
}, async ({ path }) => {
  try { const p = await open(path); return text({ url: p.url(), title: await p.title(), ...(await visibleSnapshot(p)) }); } catch (e) { return fail(e); }
});

server.tool("rts_list_requests", "List procurement/request links from the public request page. Filters are applied through visible search controls when recognizable.", {
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

server.tool("rts_search_advanced", "Search requests and apply normalized tender filters: keywords, exclusions, price, customer, location, status, OKPD2, deadlines and document availability.", {
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

server.tool("rts_analyze_summary", "Normalize and deterministically assess an extracted request summary for completeness, deadlines and obvious operational warnings.", {
  title: z.string(), url: z.string(), summary: z.string(),
}, async raw => { try { return text(analyzeDeterministic(normalizeTender(raw))); } catch (e) { return fail(e); } });

server.tool("rts_deadlines", "Return upcoming request deadlines sorted by urgency.", {
  query: z.string().optional(), days: z.number().int().min(0).max(365).default(14), limit: z.number().int().min(1).max(100).default(50),
}, async ({ query, days, limit }) => {
  try {
    const p = await open("/zapros/"); const raw = await extractRequestPages(p, 500);
    const tenders = filterTenders(raw.map(x => normalizeTender(x)), { query, minDaysLeft: 0, maxDaysLeft: days, sort: "deadline_asc" }).slice(0, limit);
    return text({ days, count: tenders.length, tenders });
  } catch (e) { return fail(e); }
});

server.tool("rts_get_request", "Open a same-origin request card and extract its visible content and document links.", {
  url: z.string().describe("Same-origin request URL or path"),
}, async ({ url }) => {
  try {
    const p = await open(url); const snap = await visibleSnapshot(p);
    const documents = await p.locator("a[href]").evaluateAll(links => (links as HTMLAnchorElement[]).map(a => ({ name: (a.innerText || a.download || "document").trim(), url: a.href })).filter(x => /download|document|file|attachment|\.pdf|\.docx?|\.xlsx?|\.zip/i.test(x.url + x.name)).slice(0, 200));
    return text({ url: p.url(), title: await p.title(), text: snap.text, documents });
  } catch (e) { return fail(e); }
});

server.tool("rts_download", "Download a same-origin document through the authenticated browser session.", {
  url: z.string(), filename: z.string().optional(),
}, async ({ url, filename }) => {
  try {
    const p = await getPage(); const target = portalUrl(url);
    const download = await Promise.all([p.waitForEvent("download"), p.evaluate(href => { const a=document.createElement("a"); a.href=href; a.click(); }, target)]).then(x => x[0]);
    const destination = safeDownloadPath(filename || download.suggestedFilename()); await download.saveAs(destination);
    return text({ path: destination, filename: download.suggestedFilename() });
  } catch (e) { return fail(e); }
});

server.tool("rts_act", "Perform an explicit UI action on the current portal page. Mutating actions require RTS_ALLOW_WRITES=true and confirm=true.", {
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

server.tool("rts_screenshot", "Save a screenshot of the current portal page.", { filename: z.string().default("rts-market.png"), fullPage: z.boolean().default(true) }, async ({ filename, fullPage }) => {
  try { const p = await getPage(); const destination = safeDownloadPath(filename); await p.screenshot({ path: destination, fullPage }); return text({ path: destination }); } catch (e) { return fail(e); }
});

server.tool("rts_close", "Close the local browser session (profile remains on disk).", {}, async () => { await closeBrowser(); return text({ closed: true }); });

process.on("SIGINT", async () => { await closeBrowser(); process.exit(0); });
await server.connect(new StdioServerTransport());
