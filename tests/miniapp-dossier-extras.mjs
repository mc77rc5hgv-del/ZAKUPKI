import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Source-level pins for the dossier enhancements: similar-tenders lookup,
// one-click customer watch, and the visual price-range bar. A full
// end-to-end pass was run manually against a real headless browser during
// development (fake API routes + Playwright) — this test guards the wiring
// those checks exercised so it can't silently regress.
const source = await fs.readFile("public/miniapp/app.js", "utf8");

// "Similar tenders" must filter out the dossier's own URL and must only ever
// fire on an explicit click — never automatically alongside the dossier fetch.
assert.match(source, /data-dossier-similar="\$\{esc\(url\)\}"/);
assert.match(source, /x\.url!==btn\.dataset\.dossierSimilar/, "the dossier's own URL must be excluded from its 'similar tenders' list");
// Similar tenders must be behind its own click handler, not fetched inside
// showDossier() alongside the dossier/price-stats calls — it costs a real
// RTS page navigation and must be opt-in.
assert.match(source, /closest\("\[data-dossier-similar\]"\)/, "similar tenders must be wired to its own click handler");

// One-click "watch this customer" must use the tender's own recognized customer.
assert.match(source, /data-watch-customer="\$\{esc\(t\.customer\)\}"/);
assert.match(source, /filter:\{customer:btn\.dataset\.watchCustomer\}/);

// Price-range bar must go through the CSSOM helper (see the CSP test), not an
// inline style attribute.
assert.doesNotMatch(source, /priceCompareHtml[\s\S]*?style="width:/, "the price-range bar must not use an inline style attribute — the CSP silently drops it");
assert.match(source, /const pct=range>0\?Math\.max\(0,Math\.min\(100,/, "the price-range bar position must be clamped into [0,100]");

console.log("miniapp dossier extras: ok");
