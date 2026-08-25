import type { Page } from "playwright";
import type { RawRequest } from "./procurement.js";

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
      if (!text || !/запрос|закуп|request|notice|trade|tender/i.test(a.href + " " + text)) continue;
      if (seen.has(a.href)) continue; seen.add(a.href);
      const card = a.closest("article,tr,.card,.request,.item,li") as HTMLElement | null;
      out.push({ title: text.slice(0, 500), url: a.href, summary: (card?.innerText || text).trim().slice(0, 2000) });
      if (out.length >= max) break;
    }
    return out;
  }, limit);
}

export async function extractRequestPages(page: Page, limit: number, maxPages = 20): Promise<RawRequest[]> {
  const out = new Map<string, RawRequest>(); const visited = new Set<string>();
  for (let pageNumber = 0; pageNumber < maxPages && out.size < limit; pageNumber++) {
    if (visited.has(page.url())) break; visited.add(page.url());
    for (const row of await extractRequests(page, limit - out.size)) out.set(row.url, row);
    const next = page.locator('a[rel="next"],a:has-text("Следующая"),a:has-text("Далее"),button:has-text("Следующая")').filter({ visible: true }).first();
    if (!await next.count() || !await next.isEnabled()) break;
    const href = await next.getAttribute("href");
    if (href) {
      const target = new URL(href, page.url()); if (target.origin !== new URL(page.url()).origin) break;
      await page.goto(target.href, { waitUntil: "domcontentloaded" });
    } else {
      await Promise.all([page.waitForLoadState("domcontentloaded").catch(() => {}), next.click()]);
    }
  }
  return [...out.values()].slice(0, limit);
}
