import assert from "node:assert/strict";
import { newTenderLine } from "../dist/interfaces/telegram/monitor.js";

const line = newTenderLine({
  title: 'Поставка <оборудования>',
  url: "https://krd-market.rts-tender.ru/zapros/777?x=1&y=2",
  location: "Каневской район",
  price: 1250000,
  deadlineAt: "2026-09-01T09:00:00.000Z",
});
assert.match(line, /Каневской район/);
assert.match(line, /1[\s\u00a0]?250[\s\u00a0]?000 ₽/);
assert.match(line, /href="https:\/\/krd-market\.rts-tender\.ru\/zapros\/777\?x=1&amp;y=2"/);
assert.doesNotMatch(line, /<оборудования>/);
assert.match(newTenderLine({ title:"Тендер", url:"https://krd-market.rts-tender.ru/zapros/1" }, ["Динской район"]), /Фильтр: Динской район/);
console.log("territorial monitor notification: ok");
