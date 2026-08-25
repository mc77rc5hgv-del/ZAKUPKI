import path from "node:path";

const ids = (value = "") => new Set(value.split(",").map(x => Number(x.trim())).filter(Number.isSafeInteger));

export const botConfig = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  allowedUsers: ids(process.env.TELEGRAM_ALLOWED_USERS),
  adminUsers: ids(process.env.TELEGRAM_ADMIN_USERS),
  dataDir: path.resolve(process.env.BOT_DATA_DIR ?? ".bot-data"),
  monitorIntervalMs: Math.max(1, Number(process.env.MONITOR_INTERVAL_MINUTES ?? 15)) * 60_000,
  mcpCommand: process.env.MCP_COMMAND ?? process.execPath,
  mcpArgs: (process.env.MCP_ARGS ?? "dist/entrypoints/mcp.js").split(/\s+/).filter(Boolean),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4",
  miniAppUrl: process.env.MINIAPP_URL ?? "",
  webPort: Number(process.env.PORT ?? process.env.MINIAPP_PORT ?? 3000),
  miniAppDevBypass: /^(1|true|yes)$/i.test(process.env.MINIAPP_DEV_BYPASS ?? "false"),
  telegramAuthMaxAgeSeconds: Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? 86_400),
};

export function assertBotConfig() {
  if (!botConfig.token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!botConfig.allowedUsers.size) throw new Error("TELEGRAM_ALLOWED_USERS must contain at least one numeric Telegram ID");
}
