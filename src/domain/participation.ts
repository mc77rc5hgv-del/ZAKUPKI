import type { TenderDossier } from "./dossier.js";

export type ReadinessItem={id:string;category:"timing"|"commercial"|"documents"|"qualification"|"contract"|"delivery";title:string;status:"ready"|"check"|"blocked";evidence?:string;action:string;weight:number};
const match=(text:string,re:RegExp)=>text.match(re)?.[0];
export function assessReadiness(dossier:TenderDossier){
  const text=dossier.text.toLowerCase();const days=dossier.tender.daysLeft;
  const items:ReadinessItem[]=[
    {id:"deadline",category:"timing",title:"Срок подачи",status:days===undefined?"check":days<0?"blocked":days<=2?"check":"ready",evidence:dossier.tender.deadlineAt,action:days===undefined?"Уточнить срок подачи":days<0?"Подача невозможна: срок истёк":"Зафиксировать внутренний срок подачи",weight:15},
    {id:"price",category:"commercial",title:"Начальная цена",status:dossier.tender.price===undefined?"check":"ready",evidence:dossier.tender.price?.toString(),action:"Проверить экономику и минимально допустимую цену",weight:12},
    {id:"documents",category:"documents",title:"Документация",status:dossier.documents.length?"ready":"check",evidence:`${dossier.documents.length} файлов`,action:"Скачать и проверить полный комплект документов",weight:15},
    {id:"customer",category:"commercial",title:"Заказчик",status:dossier.tender.customer?"ready":"check",evidence:dossier.tender.customer,action:"Проверить реквизиты и историю заказчика",weight:6},
    {id:"delivery",category:"delivery",title:"Условия поставки",status:dossier.tender.location||match(text,/место поставки|адрес поставки/i)?"ready":"check",evidence:dossier.tender.location,action:"Рассчитать логистику, сроки и приёмку",weight:10},
    {id:"security",category:"commercial",title:"Обеспечение",status:match(text,/обеспечени[ея] (?:заявки|исполнения|контракта)/i)?"check":"ready",evidence:match(text,/обеспечени[ея][^\n]{0,160}/i),action:"Уточнить размер, форму и стоимость обеспечения",weight:10},
    {id:"license",category:"qualification",title:"Лицензии и допуски",status:match(text,/лицензи|сро|допуск/i)?"check":"ready",evidence:match(text,/(?:лицензи|сро|допуск)[^\n]{0,160}/i),action:"Подтвердить наличие требуемых разрешений",weight:9},
    {id:"experience",category:"qualification",title:"Опыт и квалификация",status:match(text,/опыт исполн|аналогичн|квалификац/i)?"check":"ready",evidence:match(text,/(?:опыт исполн|аналогичн|квалификац)[^\n]{0,160}/i),action:"Подготовить подтверждающие договоры и сведения",weight:8},
    {id:"penalties",category:"contract",title:"Штрафы и ответственность",status:match(text,/штраф|пен[яи]|неустойк/i)?"check":"ready",evidence:match(text,/(?:штраф|пен[яи]|неустойк)[^\n]{0,160}/i),action:"Проверить ответственность и односторонний отказ",weight:8},
    {id:"payment",category:"contract",title:"Условия оплаты",status:match(text,/условия оплаты|оплата в течение|аванс/i)?"check":"blocked",evidence:match(text,/(?:условия оплаты|оплата в течение|аванс)[^\n]{0,160}/i),action:"Определить срок оплаты, аванс и потребность в финансировании",weight:7},
  ];
  const score=Math.round(items.reduce((sum,x)=>sum+x.weight*(x.status==="ready"?1:x.status==="check"?.45:0),0)/items.reduce((sum,x)=>sum+x.weight,0)*100);
  const blockers=items.filter(x=>x.status==="blocked");
  return {score,decision:blockers.length?"NO_GO":score>=80?"READY":score>=55?"REVIEW":"NOT_READY",blockers,items,nextActions:items.filter(x=>x.status!=="ready").map(x=>x.action)};
}

export type BidEconomicsInput={startingPrice:number;directCosts:number;logistics?:number;overheads?:number;guaranteeCost?:number;financingCost?:number;otherCosts?:number;taxPercent?:number;contingencyPercent?:number;targetProfitPercent?:number};
export function calculateBidEconomics(input:BidEconomicsInput){
  const values=Object.values(input);if(values.some(x=>x!==undefined&&(!Number.isFinite(x)||x<0)))throw new Error("Все экономические параметры должны быть неотрицательными числами");
  if(input.startingPrice<=0)throw new Error("Начальная цена должна быть больше нуля");
  const fixedCosts=input.directCosts+(input.logistics??0)+(input.overheads??0)+(input.guaranteeCost??0)+(input.financingCost??0)+(input.otherCosts??0);
  const taxRate=(input.taxPercent??0)/100,contingencyRate=(input.contingencyPercent??0)/100,targetRate=(input.targetProfitPercent??0)/100;
  if(taxRate+targetRate>=1)throw new Error("Сумма налоговой ставки и целевой маржи должна быть меньше 100%");
  const contingency=fixedCosts*contingencyRate;const costBase=fixedCosts+contingency;
  const breakEvenPrice=costBase/(1-taxRate);const targetBidPrice=costBase/(1-taxRate-targetRate);
  const profitAtStart=input.startingPrice*(1-taxRate)-costBase;const marginAtStart=profitAtStart/input.startingPrice*100;
  const maxDiscountPercent=Math.max(0,(input.startingPrice-targetBidPrice)/input.startingPrice*100);
  return {input,fixedCosts,contingency,costBase,breakEvenPrice,targetBidPrice,profitAtStart,marginAtStart,maxDiscountPercent,viable:targetBidPrice<=input.startingPrice,warnings:[...(targetBidPrice>input.startingPrice?["Целевая цена выше начальной цены закупки"]:[]),...(marginAtStart<5?["Маржа на начальной цене ниже 5%"]:[])]};
}

export function buildWorkplan(dossier:TenderDossier,now=new Date()){
  const deadline=dossier.tender.deadlineAt?new Date(dossier.tender.deadlineAt):undefined;
  const tasks=[
    {id:"docs",title:"Скачать и разобрать документацию",offsetHours:96,owner:"тендерный специалист"},
    {id:"requirements",title:"Проверить требования и допуски",offsetHours:72,owner:"тендерный специалист"},
    {id:"costing",title:"Рассчитать себестоимость и логистику",offsetHours:60,owner:"коммерческий отдел"},
    {id:"decision",title:"Принять решение об участии",offsetHours:48,owner:"руководитель"},
    {id:"package",title:"Собрать комплект документов",offsetHours:30,owner:"тендерный специалист"},
    {id:"review",title:"Провести контрольную проверку",offsetHours:8,owner:"второй проверяющий"},
    {id:"submit",title:"Подать и подписать предложение",offsetHours:2,owner:"уполномоченный подписант"},
  ].map(task=>{const dueAt=deadline?new Date(deadline.getTime()-task.offsetHours*3_600_000):undefined;return {...task,dueAt:dueAt?.toISOString(),status:dueAt&&dueAt<now?"overdue":"pending"};});
  return {deadlineAt:deadline?.toISOString(),hasDeadline:Boolean(deadline),tasks,warnings:[...(!deadline?["Срок подачи не распознан — даты задач не рассчитаны"]:[]),...(tasks.some(x=>x.status==="overdue")?["Часть рекомендуемых внутренних сроков уже прошла"]:[])]};
}
