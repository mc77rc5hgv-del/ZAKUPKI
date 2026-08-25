import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config, portalUrl } from "./config.js";

let context: BrowserContext | undefined;
let page: Page | undefined;
const transientNavigationError =
  /ERR_(CONNECTION_RESET|CONNECTION_CLOSED|NETWORK_CHANGED|TIMED_OUT)|Navigation timeout/i;

async function navigate(page: Page, target: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.navigationRetries; attempt += 1) {
    try {
      return await page.goto(target, { waitUntil: "domcontentloaded" });
    } catch (error) {
      lastError = error;
      if (
        attempt === config.navigationRetries ||
        !transientNavigationError.test(String(error))
      ) {
        throw error;
      }
      await page.waitForTimeout(attempt * 1_500);
    }
  }
  throw lastError;
}

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  await fs.mkdir(config.profileDir, { recursive: true });
  await fs.mkdir(config.downloadDir, { recursive: true });
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: config.headless,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1000 },
    locale: "ru-RU",
    proxy: config.proxy,
  });
  context.setDefaultTimeout(config.timeoutMs);
  page = context.pages()[0] ?? (await context.newPage());
  return page;
}

export async function open(pathname = "/zapros/"): Promise<Page> {
  const p = await getPage();
  const target = portalUrl(pathname);
  if (p.url() !== target) await navigate(p,target);
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

export async function forgetProfile() {
  await closeBrowser();
  await fs.rm(config.profileDir, { recursive: true, force: true });
}

export function safeDownloadPath(suggested: string): string {
  const clean = path.basename(suggested).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  return path.join(config.downloadDir, clean || `download-${Date.now()}`);
}
