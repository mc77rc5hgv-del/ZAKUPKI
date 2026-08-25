import type { Page } from "playwright";
import { validateOfferDraft,type OfferDraft } from "../../domain/offer-draft.js";
import { inspectPortal } from "./inventory.js";

export async function prepareOfferDraft(page:Page,draft:OfferDraft,execute=false){
  const validation=validateOfferDraft(draft);if(!validation.valid)return {...validation,plan:[],executed:false};
  const inventory=await inspectPortal(page);const definitions:Array<[keyof OfferDraft,RegExp]>=[["price",/цена|стоимость|предложение.*руб|сумма/i],["quantity",/количество|объем/i],["deliveryDays",/срок.*постав|дней.*постав/i],["validityDays",/срок.*действ|действует/i],["comment",/комментар|примечан/i]];
  const plan=definitions.flatMap(([field,pattern])=>{const value=draft[field];if(value===undefined)return[];const control=inventory.controls.find(x=>["input","textarea"].includes(x.kind)&&pattern.test(`${x.label} ${x.name??""}`));return control?[{field,controlId:control.id,selector:control.selector,value}]:[];});
  const missing=definitions.filter(([field])=>draft[field]!==undefined&&!plan.some(x=>x.field===field)).map(x=>x[0]);
  if(execute)for(const item of plan)await page.locator(item.selector).fill(String(item.value));
  return {...validation,plan,missing,executed:execute,note:"Черновик заполнен без нажатия кнопок отправки, подписания или публикации."};
}
