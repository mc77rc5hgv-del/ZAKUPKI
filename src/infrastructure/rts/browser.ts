import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { config, portalUrl } from "./config.js";
import { RtsError, classifyNavigationError, describeRtsErrorCode } from "./errors.js";
import { assessRtsSession } from "../../domain/session-detection.js";

let context: BrowserContext | undefined;
let page: Page | undefined;
let externalBrowser: Browser | undefined;
const PROFILE_MARKER = ".zakupki-rts-profile.json";
const PROFILE_MARKER_MAGIC = "zakupki-rts-browser-profile-v1";
export const PROFILE_DELETE_CONFIRMATION = "DELETE_RTS_PROFILE";
const transientNavigationError =
  /ERR_(CONNECTION_RESET|CONNECTION_CLOSED|NETWORK_CHANGED|TIMED_OUT)|Navigation timeout/i;

// Circuit breaker: after repeated consecutive navigation failures, stop hammering
// a portal that is clearly down and fail fast for a cool-down period instead.
const CIRCUIT_FAILURE_THRESHOLD = Math.max(1, Number(process.env.RTS_CIRCUIT_THRESHOLD ?? 5));
const CIRCUIT_COOLDOWN_MS = Math.max(1_000, Number(process.env.RTS_CIRCUIT_COOLDOWN_MS ?? 60_000));
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function assertCircuitClosed() {
  const remainingMs = circuitOpenUntil - Date.now();
  if (remainingMs > 0) throw new RtsError("RTS_UNAVAILABLE", `РТС недоступен после повторных сбоев подключения. Повтор через ${Math.ceil(remainingMs / 1000)} с.`);
}

async function navigate(page: Page, target: string) {
  assertCircuitClosed();
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.navigationRetries; attempt += 1) {
    try {
      const result = await page.goto(target, { waitUntil: "domcontentloaded" });
      consecutiveFailures = 0;
      circuitOpenUntil = 0;
      return result;
    } catch (error) {
      lastError = error;
      if (
        attempt === config.navigationRetries ||
        !transientNavigationError.test(String(error))
      ) {
        break;
      }
      await page.waitForTimeout(attempt * 1_500);
    }
  }
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  const code = classifyNavigationError(lastError);
  // The raw Playwright/network error (can include internal URLs) stays in the
  // server log only; callers — including Telegram and the Mini App — only ever
  // see the short, stable, translated description for the classified code.
  console.error("rts navigate failed", code, lastError instanceof Error ? lastError.message : String(lastError));
  throw new RtsError(code, describeRtsErrorCode(code));
}

export async function getPage(): Promise<Page> {
  if (page && !page.isClosed()) return page;
  await fs.mkdir(config.downloadDir, { recursive: true });
  if (config.cdpUrl) {
    externalBrowser = await chromium.connectOverCDP(config.cdpUrl);
    context = externalBrowser.contexts()[0];
    if (!context) throw new Error("В локальном Chrome не найден активный профиль.");
  } else {
    await ensureOwnedProfileDirectory(config.profileDir);
    context = await chromium.launchPersistentContext(config.profileDir, {
      channel: config.browserChannel,
      headless: config.headless,
      acceptDownloads: true,
      viewport: { width: 1440, height: 1000 },
      locale: "ru-RU",
      proxy: config.proxy,
    });
  }
  context.setDefaultTimeout(config.timeoutMs);
  const pages = context.pages().filter(candidate => !candidate.isClosed());
  page = [...pages].reverse().find(candidate => { try { return new URL(candidate.url()).origin === config.baseUrl; } catch { return false; } }) ?? pages.at(-1) ?? (await context.newPage());
  return page;
}

export async function open(pathname = "/zapros/"): Promise<Page> {
  const p = await getPage();
  const target = portalUrl(pathname);
  if (p.url() !== target) await navigate(p,target);
  return p;
}

