import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const BOT_TOKEN = "42:tracked-changes-api-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-tracked-changes-api-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";
process.env.RTS_TRANSPORT = "hub";

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
const ownerHeaders = { "x-telegram-init-data": initDataFor(42), "content-type": "application/json" };
let agent;

try {
  const start = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  const { data: pairing } = await start.json();
  const deviceId = "tracked-changes-device";
  const complete = await fetch(`${base}/api/connection/devices/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairing.code, deviceId }) });
  const { data: paired } = await complete.json();

  agent = new WebSocket(`ws://127.0.0.1:${port}/agent/socket`);
  await new Promise(resolve => agent.once("open", resolve));
  agent.send(JSON.stringify({ type: "hello", deviceId, token: paired.accessToken }));
  await new Promise(resolve => agent.once("message", resolve)); // hello_ok
  agent.on("message", raw => {
    const msg = JSON.parse(String(raw));
    if (msg.type !== "rpc" || msg.method !== "rts_track_request") return;
    agent.send(JSON.stringify({
      type: "rpc_result", id: msg.id, ok: true,
      result: { dossier: { title: "Ремонт фасада" }, tracking: { firstCapture: false, comparison: { changed: true, changes: [{ field: "deadlineAt", before: "2026-09-01", after: "2026-09-10", severity: "critical" }] } } },
    }));
  });

  const url = "https://krd-market.rts-tender.ru/zapros/5";
  const track = await fetch(`${base}/api/track`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ url }) });
  assert.equal(track.status, 200);

  const state1 = await (await fetch(`${base}/api/state`, { headers: ownerHeaders })).json();
  assert.ok(state1.data.trackedChanges[url], "a detected change must be persisted for the overview to show");
  assert.equal(state1.data.trackedChanges[url].title, "Ремонт фасада");
  assert.equal(state1.data.trackedChanges[url].changes[0].field, "deadlineAt");

  const dismiss = await fetch(`${base}/api/tracked-changes/dismiss`, { method: "POST", headers: ownerHeaders, body: JSON.stringify({ url }) });
  assert.equal(dismiss.status, 200);
  const state2 = await (await fetch(`${base}/api/state`, { headers: ownerHeaders })).json();
  assert.equal(state2.data.trackedChanges[url], undefined, "dismissing must remove it from the list");

  console.log("tracked-changes API: ok");
} finally {
  agent?.terminate();
  await new Promise(resolve => server.close(resolve));
}
