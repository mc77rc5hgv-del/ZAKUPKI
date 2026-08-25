import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BOT_TOKEN = "42:connection-api-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-connection-api-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";
process.env.RTS_HEADLESS = "true";
process.env.RTS_ALLOW_CLOUD_ACCOUNT_SESSION = "false";

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

try {
  // unauthenticated request is rejected, not routed
  const noAuth = await fetch(`${base}/api/connection`);
  assert.equal(noAuth.status, 401);
  const noAuthBody = await noAuth.json();
  assert.equal(noAuthBody.ok, false);

  // authenticated owner request succeeds with a safe, minimal shape
  const authed = await fetch(`${base}/api/connection`, { headers: { "x-telegram-init-data": initDataFor(42) } });
  assert.equal(authed.status, 200);
  const body = await authed.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.accountOwner, true);
  assert.equal(body.data.ownerConfigured, true);
  assert.equal(body.data.acceptsCredentials, false);
  assert.equal(body.data.agentOnline, false);
  const serialized = JSON.stringify(body);
  for (const forbidden of ["stack", "profileDir", "cookie", ".rts-profile", "Authorization"]) {
    assert.ok(!serialized.includes(forbidden), `response must not leak "${forbidden}"`);
  }

  // security headers present on every API response
  assert.equal(authed.headers.get("cache-control"), "no-store");
  assert.equal(authed.headers.get("x-content-type-options"), "nosniff");
  assert.ok(authed.headers.get("content-security-policy"));

  // unknown route -> 404, not a stack trace
  const missing = await fetch(`${base}/api/does-not-exist`, { headers: { "x-telegram-init-data": initDataFor(42) } });
  assert.equal(missing.status, 404);

  // health check stays public and unauthenticated
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, service: "zakupki-miniapp" });

  console.log("connection API: ok");
} finally {
  await new Promise(resolve => server.close(resolve));
}
