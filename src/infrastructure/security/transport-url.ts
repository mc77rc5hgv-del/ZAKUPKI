const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopback(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return LOOPBACK_HOSTS.has(normalized) || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

export function assertSecureHubHttpUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("Адрес моста не должен содержать логин или пароль.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("Удалённый мост должен использовать HTTPS. HTTP разрешён только для localhost.");
  }
  return url;
}

export function toAgentWebSocketUrl(raw: string): string {
  const url = assertSecureHubHttpUrl(raw);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/agent/socket";
  url.search = "";
  url.hash = "";
  return url.href;
}
