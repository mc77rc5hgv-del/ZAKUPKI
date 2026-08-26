import path from "node:path";

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(value);

const optional = (value: string | undefined) => value?.trim() || undefined;
const proxyServer = optional(process.env.RTS_PROXY_SERVER);
const cdpUrl = optional(process.env.RTS_CDP_URL);

function safeLocalCdpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!(host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host))) {
    throw new Error("RTS_CDP_URL разрешён только для локального Chrome (localhost/127.0.0.1).");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("RTS_CDP_URL должен использовать http:// или https://.");
  return url.href;
}

export const config = {
  baseUrl: new URL(process.env.RTS_BASE_URL ?? "https://krd-market.rts-tender.ru").origin,
  headless: bool(process.env.RTS_HEADLESS, false),
  allowWrites: bool(process.env.RTS_ALLOW_WRITES, false),
  allowProfileDeletion: bool(process.env.RTS_ALLOW_PROFILE_DELETION, false),
  browserChannel: optional(process.env.RTS_BROWSER_CHANNEL),
  cdpUrl: safeLocalCdpUrl(cdpUrl),
  profileDir: path.resolve(process.env.RTS_PROFILE_DIR ?? ".rts-profile"),
  downloadDir: path.resolve(process.env.RTS_DOWNLOAD_DIR ?? "downloads"),
  snapshotDir: path.resolve(process.env.RTS_SNAPSHOT_DIR ?? ".rts-snapshots"),
  timeoutMs: Number(process.env.RTS_TIMEOUT_MS ?? 30_000),
  navigationRetries: Math.max(1, Number(process.env.RTS_NAVIGATION_RETRIES ?? 3)),
  proxy: proxyServer
    ? {
        server: proxyServer,
        username: optional(process.env.RTS_PROXY_USERNAME),
        password: optional(process.env.RTS_PROXY_PASSWORD),
      }
    : undefined,
};

export function portalUrl(input: string): string {
  const url = new URL(input, config.baseUrl);
  if (url.origin !== config.baseUrl) throw new Error(`External URL is forbidden: ${url.origin}`);
  return url.href;
}