export async function status() {
  await getPage();
  const candidates = (context?.pages() ?? []).filter(candidate => { try { return !candidate.isClosed() && new URL(candidate.url()).origin === config.baseUrl; } catch { return false; } });
  const inspected = await Promise.all((candidates.length ? candidates : [page!]).map(async candidate => {
    const evidence = await candidate.locator("body").evaluate(body => {
      const visible = (element: Element) => { const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&rect.width>0&&rect.height>0; };
      const controls=[...body.querySelectorAll("a,button,input[type=submit]")].filter(visible).slice(0,500).map(element=>`${element.textContent??""} ${element.getAttribute("aria-label")??""} ${element.getAttribute("title")??""} ${element.getAttribute("href")??""}`).join(" ");
      return { body:(body as HTMLElement).innerText.slice(0,30_000),controls:controls.slice(0,20_000),hasPassword:Boolean(body.querySelector('input[type="password"]')) };
    }).catch(() => ({ body:"", controls:"", hasPassword:false }));
    return { candidate, evidence, assessment:assessRtsSession(evidence) };
  }));
  const selected = inspected.sort((a,b)=>b.assessment.score-a.assessment.score)[0];
  if (selected) page=selected.candidate;
  const p=page!;const body=selected?.evidence.body??"";const assessment=selected?.assessment??assessRtsSession({body});
  return {
    url: p.url(), title: await p.title(),
    antiDdos: /Anti-DDoS|Проверяем ваш браузер/i.test(body),
    likelyLoggedIn: assessment.likelyLoggedIn,
    authSignals: assessment.signals,
    portalTabs: candidates.length,
    headed: config.cdpUrl ? true : !config.headless,
    connectionMode: config.cdpUrl ? "existing_chrome" : "managed_profile",
  };
}

export async function closeBrowser() {
  if (!config.cdpUrl) await context?.close();
  // In CDP mode Chrome belongs to the user. Never close that browser window;
  // only forget local references so a later command can reconnect.
  context = undefined; page = undefined; externalBrowser = undefined;
}

export async function forgetProfile(confirm: string) {
  if (config.cdpUrl) throw new Error("Профиль внешнего Chrome нельзя удалить через мост.");
  if (!config.allowProfileDeletion) throw new Error("Удаление профиля отключено. Задайте RTS_ALLOW_PROFILE_DELETION=true только на локальном агенте.");
  if (confirm !== PROFILE_DELETE_CONFIRMATION) throw new Error(`Для удаления профиля требуется подтверждение ${PROFILE_DELETE_CONFIRMATION}.`);
  const profileDir = assertSafeProfileDirectory(config.profileDir);
  await assertOwnedProfileDirectory(profileDir);
  await closeBrowser();
  await fs.rm(profileDir, { recursive: true });
}

function assertSafeProfileDirectory(input: string): string {
  const resolved = path.resolve(input);
  const root = path.parse(resolved).root;
  const forbidden = new Set([path.resolve(root), path.resolve(os.homedir()), path.resolve(process.cwd())]);
  if (forbidden.has(resolved)) throw new Error("RTS_PROFILE_DIR указывает на небезопасный системный или рабочий каталог.");
  if (!path.basename(resolved) || [".", ".."].includes(path.basename(resolved))) throw new Error("Некорректный RTS_PROFILE_DIR.");
  return resolved;
}

async function assertOwnedProfileDirectory(profileDir: string): Promise<void> {
  let marker: unknown;
  try { marker = JSON.parse(await fs.readFile(path.join(profileDir, PROFILE_MARKER), "utf8")); }
  catch { throw new Error("Профиль не помечен как созданный ZAKUPKI; удаление запрещено."); }
  if ((marker as { magic?: unknown })?.magic !== PROFILE_MARKER_MAGIC) throw new Error("Маркер профиля ZAKUPKI недействителен; удаление запрещено.");
}

async function ensureOwnedProfileDirectory(input: string): Promise<void> {
  const profileDir = assertSafeProfileDirectory(input);
  await fs.mkdir(profileDir, { recursive: true });
  const markerPath = path.join(profileDir, PROFILE_MARKER);
  try { await assertOwnedProfileDirectory(profileDir); return; } catch { /* initialize only a dedicated/empty directory */ }
  const entries = await fs.readdir(profileDir);
  const safeLegacyNames = new Set([".rts-profile", "rts-profile", "rts_profile"]);
  if (entries.length > 0 && !safeLegacyNames.has(path.basename(profileDir).toLowerCase())) {
    throw new Error("Непустой RTS_PROFILE_DIR не принадлежит ZAKUPKI. Выберите отдельный каталог rts-profile.");
  }
  await fs.writeFile(markerPath, JSON.stringify({ magic: PROFILE_MARKER_MAGIC, createdAt: new Date().toISOString() }, null, 2), { encoding: "utf8", mode: 0o600 });
}

export function safeDownloadPath(suggested: string): string {
  const clean = path.basename(suggested).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  const parsed = path.parse(clean || "download");
  return path.join(config.downloadDir, `${parsed.name || "download"}-${randomUUID().slice(0, 8)}${parsed.ext}`);
}
