import assert from "node:assert/strict";
import { analyzeDeterministic, filterTenders, normalizeTender } from "../dist/domain/procurement.js";
import { parseFilter } from "../dist/interfaces/telegram/filters.js";

const now = new Date("2026-08-25T09:00:00+03:00");
const tender = normalizeTender({
  title: "Запрос № 12345678 — Поставка ноутбуков",
  url: "https://krd-market.rts-tender.ru/zapros/123",
  summary: "Заказчик: Администрация Краснодара\nНачальная цена: 1 250 000,00 руб.\nОкончание подачи: 30.08.2026 12:00\nМесто поставки: Краснодар\nОКПД2: 26.20.11\nДокументы закупки",
}, now);
assert.equal(tender.price, 1_250_000);
assert.equal(tender.customer, "Администрация Краснодара");
assert.equal(tender.daysLeft, 6);
assert.deepEqual(tender.okpd2, ["26.20.11"]);
assert.equal(filterTenders([tender], { includeKeywords:["ноутбук"], excludeKeywords:["ремонт"], minPrice:1_000_000, maxPrice:2_000_000, location:"Краснодар", okpd2:["26.20"], maxDaysLeft:10 }).length, 1);
assert.equal(filterTenders([tender], { excludeKeywords:["ноутбук"] }).length, 0);
assert.ok(analyzeDeterministic(tender).completeness >= 80);
assert.deepEqual(parseFilter("ключи=ноутбук, компьютер; исключить=ремонт; минцена=100000; максцена=2000000; дней=3-20; документы=да; сорт=срок"), {
  includeKeywords:["ноутбук","компьютер"], excludeKeywords:["ремонт"], minPrice:100000, maxPrice:2000000,
  minDaysLeft:3, maxDaysLeft:20, requireDocuments:true, sort:"deadline_asc",
});
console.log("procurement filters: ok");
