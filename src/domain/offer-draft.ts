export type OfferDraft={price:number;quantity?:number;deliveryDays?:number;validityDays?:number;comment?:string};
export function validateOfferDraft(draft:OfferDraft){
  const errors:string[]=[];const warnings:string[]=[];
  if(!Number.isFinite(draft.price)||draft.price<=0)errors.push("Цена должна быть положительным числом");
  if(draft.quantity!==undefined&&draft.quantity<=0)errors.push("Количество должно быть больше нуля");
  if(draft.deliveryDays!==undefined&&draft.deliveryDays<0)errors.push("Срок поставки не может быть отрицательным");
  if(draft.validityDays!==undefined&&draft.validityDays<1)errors.push("Срок действия предложения должен быть не меньше одного дня");
  if(draft.comment&&draft.comment.length>2000)warnings.push("Комментарий длиннее 2000 символов и может не поместиться в форму");
  return {valid:errors.length===0,errors,warnings,draft};
}
