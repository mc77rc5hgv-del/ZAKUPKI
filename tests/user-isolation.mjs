import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BOT_TOKEN = "42:user-isolation-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42,7";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-user-isolation-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";
process.env.RTS_TRANSPORT = "hub"; // no agent ever connects in this test — offline-agent calls must fail fast, not hang

const { startWebServer } = await import("../dist/interfaces/web/server.js");

function initDataFor(userId) {
  const values = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: `User${userId}` }) };
  const check = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...values, hash }).toString();
}

const server = await startWebServer();
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;
const ownerHeaders = { "x-telegram-init-data": initDataFor(42) };
const strangerHeaders = { "x-telegram-init-data": initDataFor(7) };

try {
  // the non-owner is an allowlisted Telegram user, but not the RTS account owner
  for (const [method, url, body] of [
    ["GET", "/api/connection/devices", undefined],
    ["POST", "/api/connection/devices/pair/start", undefined],
    ["POST", "/api/search", {}],
    ["POST", "/api/connection/disconnect", undefined],
  ]) {
    const res = await fetch(`${base}${url}`, {
      method, headers: { ...strangerHeaders, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    assert.equal(res.status, 401, `${method} ${url} must be rejected for a non-owner user`);
    const json = await res.json();
    assert.equal(json.ok, false);
    assert.match(json.error, /принадлежит другому|владелец/i, `${method} ${url} must clearly signal an ownership rejection`);
  }

  // the configured owner passes the ownership gate
  const pairStart = await fetch(`${base}/api/connection/devices/pair/start`, { method: "POST", headers: ownerHeaders });
  assert.equal(pairStart.status, 200);

  // ...and only fails later, for an unrelated, non-sensitive reason (no local agent connected)
  const search = await fetch(`${base}/api/search`, {
    method: "POST", headers: { ...ownerHeaders, "content-type": "application/json" }, body: JSON.stringify({}),
  });
  assert.equal(search.status, 400, "owner request must get past isolation and fail only on agent availability");
  const searchBody = await search.json();
  assert.equal(searchBody.ok, false);
  assert.ok(!/принадлежит|владелец/i.test(searchBody.error), "owner failure must not be reported as an ownership error");
  assert.ok(!/AGENT_OFFLINE|stack|profileDir/i.test(searchBody.error), "internal failure codes and paths must not leak to the client");

  console.log("user isolation: ok");
} finally {
  await new Promise(resolve => server.close(resolve));
}
