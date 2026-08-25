import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const code = process.argv[2] ?? process.env.PAIR_CODE ?? "";
const hubUrl = process.argv[3] ?? process.env.AGENT_HUB_URL ?? process.env.MINIAPP_URL ?? "";
const deviceDir = path.resolve(process.env.RTS_DEVICE_DIR ?? ".rts-device");
const deviceFile = path.join(deviceDir, "device.json");

if (!code) {
  console.error("Использование: pnpm run pair-device <код из Mini App> [адрес моста]");
  console.error("Код показывается в Mini App: Подключение → «Подключить компьютер». Действует несколько минут.");
  process.exit(1);
}
if (!hubUrl) {
  console.error("Не задан адрес моста. Передайте вторым аргументом или задайте AGENT_HUB_URL/MINIAPP_URL в .env.");
  process.exit(1);
}

await fs.mkdir(deviceDir, { recursive: true });
let deviceId;
try {
  const existing = JSON.parse(await fs.readFile(deviceFile, "utf8"));
  deviceId = typeof existing.deviceId === "string" ? existing.deviceId : undefined;
} catch { /* no existing identity yet */ }
deviceId ??= crypto.randomUUID();

const endpoint = new URL("/api/connection/devices/pair", hubUrl).href;
console.log(`Сопрягаю это устройство с ${endpoint} …`);

const response = await fetch(endpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code, deviceId, displayName: os.hostname(), agentVersion: "0.1.0" }),
}).catch(error => { console.error("Не удалось обратиться к мосту:", error.message); process.exit(1); });

const payload = await response.json().catch(() => undefined);
if (!response.ok || !payload?.ok) {
  console.error("Сопряжение не выполнено:", payload?.error?.message ?? `HTTP ${response.status}`);
  process.exit(1);
}

const record = { deviceId, accessToken: payload.data.accessToken, ownerTelegramId: payload.data.ownerTelegramId, hubUrl, pairedAt: new Date().toISOString() };
await fs.writeFile(deviceFile, JSON.stringify(record, null, 2), { mode: 0o600 });
await fs.chmod(deviceFile, 0o600).catch(() => {});

console.log("Устройство сопряжено.");
console.log(`Владелец Telegram ID: ${payload.data.ownerTelegramId}`);
console.log("Запустите локальный агент: pnpm run local-agent");
