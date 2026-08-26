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
const districtTender = normalizeTender({ title:"Ремонт школы", url:"https://krd-market.rts-tender.ru/zapros/124", summary:"Место поставки: Каневской район, станица Каневская" }, now);
assert.equal(filterTenders([districtTender], { districts:["Каневской район"] }).length, 1);
assert.equal(filterTenders([districtTender], { districts:["Динской район"] }).length, 0);
assert.equal(filterTenders([districtTender], { districts:["Динской район","Каневской район"] }).length, 1, "several districts use OR matching");
const liveCard = normalizeTender({
  title:"Поставка хозяйственных товаров",
  url:"https://krd-market.rts-tender.ru/search/sell/10614131/request",
  summary:"ЗАКАЗ 10614131\nП. 5 Ч. 1 СТ. 93 44-ФЗ\nРЕГИОНЫ ПОСТАВКИ: Краснодарский край\nПОКУПАТЕЛЬ: МБУ ДО СШ № 19 г. Сочи\nНЕТ ПРЕДЛОЖЕНИЙ\n39 216,56 ₽\nПрием предложений\nдо 27 августа, 23:59 МСК",
}, now);
assert.equal(liveCard.number, "10614131");
assert.equal(liveCard.customer, "МБУ ДО СШ № 19 г. Сочи");
assert.equal(liveCard.location, "Краснодарский край");
assert.equal(liveCard.price, 39_216.56);
assert.equal(liveCard.deadlineAt, "2026-08-27T20:59:00.000Z");
assert.equal(liveCard.status, "Прием предложений");
assert.equal(filterTenders([liveCard], { query:"хозяйственных", location:"Краснодарский край", status:"прием предложений", maxDaysLeft:3 }).length, 1);
assert.ok(analyzeDeterministic(tender).completeness >= 80);
assert.deepEqual(parseFilter("ключи=ноутбук, компьютер; исключить=ремонт; минцена=100000; максцена=2000000; дней=3-20; документы=да; сорт=срок"), {
  includeKeywords:["ноутбук","компьютер"], excludeKeywords:["ремонт"], minPrice:100000, maxPrice:2000000,
  minDaysLeft:3, maxDaysLeft:20, requireDocuments:true, sort:"deadline_asc",
});
assert.deepEqual(parseFilter("район=Каневской район, Динской район"), { districts:["Каневской район","Динской район"] });
console.log("procurement filters: ok");
