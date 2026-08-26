import type { Page } from "playwright";
import type { RawRequest } from "../../domain/procurement.js";

export async function visibleSnapshot(page: Page) {
  return page.locator("body").evaluate((body) => {
    const visible = (el: Element) => {
      const s = getComputedStyle(el); const r = el.getBoundingClientRect();
      return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0;
    };
    const controls = [...body.querySelectorAll("a,button,input,select,textarea")]
      .filter(visible).slice(0, 250).map((el, index) => ({
        index,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || (el as HTMLInputElement).value || "").trim().slice(0, 300),
        label: el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder"),
        href: el instanceof HTMLAnchorElement ? el.href : null,
        type: el.getAttribute("type"),
      }));
    return { text: (body as HTMLElement).innerText.slice(0, 40_000), controls };
  });
}

export async function extractRequests(page: Page, limit: number): Promise<RawRequest[]> {
  return page.locator("a[href]").evaluateAll((links, max) => {
    const seen = new Set<string>(); const out: RawRequest[] = [];
    for (const a of links as HTMLAnchorElement[]) {
      const text = (a.innerText || a.textContent || "").trim().replace(/\s+/g, " ");
      let url: URL;
      try { url = new URL(a.href); } catch { continue; }
      if (!text || !/^\/search\/sell\/\d+\/(?:request|offers|contract)\/?$/i.test(url.pathname)) continue;
      const canonicalPath = url.pathname.replace(/\/(?:offers|contract)\/?$/i, "/request");
      const canonicalUrl = `${url.origin}${canonicalPath}`;
      if (seen.has(canonicalUrl)) continue; seen.add(canonicalUrl);
      const card = a.closest(".catalog__strip,article,tr,.card,.request,.item,li") as HTMLElement | null;
      const titleLink = card?.querySelector('a[href*="/search/sell/"][href$="/request"]') as HTMLAnchorElement | null;
      const title = (titleLink?.innerText || titleLink?.textContent || text).trim().replace(/\s+/g, " ");
      out.push({ title: title.slice(0, 500), url: canonicalUrl, summary: (card?.innerText || text).trim().slice(0, 4000) });
      if (out.length >= max) break;
    }
    return out;
  }, limit);
}

export async function extractRequestPages(page: Page, limit: number, maxPages = 20): Promise<RawRequest[]> {
  const out = new Map<string, RawRequest>(); const visitedLinks = new Set<string>(); let stagnantPasses = 0;
  for (let pageNumber = 0; pageNumber < maxPages && out.size < limit; pageNumber++) {
    await page.locator('a[href*="/search/sell/"][href$="/request"]').first().waitFor({ state: "attached", timeout: 10_000 }).catch(() => {});
    const before = out.size;
    for (const row of await extractRequests(page, limit - out.size)) out.set(row.url, row);
    stagnantPasses = out.size === before ? stagnantPasses + 1 : 0;
    if (stagnantPasses >= 2) break;
    if (out.size >= limit) break;
    const next = page.locator('button:has-text("Показать еще"),button:has-text("Показать ещё"),a[rel="next"],a:has-text("Следующая"),a:has-text("Далее"),button:has-text("Следующая")').filter({ visible: true }).first();
    if (!await next.count() || !await next.isEnabled()) break;
    const href = await next.getAttribute("href");
    if (href) {
      const target = new URL(href, page.url()); if (target.origin !== new URL(page.url()).origin) break;
      if (visitedLinks.has(target.href)) break; visitedLinks.add(target.href);
      await page.goto(target.href, { waitUntil: "domcontentloaded" });
    } else {
      await next.click();
      await page.waitForTimeout(1_250);
    }
  }
  return [...out.values()].slice(0, limit);
}
