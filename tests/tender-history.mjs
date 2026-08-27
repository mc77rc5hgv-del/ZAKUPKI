import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.RTS_HISTORY_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-tender-history-"));

const { recordObservedTenders, priceStatistics } = await import("../dist/infrastructure/rts/tender-history.js");

const tender = (url, price, okpd2, customer) => ({
  title: `Закупка ${url}`, url, summary: "", currency: "RUB",
  price, okpd2, customer, hasDocuments: false, matched: [], warnings: [],
});

assert.equal(await priceStatistics(), undefined, "no data yet — statistics must not fabricate a result");

await recordObservedTenders([
  tender("https://x/1", 100000, ["26.20.11"], "Школа №1"),
  tender("https://x/2", 300000, ["26.20.11"], "Школа №2"),
  tender("https://x/3", 200000, ["26.20.11"], "Школа №3"),
  tender("https://x/4", 900000, ["43.31.10"], "Больница №1"), // different OKPD2 class
  tender("https://x/5", undefined, ["26.20.11"], "Школа №4"), // no price — must be ignored
]);

const all26 = await priceStatistics({ okpd2: "26.20" });
assert.equal(all26.count, 3);
assert.equal(all26.min, 100000);
assert.equal(all26.max, 300000);
assert.equal(all26.median, 200000);
assert.equal(all26.avg, 200000);

const construction = await priceStatistics({ okpd2: "43" });
assert.equal(construction.count, 1);
assert.equal(construction.min, 900000);

assert.equal(await priceStatistics({ okpd2: "99.99" }), undefined, "an unseen OKPD2 class must report no data, not zero");

const byCustomer = await priceStatistics({ customer: "Школа №2" });
assert.equal(byCustomer.count, 1);
assert.equal(byCustomer.min, 300000);

// Re-observing the same URL updates the stored price rather than duplicating it.
await recordObservedTenders([tender("https://x/1", 150000, ["26.20.11"], "Школа №1")]);
const updated = await priceStatistics({ okpd2: "26.20" });
assert.equal(updated.count, 3, "re-observing an existing URL must not grow the sample");
assert.equal(updated.min, 150000);

console.log("tender history: ok");
