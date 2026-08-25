import assert from "node:assert/strict";
import { classifyCapabilities } from "../dist/domain/portal-capabilities.js";
const result=classifyCapabilities([
  {id:"c1",kind:"link",label:"Мои заявки",selector:"#apps",href:"/applications"},
  {id:"c2",kind:"link",label:"Договоры и контракты",selector:"#contracts",href:"/contracts"},
  {id:"c3",kind:"button",label:"Подать ценовое предложение",selector:"#offer"},
  {id:"c4",kind:"link",label:"Документы закупки",selector:"#docs"},
],"Личный кабинет участника");
assert.ok(result.some(x=>x.kind==="applications"));
assert.ok(result.some(x=>x.kind==="contracts"));
assert.ok(result.some(x=>x.kind==="offer"));
assert.ok(result.some(x=>x.kind==="documents"));
console.log("portal capabilities: ok");
