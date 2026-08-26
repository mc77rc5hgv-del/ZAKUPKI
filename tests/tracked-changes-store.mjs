import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-tracked-changes-store-"));
const { loadStore, recordTrackedChange, dismissTrackedChange, user } = await import("../dist/infrastructure/persistence/bot-store.js");
await loadStore();

const id = 7;
const url = "https://krd-market.rts-tender.ru/zapros/9";
await recordTrackedChange(id, url, "Поставка мебели", [{ field: "price", before: 100, after: 90, severity: "critical" }]);
assert.ok(user(id).trackedChanges[url]);
assert.equal(user(id).trackedChanges[url].changes[0].field, "price");

await dismissTrackedChange(id, url);
assert.equal(user(id).trackedChanges[url], undefined);

console.log("tracked-changes store: ok");
