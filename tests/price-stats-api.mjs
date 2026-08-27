import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const BOT_TOKEN = "42:price-stats-api-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-price-stats-api-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";
process.env.RTS_TRANSPORT = "hub";

const { startWebServer } = await import("../dist/interfaces/web/server.js");
const { isAllowedRpcMethod } = await import("../dist/application/rpc-allowlist.js");

assert.equal(isAllowedRpcMethod("rts_price_stats"), true, "price stats must be relayable through the hub — it never touches the browser page");

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
const ownerHeaders = { "x-telegram-init-data": initDataFor(42), "content-type": "application/json" };
let agent;

try {
  const start = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  const { data: pairing } = await start.json();
  const deviceId = "price-stats-device";
  const complete = await fetch(`${base}/api/connection/devices/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, deviceId }) });
  const { data: paired } = await complete.json();

  agent = new WebSocket(`ws://127.0.0.1:${port}/agent/socket`);
  await new Promise(resolve => agent.once("open", resolve));
  agent.send(JSON.stringify({ type: "hello", deviceId, token: paired.accessToken }));
  await new Promise(resolve => agent.once("message", resolve)); // hello_ok
  let seenParams;
  agent.on("message", raw => {
    const msg = JSON.parse(String(raw));
    if (msg.type !== "rpc" || msg.method !== "rts_price_stats") return;
    seenParams = msg.params;
    agent.send(JSON.stringify({ type: "rpc_result", id: msg.id, ok: true, result: { stats: { count: 5, min: 90000, max: 500000, avg: 250000, median: 200000 } } }));
  });

  const res = await fetch(`${base}/api/price-stats`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ okpd2: "31.01" }) });
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.deepEqual(data.stats, { count: 5, min: 90000, max: 500000, avg: 250000, median: 200000 });
  assert.equal(seenParams.okpd2, "31.01", "the filter must be forwarded to the local agent");

  console.log("price stats API: ok");
} finally {
  agent?.terminate();
  await new Promise(resolve => server.close(resolve));
}
