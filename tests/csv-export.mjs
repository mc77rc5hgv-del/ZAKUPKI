import assert from "node:assert/strict";
import { toCsv } from "../dist/domain/csv-export.js";

const rows = [
  { title: "Поставка мебели", url: "https://x/1", price: 125000 },
  { title: '=cmd|"/c calc"', url: "https://x/2", price: 90000 },
  { title: "Комментарий, с запятой и \"кавычками\"\nи переносом", url: "https://x/3", price: 5000 },
];
const csv = toCsv(rows, [
  { header: "Название", value: r => r.title },
  { header: "Ссылка", value: r => r.url },
  { header: "Цена", value: r => r.price },
]);

assert.equal(csv.charCodeAt(0), 0xFEFF, "must start with a UTF-8 BOM so Excel reads Cyrillic correctly");
const withoutBom = csv.slice(1);
// A quoted cell may itself contain a bare "\n" (RFC 4180), so split only on
// the CRLF record separator, not on every line feed.
const records = withoutBom.split("\r\n").filter(Boolean);
assert.equal(records[0], "Название,Ссылка,Цена");
assert.equal(records[1], "Поставка мебели,https://x/1,125000");

// A title starting with "=" must never reach Excel as a live formula: the
// leading "'" forces Excel to read it as text. The cell also contains a
// quote character, so RFC 4180 quoting wraps the whole thing — the guarded
// apostrophe lands right after the opening quote.
assert.ok(records[2].startsWith('"\'='), `formula-injection guard did not fire: ${records[2]}`);

// Commas, quotes and newlines must be quoted/escaped per RFC 4180.
assert.equal(records[3], '"Комментарий, с запятой и ""кавычками""\nи переносом",https://x/3,5000');

assert.equal(withoutBom.endsWith("\r\n"), true);
console.log("csv export: ok");
