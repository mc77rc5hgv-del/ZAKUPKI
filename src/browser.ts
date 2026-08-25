import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config, portalUrl } from "./config.js";

let context: BrowserContext | undefined;
let page: Page | undefined;

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  await fs.mkdir(config.profileDir, { recursive: true });
  await fs.mkdir(config.downloadDir, { recursive: true });
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    locale: "ru-RU",
  });
  context.setDefaultTimeout(config.timeoutMs);
  page = context.pages()[0] ?? (await context.newPage());
  return page;
}

export async function open(pathname = "/zapros/"): Promise<Page> {
  const p = await getPage();
  const target = portalUrl(pathname);
  if (p.url() !== target) await p.goto(target, { waitUntil: "domcontentloaded" });
  return p;
}

export async function status() {
  const p = await getPage();
  const body = (await p.locator("body").innerText().catch(() => "")).slice(0, 5000);
  return {
    url: p.url(), title: await p.title(),
    antiDdos: /Anti-DDoS|Проверяем ваш браузер/i.test(body),
    likelyLoggedIn: /выйти|личный кабинет|мои (заявки|предложения)/i.test(body),
    headed: !config.headless,
  };
}

export async function closeBrowser() {
  await context?.close(); context = undefined; page = undefined;
}

export function safeDownloadPath(suggested: string): string {
  const clean = path.basename(suggested).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return path.join(config.downloadDir, clean || `download-${Date.now()}`);
}
