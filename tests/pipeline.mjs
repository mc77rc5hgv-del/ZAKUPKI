import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-pipeline-"));

const { loadStore, setPipeline, user } = await import("../dist/infrastructure/persistence/bot-store.js");
await loadStore();

const id = 42;
const url = "https://krd-market.rts-tender.ru/zapros/1";

const first = await setPipeline(id, url, "Поставка ноутбуков", "review", "первичная проверка", "2026-09-01T09:00:00.000Z");
assert.equal(first.note, "первичная проверка");
assert.equal(first.deadlineAt, "2026-09-01T09:00:00.000Z");
assert.equal(first.history.length, 1);
assert.equal(first.history[0].stage, "review");

// changing only the stage (as the Telegram /stage command and the search-form select both do)
// must not wipe the note, deadline or assignee that were already set.
await setPipeline(id, url, "Поставка ноутбуков", "review", undefined, "2026-09-15T00:00:00.000Z", "Иванов");
const afterAssignee = user(id).pipeline[url];
assert.equal(afterAssignee.note, "первичная проверка", "note must survive an update that omits it");
assert.equal(afterAssignee.assignee, "Иванов");
assert.equal(afterAssignee.deadlineAt, "2026-09-15T00:00:00.000Z");
assert.equal(afterAssignee.history.length, 1, "same stage again must not append a new history entry");

const afterStageChange = await setPipeline(id, url, "Поставка ноутбуков", "prepare");
assert.equal(afterStageChange.note, "первичная проверка", "note must still survive a bare stage change");
assert.equal(afterStageChange.assignee, "Иванов", "assignee must still survive a bare stage change");
assert.equal(afterStageChange.deadlineAt, "2026-09-15T00:00:00.000Z", "deadline must still survive a bare stage change");
assert.equal(afterStageChange.history.length, 2);
assert.equal(afterStageChange.history[1].stage, "prepare");

// an explicit empty string clears the note (distinct from omitting it)
const cleared = await setPipeline(id, url, "Поставка ноутбуков", "prepare", "");
assert.equal(cleared.note, "");

// history is capped so it cannot grow without bound
const stages = ["review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision", "review", "decision"];
for (const stage of stages) await setPipeline(id, url, "Поставка ноутбуков", stage);
const capped = user(id).pipeline[url];
assert.ok(capped.history.length <= 20, `history must be capped, got ${capped.history.length}`);

console.log("pipeline history and field preservation: ok");
