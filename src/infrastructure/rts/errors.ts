export type RtsErrorCode = "RTS_NETWORK_ERROR" | "RTS_TIMEOUT" | "RTS_NAVIGATION_ERROR" | "RTS_UNAVAILABLE" | "RTS_QUEUE_TIMEOUT";

export class RtsError extends Error {
  code: RtsErrorCode;
  constructor(code: RtsErrorCode, message: string) {
    super(message);
    this.name = "RtsError";
    this.code = code;
  }
}

export function classifyNavigationError(error: unknown): RtsErrorCode {
  const message = error instanceof Error ? error.message : String(error);
  if (/ERR_(CONNECTION_RESET|CONNECTION_CLOSED|NETWORK_CHANGED)/i.test(message)) return "RTS_NETWORK_ERROR";
  if (/ERR_TIMED_OUT|Navigation timeout|Timeout \d+ms exceeded/i.test(message)) return "RTS_TIMEOUT";
  return "RTS_NAVIGATION_ERROR";
}

// A short, stable Russian description per code — safe to show to an end user.
// The raw Playwright error text (which can contain internal URLs/paths) is
// deliberately not included here; log it server-side instead if needed.
export function describeRtsErrorCode(code: RtsErrorCode): string {
  switch (code) {
    case "RTS_NETWORK_ERROR": return "Сетевая ошибка при обращении к РТС. Повторите попытку.";
    case "RTS_TIMEOUT": return "РТС не ответил вовремя. Повторите попытку.";
    case "RTS_UNAVAILABLE": return "РТС временно недоступен после повторных сбоев.";
    case "RTS_QUEUE_TIMEOUT": return "Браузер занят предыдущей операцией дольше обычного. Повторите попытку.";
    case "RTS_NAVIGATION_ERROR": return "Не удалось открыть страницу РТС. Повторите попытку.";
  }
}
