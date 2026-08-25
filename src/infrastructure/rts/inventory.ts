import type { Page } from "playwright";
import { classifyCapabilities, type PortalControl } from "../../domain/portal-capabilities.js";

export async function inspectPortal(page:Page){
  const data=await page.locator("body").evaluate(body=>{
    const css=(el:Element)=>{if(el.id)return `#${CSS.escape(el.id)}`;const test=el.getAttribute("data-testid");if(test)return `[data-testid="${CSS.escape(test)}"]`;const name=el.getAttribute("name");if(name)return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;const parts=[];let current:Element|null=el;while(current&&current!==body&&parts.length<5){const tag=current.tagName.toLowerCase();const siblings=current.parentElement?[...current.parentElement.children].filter(x=>x.tagName===current!.tagName):[];parts.unshift(`${tag}:nth-of-type(${Math.max(1,siblings.indexOf(current)+1)})`);current=current.parentElement;}return parts.join(">");};
    const visible=(el:Element)=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&r.width>0&&r.height>0;};
    const elements=[...body.querySelectorAll("a,button,input,select,textarea")].filter(visible).slice(0,1000);
    const controls=elements.map((el,index)=>{const input=el as HTMLInputElement;const id=`c${index+1}`;el.setAttribute("data-rts-mcp-id",id);const label=(el.getAttribute("aria-label")||el.getAttribute("title")||el.getAttribute("placeholder")||document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent||el.textContent||input.value||el.getAttribute("name")||"").trim().replace(/\s+/g," ").slice(0,300);return {id,kind:el instanceof HTMLAnchorElement?"link":el instanceof HTMLButtonElement?"button":el instanceof HTMLSelectElement?"select":el instanceof HTMLTextAreaElement?"textarea":input.type==="file"?"file":"input",label,selector:`[data-rts-mcp-id="${id}"]`,href:el instanceof HTMLAnchorElement?el.href:undefined,name:el.getAttribute("name")||undefined,inputType:input.type||undefined,options:el instanceof HTMLSelectElement?[...el.options].slice(0,200).map(o=>({label:o.text,value:o.value})):undefined};});
    const tables=[...body.querySelectorAll("table")].filter(visible).slice(0,50).map((table,index)=>({index,headers:[...table.querySelectorAll("thead th")].map(x=>(x.textContent||"").trim()),rows:[...table.querySelectorAll("tbody tr")].slice(0,200).map(tr=>[...tr.querySelectorAll("th,td")].map(x=>(x.textContent||"").trim().replace(/\s+/g," ")))}));
    const forms=[...body.querySelectorAll("form")].filter(visible).slice(0,50).map((form,index)=>({index,action:(form as HTMLFormElement).action,method:(form as HTMLFormElement).method,controls:[...form.querySelectorAll("[data-rts-mcp-id]")].map(x=>x.getAttribute("data-rts-mcp-id"))}));
    return {text:(body as HTMLElement).innerText.slice(0,100000),controls,tables,forms};
  });
  const controls=data.controls as PortalControl[];
  return {...data,controls,capabilities:classifyCapabilities(controls,data.text),url:page.url(),title:await page.title()};
}

export async function applySemanticFilters(page:Page,values:Record<string,string|number|boolean|undefined>){
  const inventory=await inspectPortal(page);const applied:Array<{field:string;control:string;value:unknown}>=[];const missing:string[]=[];
  const patterns:Record<string,RegExp>={query:/поиск|ключев|наименован|предмет/i,number:/номер|реестров/i,customer:/заказчик|организатор/i,minPrice:/цена.*от|минимальн/i,maxPrice:/цена.*до|максимальн/i,status:/статус|состояние/i,dateFrom:/дата.*от|начало/i,dateTo:/дата.*до|окончание/i,okpd2:/окпд/i,location:/место|регион/i};
  for(const [field,value] of Object.entries(values)){
    if(value===undefined||value==="")continue;const pattern=patterns[field]??new RegExp(field,"i");const control=inventory.controls.find(c=>pattern.test(`${c.label} ${c.name??""}`)&&["input","select","textarea"].includes(c.kind));
    if(!control){missing.push(field);continue;}const locator=page.locator(control.selector);
    if(control.kind==="select")await locator.selectOption(String(value));else if(control.inputType==="checkbox")await locator.setChecked(Boolean(value));else await locator.fill(String(value));applied.push({field,control:control.id,value});
  }
  return {applied,missing,inventory};
}
