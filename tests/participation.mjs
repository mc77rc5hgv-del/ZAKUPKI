import assert from "node:assert/strict";
import { assessReadiness, buildWorkplan, calculateBidEconomics } from "../dist/domain/participation.js";
const tender={title:"Поставка",url:"https://krd-market.rts-tender.ru/zapros/42",summary:"",currency:"RUB",okpd2:[],hasDocuments:true,matched:[],warnings:[],price:1_000_000,customer:"Заказчик",location:"Краснодар",deadlineAt:"2026-09-01T09:00:00.000Z",daysLeft:7};
const dossier={url:tender.url,title:tender.title,capturedAt:"2026-08-25T00:00:00Z",text:"Условия оплаты: в течение 7 дней. Обеспечение исполнения контракта 5%",tender,analysis:{},documents:[{name:"ТЗ",url:"https://krd-market.rts-tender.ru/file"}],tables:[],capabilities:[],fingerprint:"abc"};
const readiness=assessReadiness(dossier);assert.ok(readiness.score>50);assert.ok(readiness.items.some(x=>x.id==="security"&&x.status==="check"));
const economics=calculateBidEconomics({startingPrice:1_000_000,directCosts:600_000,logistics:50_000,taxPercent:6,contingencyPercent:5,targetProfitPercent:10});
assert.equal(economics.viable,true);assert.ok(economics.targetBidPrice<1_000_000);assert.ok(economics.maxDiscountPercent>0);
const workplan=buildWorkplan(dossier,new Date("2026-08-25T09:00:00Z"));assert.equal(workplan.tasks.length,7);assert.equal(workplan.hasDeadline,true);
console.log("participation workflow: ok");
