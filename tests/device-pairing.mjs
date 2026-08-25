import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BOT_TOKEN = "42:device-pairing-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-device-pairing-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";

const { startWebServer } = await import("../dist/interfaces/web/server.js");

function initDataFor(userId) {
  const values = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: "Owner" }) };
  const check = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

const server = await startWebServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const ownerHeaders = { "x-telegram-init-data": initDataFor(42) };

try {
  const start = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  assert.equal(start.status, 200);
  const { data: pairing } = await start.json();
  assert.ok(pairing.code);
  assert.ok(pairing.expiresAt);

  const deviceId = "test-device-1";
  const complete = await fetch(`${base}/api/connection/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, deviceId, displayName: "Test PC", agentVersion: "0.1.0" }),
  });
  assert.equal(complete.status, 200);
  const { data: paired } = await complete.json();
  assert.equal(paired.deviceId, deviceId);
  assert.equal(paired.ownerTelegramId, 42);
  assert.ok(paired.accessToken && paired.accessToken.length >= 32);

  // the code is single-use
  const reuse = await fetch(`${base}/api/connection/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, deviceId: "test-device-2" }),
  });
  assert.equal(reuse.status, 400);
  const reuseBody = await reuse.json();
  assert.equal(reuseBody.ok, false);
  assert.equal(reuseBody.error.code, "PAIRING_CODE_INVALID");

  // a never-issued code is rejected
  const bogus = await fetch(`${base}/api/connection/devices/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "ZZZZZ-ZZZZZ", deviceId: "test-device-3" }),
  });
  assert.equal(bogus.status, 400);

  // the device now shows up for its owner, never revoked, access token not echoed back
  const list = await fetch(`${base}/api/connection/devices`, { headers: ownerHeaders });
  assert.equal(list.status, 200);
  const { data: devices } = await list.json();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceId, deviceId);
  assert.equal(devices[0].revokedAt, undefined);
  assert.ok(!JSON.stringify(devices).includes(paired.accessToken), "device listing must never echo the access token");

  console.log("device pairing: ok");
} finally {
  await new Promise(resolve => server.close(resolve));
}
