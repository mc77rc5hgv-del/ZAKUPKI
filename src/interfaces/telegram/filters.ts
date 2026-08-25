import type { TenderFilter } from "../../domain/procurement.js";

const list = (v: string) => v.split(/[,|]/).map(x=>x.trim()).filter(Boolean);
const number = (v:string) => { const n=Number(v.replace(/[\s_]/g,"")); return Number.isFinite(n)?n:undefined; };
export function parseFilter(input:string): TenderFilter {
  const filter:TenderFilter={};
  const aliases:Record<string,string>={"запрос":"query","q":"query","ключи":"includeKeywords","включить":"includeKeywords","исключить":"excludeKeywords","минцена":"minPrice","максцена":"maxPrice","заказчик":"customer","регион":"location","место":"location","статус":"status","окпд":"okpd2","дней":"days","документы":"requireDocuments","сорт":"sort"};
  for(const segment of input.split(";").map(x=>x.trim()).filter(Boolean)){
    const pos=segment.indexOf("="); if(pos<0){filter.query=segment;continue;}
    const rawKey=segment.slice(0,pos).trim().toLowerCase(); const value=segment.slice(pos+1).trim(); const key=aliases[rawKey]??rawKey;
    if(key==="includeKeywords"||key==="excludeKeywords"||key==="okpd2") (filter as any)[key]=list(value);
    else if(key==="minPrice"||key==="maxPrice") (filter as any)[key]=number(value);
    else if(key==="days"){const [a,b]=value.split("-").map(number);filter.minDaysLeft=a;filter.maxDaysLeft=b??a;}
    else if(key==="requireDocuments") filter.requireDocuments=/^(1|да|true|yes)$/i.test(value);
    else if(key==="sort") filter.sort=({"релевантность":"relevance","цена+":"price_asc","цена-":"price_desc","срок":"deadline_asc","новые":"published_desc"} as any)[value.toLowerCase()]??value as TenderFilter["sort"];
    else (filter as any)[key]=value;
  }
  if(filter.minPrice!==undefined&&filter.maxPrice!==undefined&&filter.minPrice>filter.maxPrice) throw new Error("Минимальная цена больше максимальной");
  return filter;
}
export function describeFilter(f:TenderFilter){return [f.query&&`запрос: ${f.query}`,f.includeKeywords?.length&&`ключи: ${f.includeKeywords.join(", ")}`,f.excludeKeywords?.length&&`исключить: ${f.excludeKeywords.join(", ")}`,f.minPrice!==undefined&&`цена от ${f.minPrice.toLocaleString("ru-RU")} ₽`,f.maxPrice!==undefined&&`цена до ${f.maxPrice.toLocaleString("ru-RU")} ₽`,f.customer&&`заказчик: ${f.customer}`,f.location&&`место: ${f.location}`,f.status&&`статус: ${f.status}`,f.okpd2?.length&&`ОКПД2: ${f.okpd2.join(", ")}`,f.minDaysLeft!==undefined&&`дней от: ${f.minDaysLeft}`,f.maxDaysLeft!==undefined&&`дней до: ${f.maxDaysLeft}`,f.requireDocuments&&"только с документами",f.sort&&`сортировка: ${f.sort}`].filter(Boolean).join("; ")||"без ограничений";}
