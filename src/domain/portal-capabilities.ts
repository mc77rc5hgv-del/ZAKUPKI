export type PortalCapabilityKind = "search" | "filters" | "request" | "documents" | "offer" | "applications" | "contracts" | "clarifications" | "protocols" | "organization" | "auth" | "unknown";
export type PortalControl = { id:string; kind:"link"|"button"|"input"|"select"|"textarea"|"file"; label:string; selector:string; href?:string; name?:string; inputType?:string; options?:Array<{label:string;value:string}> };
export type PortalCapability = { kind:PortalCapabilityKind; confidence:number; evidence:string[]; controls:string[] };

const patterns:Record<Exclude<PortalCapabilityKind,"unknown">,RegExp>={
  search:/поиск|найти|номер закупки|ключев/i, filters:/фильтр|параметр|цена|заказчик|окпд|дата/i,
  request:/закупк|запрос|извещен|карточк/i, documents:/документ|файл|вложен|скачать/i,
  offer:/предложен|цену|подать|участв|ставк/i, applications:/мои заявки|заявк|заявлен/i,
  contracts:/договор|контракт/i, clarifications:/разъяснен|вопрос заказчику/i,
  protocols:/протокол|итог|результат/i, organization:/организац|профиль|реквизит/i,
  auth:/войти|выход|личный кабинет|авторизац/i,
};
export function classifyCapabilities(controls:PortalControl[],pageText=""):PortalCapability[]{
  const result:PortalCapability[]=[];
  for(const [kind,pattern] of Object.entries(patterns) as Array<[Exclude<PortalCapabilityKind,"unknown">,RegExp]>) {
    const matches=controls.filter(c=>pattern.test(`${c.label} ${c.href??""} ${c.name??""}`));
    const pageHit=pattern.test(pageText); if(!matches.length&&!pageHit)continue;
    result.push({kind,confidence:Math.min(1,(matches.length*0.18)+(pageHit?0.25:0)),evidence:[...matches.map(x=>x.label),...(pageHit?["page-text"]:[])].slice(0,10),controls:matches.map(x=>x.id)});
  }
  return result.sort((a,b)=>b.confidence-a.confidence);
}
