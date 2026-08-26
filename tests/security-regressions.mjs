import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-security-store-"));
process.env.RTS_BASE_URL = "https://krd-market.rts-tender.ru";
const store = await import("../dist/infrastructure/persistence/bot-store.js");
await store.loadStore();
const state = store.user(123);
assert.equal(Object.getPrototypeOf(state.favorites), null);
assert.equal(Object.getPrototypeOf(state.pipeline), null);
await assert.rejects(() => store.addFavorite(123, "__proto__", "bad"));
await assert.rejects(() => store.addFavorite(123, "https://evil.example/steal", "bad"));
await assert.rejects(() => store.setPipeline(123, "https://krd-market.rts-tender.ru/zapros/1", "bad", 'new" onmouseover="alert(1)'));
await assert.rejects(() => store.addProfile(123, "x".repeat(501), {}));

const { assertSafeBrowserAction } = await import("../dist/application/action-policy.js");
assert.throws(() => assertSafeBrowserAction("click", { text: "Подписать и отправить заявку" }), /FINAL_ACTION_FORBIDDEN/);
assert.throws(() => assertSafeBrowserAction("fill", { type: "password", name: "password" }), /SECRET_INPUT_FORBIDDEN/);
assert.throws(() => assertSafeBrowserAction("fill", { type: "file", name: "certificate" }), /SECRET_INPUT_FORBIDDEN/);
assert.throws(() => assertSafeBrowserAction("click", { type: "submit", text: "Продолжить" }), /FINAL_ACTION_FORBIDDEN/);
assert.doesNotThrow(() => assertSafeBrowserAction("click", { text: "Применить фильтр" }));

console.log("security regressions: ok");
