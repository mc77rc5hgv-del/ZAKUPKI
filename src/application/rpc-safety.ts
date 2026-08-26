const SAFE_RPC_CODES = new Set([
  "RPC_FAILED", "RPC_REPLAYED", "RPC_METHOD_NOT_ALLOWED", "RTS_NETWORK_ERROR",
  "RTS_TIMEOUT", "RTS_NAVIGATION_ERROR", "RTS_UNAVAILABLE", "RTS_QUEUE_TIMEOUT",
]);

const SAFE_MESSAGES: Record<string, string> = {
  RPC_FAILED: "Локальный агент не смог выполнить операцию.",
  RPC_REPLAYED: "Повторная команда отклонена.",
  RPC_METHOD_NOT_ALLOWED: "Команда не разрешена.",
  RTS_NETWORK_ERROR: "Сетевая ошибка при обращении к РТС. Повторите попытку.",
  RTS_TIMEOUT: "РТС не ответил вовремя. Повторите попытку.",
  RTS_NAVIGATION_ERROR: "Не удалось открыть страницу РТС. Повторите попытку.",
  RTS_UNAVAILABLE: "РТС временно недоступен после повторных сбоев.",
  RTS_QUEUE_TIMEOUT: "Браузер занят предыдущей операцией. Повторите попытку.",
};

export function safeRpcError(error: unknown): { code: string; message: string } {
  const candidate = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "RPC_FAILED";
  const code = SAFE_RPC_CODES.has(candidate) ? candidate : "RPC_FAILED";
  return { code, message: SAFE_MESSAGES[code] };
}

const PRIVATE_KEYS = new Set(["path", "localPath", "profileDir", "downloadDir", "snapshotDir", "stack"]);

export function sanitizeRpcResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRpcResult);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  let savedLocally = false;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEYS.has(key)) { if ((key === "path" || key === "localPath") && typeof item === "string") savedLocally = true; continue; }
    if (key === "error" && typeof item === "string") {
      output.error = /^HTTP \d{3}$/.test(item) ? item : "Локальная операция завершилась ошибкой";
      continue;
    }
    output[key] = sanitizeRpcResult(item);
  }
  if (savedLocally) output.savedLocally = true;
  return output;
}
