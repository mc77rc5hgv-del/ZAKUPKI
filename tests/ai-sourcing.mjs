import assert from "node:assert/strict";
import fs from "node:fs";
import { isAllowedSupplierUrl, normalizeSourcingReport, sourcingReportCsv, sourcingReportSchema } from "../dist/domain/ai-agent.js";
import { docxXmlToText, extractDocxText } from "../dist/infrastructure/documents/docx.js";

assert.equal(isAllowedSupplierUrl("https://www.ozon.ru/product/123"),true);
assert.equal(isAllowedSupplierUrl("http://ozon.ru/product/123"),false);
assert.equal(isAllowedSupplierUrl("https://ozon.ru.attacker.example/product/123"),false);
assert.equal(isAllowedSupplierUrl("javascript:alert(1)"),false);

const report=sourcingReportSchema.parse({
  summary:"Проверка",tenderTitle:null,customer:null,deliveryRegion:"Краснодар",deadline:null,budgetRub:null,
  lineItems:[{name:"Ноутбук",quantity:2,unit:"шт",requirements:[{name:"ОЗУ",requiredValue:"16 ГБ",unit:"ГБ",critical:true,acceptableDeviation:null,evidence:"ТЗ"}]}],
  candidates:[
    {lineItemName:"Ноутбук",title:"Допустимый",seller:"Ozon",marketplace:"Ozon",url:"https://ozon.ru/product/123",priceRub:50000,deliveryRub:500,totalUnitCostRub:1,availability:"уточнить",matchType:"exact",matchScore:99.7,confirmedRequirements:["ОЗУ"],deviations:[],sellerRisks:[],checkedAt:"2026-08-28"},
    {lineItemName:"Ноутбук",title:"Подмена",seller:"X",marketplace:"X",url:"https://evil.example/product",priceRub:1,deliveryRub:0,totalUnitCostRub:1,availability:"есть",matchType:"exact",matchScore:100,confirmedRequirements:[],deviations:[],sellerRisks:[],checkedAt:"2026-08-28"},
  ],
  risks:[],suspiciousConstraints:[],goNoGo:"CONDITIONAL",goNoGoReasons:["Нужна проверка"],questionsToCustomer:[],deliveryEstimateNote:"Предварительно",disclaimer:"Проверить вручную",
});
const normalized=normalizeSourcingReport(report);
assert.equal(normalized.candidates.length,1);
assert.equal(normalized.candidates[0].totalUnitCostRub,50500);
assert.equal(normalized.candidates[0].matchScore,100);
const csv=sourcingReportCsv(normalized);
assert.match(csv,/Ноутбук/);assert.match(csv,/50500/);assert.doesNotMatch(csv,/evil\.example/);

const xml='<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Товар &amp; услуга</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>16 ГБ</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>';
assert.equal(docxXmlToText(xml),"Товар & услуга\n16 ГБ");
await assert.rejects(()=>extractDocxText(Buffer.from("not a zip")));

const miniapp=fs.readFileSync(new URL("../public/miniapp/app.js",import.meta.url),"utf8");
const webServer=fs.readFileSync(new URL("../src/interfaces/web/server.ts",import.meta.url),"utf8");
assert.match(miniapp,/id="ai-agent-form"/);assert.match(miniapp,/aria-live="polite"/);assert.match(miniapp,/data-ai-export/);
assert.match(webServer,/POST \/api\/ai-agent/);assert.match(webServer,/AI_RATE_LIMITED/);assert.doesNotMatch(miniapp,/OPENAI_API_KEY/);

console.log("ai sourcing tests passed");
