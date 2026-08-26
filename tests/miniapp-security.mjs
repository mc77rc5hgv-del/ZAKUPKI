import assert from "node:assert/strict";
import fs from "node:fs/promises";

const source = await fs.readFile("public/miniapp/app.js", "utf8");
assert.doesNotMatch(source, /localStorage/, "search drafts must not persist beyond the Telegram WebView session");
assert.doesNotMatch(source, /currentAbort/, "a single global AbortController breaks overlapping requests");
assert.doesNotMatch(source, /\b[dx]\.path\b/, "Mini App must not display local filesystem paths");
assert.match(source, /activeRequests:new Set\(\)/);
assert.match(source, /for\(const controller of state\.activeRequests\)controller\.abort\(\)/);
console.log("miniapp security and concurrency guards: ok");
