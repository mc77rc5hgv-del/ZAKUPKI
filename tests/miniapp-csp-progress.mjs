import assert from "node:assert/strict";
import fs from "node:fs/promises";

// The Mini App's CSP is "style-src 'self'" (no 'unsafe-inline'), so an inline
// style="..." attribute is silently dropped by the browser — a progress bar
// built with style="width:${x}%" never actually gets its width. Verified live
// with Playwright against the real CSP headers during development; this test
// pins the source-level contract so it can't regress silently.
const source = await fs.readFile("public/miniapp/app.js", "utf8");
assert.doesNotMatch(source, /style="width:\$\{/, "a dynamic width must never be set via an inline style attribute — the CSP (style-src 'self') silently drops it");
assert.match(source, /function applyProgressWidths\(node\)\{node\.querySelectorAll\("\[data-pct\]"\)\.forEach/, "progress bars must get their width through the CSSOM (element.style.width=...), which the CSP does not gate");
assert.match(source, /function showOutput\(id,html\)\{const node=document\.querySelector\(`#\$\{id\}`\);if\(node\)\{node\.innerHTML=html;applyProgressWidths\(node\)\}/, "showOutput must apply progress widths after every render, not just the first one");
console.log("miniapp CSP progress-bar guard: ok");
