import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const BOT_TOKEN = "42:device-revocation-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-device-revocation-"));
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

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once("message", raw => resolve(JSON.parse(String(raw))));
    ws.once("close", (code) => reject(new Error(`socket closed before a message arrived (code ${code})`)));
    ws.once("error", reject);
  });
}
function waitForClose(ws) {
  return new Promise(resolve => ws.once("close", code => resolve(code)));
}

const server = await startWebServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/agent/socket`;
const ownerHeaders = { "x-telegram-init-data": initDataFor(42) };

try {
  const start = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  const { data: pairing } = await start.json();
  const deviceId = "revocation-device-1";
  const complete = await fetch(`${base}/api/connection/devices/pair`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, deviceId }),
  });
  const { data: paired } = await complete.json();

  const agent = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { agent.once("open", resolve); agent.once("error", reject); });
  agent.send(JSON.stringify({ type: "hello", deviceId, token: paired.accessToken, agentVersion: "0.1.0" }));
  const helloReply = await nextMessage(agent);
  assert.equal(helloReply.type, "hello_ok");
  assert.equal(helloReply.ownerTelegramId, 42);

  const listOnline = await fetch(`${base}/api/connection/devices`, { headers: ownerHeaders });
  const { data: devicesOnline } = await listOnline.json();
  assert.equal(devicesOnline.find(d => d.deviceId === deviceId)?.online, true);

  const closeWatcher = waitForClose(agent);
  const revoke = await fetch(`${base}/api/connection/devices/revoke`, {
    method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  assert.equal(revoke.status, 200);
  const revokeBody = await revoke.json();
  assert.equal(revokeBody.data.revoked, true);
  await closeWatcher; // the hub must proactively drop an active connection on revoke

  const listRevoked = await fetch(`${base}/api/connection/devices`, { headers: ownerHeaders });
  const { data: devicesRevoked } = await listRevoked.json();
  const revokedEntry = devicesRevoked.find(d => d.deviceId === deviceId);
  assert.ok(revokedEntry.revokedAt);
  assert.equal(revokedEntry.online, false);

  // a fresh connection using the now-revoked credentials must be refused
  const secondAttempt = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { secondAttempt.once("open", resolve); secondAttempt.once("error", reject); });
  secondAttempt.send(JSON.stringify({ type: "hello", deviceId, token: paired.accessToken, agentVersion: "0.1.0" }));
  const secondReply = await nextMessage(secondAttempt);
  assert.equal(secondReply.type, "hello_error");
  assert.equal(secondReply.code, "DEVICE_REVOKED");

  console.log("device revocation: ok");
} finally {
  await new Promise(resolve => server.close(resolve));
}
