import path from "node:path";

const bool = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : /^(1|true|yes)$/i.test(value);

export const config = {
  baseUrl: new URL(process.env.RTS_BASE_URL ?? "https://krd-market.rts-tender.ru").origin,
  headless: bool(process.env.RTS_HEADLESS, false),
  allowWrites: bool(process.env.RTS_ALLOW_WRITES, false),
  profileDir: path.resolve(process.env.RTS_PROFILE_DIR ?? ".rts-profile"),
  downloadDir: path.resolve(process.env.RTS_DOWNLOAD_DIR ?? "downloads"),
  timeoutMs: Number(process.env.RTS_TIMEOUT_MS ?? 30_000),
};

export function portalUrl(input: string): string {
  const url = new URL(input, config.baseUrl);
  if (url.origin !== config.baseUrl) throw new Error(`External URL is forbidden: ${url.origin}`);
  return url.href;
}
