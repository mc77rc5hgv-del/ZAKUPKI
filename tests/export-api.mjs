import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const BOT_TOKEN = "42:export-api-test-token";
process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
process.env.TELEGRAM_ALLOWED_USERS = "42,43";
process.env.RTS_ACCOUNT_OWNER_ID = "42";
process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-export-api-"));
process.env.MINIAPP_PORT = "0";
process.env.MINIAPP_DEV_BYPASS = "false";

const { startWebServer } = await import("../dist/interfaces/web/server.js");
const { addFavorite } = await import("../dist/infrastructure/persistence/bot-store.js");

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
const headers = (id) => ({ "x-telegram-init-data": initDataFor(id), "content-type": "application/json" });

try {
  // 1. Search export: rows come entirely from the client, so only a known-safe
  //    allowlist of fields must survive — including a formula-injection attempt
  //    and a field that isn't in the allowlist at all.
  const searchRows = [
    { title: "Поставка мебели", url: "https://krd-market.rts-tender.ru/zapros/1", price: 125000, okpd2: ["31.01.11"], customer: "=cmd|calc", secret: "must not appear in the CSV" },
  ];
  const exportRes = await fetch(`${base}/api/export`, { method: "POST", headers: headers(42), body: JSON.stringify({ kind: "search", rows: searchRows }) });
  assert.equal(exportRes.status, 200);
  const { data: exported } = await exportRes.json();
  assert.ok(exported.token, "export must return a download token");

  const download = await fetch(`${base}/api/export/download?token=${exported.token}`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-type"), /text\/csv/);
  assert.match(download.headers.get("content-disposition"), /attachment; filename="zakupki-search-\d{4}-\d{2}-\d{2}\.csv"/);
  const csv = await download.text();
  assert.ok(csv.includes("Поставка мебели"));
  assert.ok(csv.includes("'=cmd|calc"), "formula-injection guard must survive the full round trip");
  assert.ok(!csv.includes("must not appear"), "fields outside the export allowlist must never reach the CSV");

  // download token is single-use
  const second = await fetch(`${base}/api/export/download?token=${exported.token}`);
  assert.equal(second.status, 404);

  // a garbage token is rejected, not a server error
  const garbage = await fetch(`${base}/api/export/download?token=not-a-real-token`);
  assert.equal(garbage.status, 404);

  // 2. Favorites export: pulled from the authoritative server-side store, not the client.
  await addFavorite(42, "https://krd-market.rts-tender.ru/zapros/2", "Ремонт кровли");
  const favExport = await fetch(`${base}/api/export`, { method: "POST", headers: headers(42), body: JSON.stringify({ kind: "favorites" }) });
  const { data: favToken } = await favExport.json();
  const favCsv = await (await fetch(`${base}/api/export/download?token=${favToken.token}`)).text();
  assert.ok(favCsv.includes("Ремонт кровли"));

  // 3. A second Telegram user cannot see the first user's favorites through export.
  const otherExport = await fetch(`${base}/api/export`, { method: "POST", headers: headers(43), body: JSON.stringify({ kind: "favorites" }) });
  const { data: otherToken } = await otherExport.json();
  const otherCsv = await (await fetch(`${base}/api/export/download?token=${otherToken.token}`)).text();
  assert.ok(!otherCsv.includes("Ремонт кровли"), "export must never cross Telegram accounts");

  // 4. Unknown export kind is rejected.
  const bad = await fetch(`${base}/api/export`, { method: "POST", headers: headers(42), body: JSON.stringify({ kind: "not-a-real-kind" }) });
  assert.equal(bad.status, 400);

  console.log("export API: ok");
} finally {
  await new Promise(resolve => server.close(resolve));
}
