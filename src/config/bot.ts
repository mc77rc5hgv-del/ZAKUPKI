import path from "node:path";

const ids = (value = "") => new Set(value.split(",").map(x => Number(x.trim())).filter(Number.isSafeInteger));
const bool = (value = "false") => /^(1|true|yes)$/i.test(value);
const numericId = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};
const allowedUsers = ids(process.env.TELEGRAM_ALLOWED_USERS);
const configuredOwner = numericId(process.env.RTS_ACCOUNT_OWNER_ID);

export const botConfig = {
  token: process.env.TELEGRAM_BOT_TOKEN ?? "",
  allowedUsers,
  adminUsers: ids(process.env.TELEGRAM_ADMIN_USERS),
  dataDir: path.resolve(process.env.BOT_DATA_DIR ?? ".bot-data"),
  monitorIntervalMs: Math.max(1, Number(process.env.MONITOR_INTERVAL_MINUTES ?? 15)) * 60_000,
  mcpCommand: process.env.MCP_COMMAND ?? process.execPath,
  mcpArgs: (process.env.MCP_ARGS ?? "dist/entrypoints/mcp.js").split(/\s+/).filter(Boolean),
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-5.4",
  miniAppUrl: process.env.MINIAPP_URL ?? "",
  webPort: Number(process.env.PORT ?? process.env.MINIAPP_PORT ?? 3000),
  miniAppDevBypass: bool(process.env.MINIAPP_DEV_BYPASS),
  telegramAuthMaxAgeSeconds: Number(process.env.TELEGRAM_AUTH_MAX_AGE_SECONDS ?? 86_400),
  rtsAccountOwnerId: configuredOwner ?? (allowedUsers.size === 1 ? [...allowedUsers][0] : undefined),
  rtsHeadless: bool(process.env.RTS_HEADLESS),
  allowCloudAccountSession: bool(process.env.RTS_ALLOW_CLOUD_ACCOUNT_SESSION),
};

export function rtsAccess(userId: number) {
  const isOwner = botConfig.rtsAccountOwnerId === userId;
  const cloudBlocked = botConfig.rtsHeadless && !botConfig.allowCloudAccountSession;
  return { isOwner, ownerConfigured: botConfig.rtsAccountOwnerId !== undefined, cloudBlocked };
}

export function assertRtsAccess(userId: number) {
  const access = rtsAccess(userId);
  if (!access.ownerConfigured) throw new Error("Владелец сессии РТС не настроен");
  if (!access.isOwner) throw new Error("Сессия РТС принадлежит другому пользователю");
  if (access.cloudBlocked) throw new Error("Облачная авторизация РТС отключена политикой безопасности");
}

export function assertBotConfig() {
  if (!botConfig.token) throw new Error("TELEGRAM_BOT_TOKEN is required");
  if (!botConfig.allowedUsers.size) throw new Error("TELEGRAM_ALLOWED_USERS must contain at least one numeric Telegram ID");
}
