import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";

const BOT_TOKEN = "42:rpc-auth-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-rpc-auth-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";
process.env.RTS_TRANSPORT = "hub";

const { isAllowedRpcMethod } = await import("../dist/application/rpc-allowlist.js");
const { startWebServer } = await import("../dist/interfaces/web/server.js");
const { call } = await import("../dist/application/mcp-client.js");

// pure allowlist checks — the remote gateway must never accept an arbitrary command
assert.equal(isAllowedRpcMethod("rts_search_advanced"), true);
assert.equal(isAllowedRpcMethod("rts_build_dossier"), true);
assert.equal(isAllowedRpcMethod("rts_act"), false, "unrestricted selector-based UI actions must stay local-only");
assert.equal(isAllowedRpcMethod("rts_download"), false, "raw arbitrary-URL download must stay local-only");
assert.equal(isAllowedRpcMethod("shell.execute"), false);
assert.equal(isAllowedRpcMethod("browser.evalArbitrary"), false);
assert.equal(isAllowedRpcMethod("filesystem.read"), false);

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
    ws.once("close", code => reject(new Error(`socket closed before a message arrived (code ${code})`)));
  });
}

const server = await startWebServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const wsUrl = `ws://127.0.0.1:${port}/agent/socket`;
const ownerHeaders = { "x-telegram-init-data": initDataFor(42) };
let badToken, unknownDevice, agent;

try {
  const start = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  const { data: pairing } = await start.json();
  const deviceId = "rpc-auth-device";
  const complete = await fetch(`${base}/api/connection/devices/pair`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: pairing.code, deviceId }),
  });
  const { data: paired } = await complete.json();

  // wrong token is refused
  badToken = new WebSocket(wsUrl);
  await new Promise(resolve => badToken.once("open", resolve));
  badToken.send(JSON.stringify({ type: "hello", deviceId, token: "not-the-real-token" }));
  const badTokenReply = await nextMessage(badToken);
  assert.equal(badTokenReply.type, "hello_error");
  assert.equal(badTokenReply.code, "TOKEN_INVALID");

  // unknown device id is refused
  unknownDevice = new WebSocket(wsUrl);
  await new Promise(resolve => unknownDevice.once("open", resolve));
  unknownDevice.send(JSON.stringify({ type: "hello", deviceId: "never-registered", token: "whatever" }));
  const unknownReply = await nextMessage(unknownDevice);
  assert.equal(unknownReply.type, "hello_error");
  assert.equal(unknownReply.code, "DEVICE_UNKNOWN");

  // legitimate agent connects and answers RPCs
  agent = new WebSocket(wsUrl);
  await new Promise(resolve => agent.once("open", resolve));
  agent.send(JSON.stringify({ type: "hello", deviceId, token: paired.accessToken }));
  const helloReply = await nextMessage(agent);
  assert.equal(helloReply.type, "hello_ok");

  let messagesReceived = 0;
  agent.on("message", raw => {
    messagesReceived += 1;
    const msg = JSON.parse(String(raw));
    if (msg.type === "rpc") agent.send(JSON.stringify({ type: "rpc_result", id: msg.id, ok: true, result: { echoedMethod: msg.method } }));
  });

  // an allowed method reaches the agent and its result flows back through call()
  const allowedResult = await call("rts_session_status", {});
  assert.equal(allowedResult.echoedMethod, "rts_session_status");
  assert.equal(messagesReceived, 1);

  // a disallowed method must be rejected by the hub itself — the agent never even sees it
  await assert.rejects(() => call("rts_act", { action: "click", selector: "#x" }), /RPC_METHOD_NOT_ALLOWED/);
  assert.equal(messagesReceived, 1, "the agent must not receive a disallowed method");

  console.log("rpc auth: ok");
} finally {
  for (const socket of [badToken, unknownDevice, agent]) socket?.terminate();
  await new Promise(resolve => server.close(resolve));
}
