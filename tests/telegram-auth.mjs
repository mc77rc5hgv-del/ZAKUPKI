import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { validateTelegramInitData } from "../dist/interfaces/web/telegram-auth.js";

const token="123456:development-token";
const values={auth_date:String(Math.floor(Date.now()/1000)),query_id:"AAE-test",user:JSON.stringify({id:42,first_name:"Test",username:"tester"})};
const check=Object.entries(values).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join("\n");
const secret=createHmac("sha256","WebAppData").update(token).digest();
const hash=createHmac("sha256",secret).update(check).digest("hex");
const initData=new URLSearchParams({...values,hash}).toString();

assert.equal(validateTelegramInitData(initData,token).user.id,42);
assert.throws(()=>validateTelegramInitData(initData.replace("tester","attacker"),token),/подпись/i);
assert.throws(()=>validateTelegramInitData("",token),/отсутствует/i);
console.log("Telegram Mini App authentication: OK");
