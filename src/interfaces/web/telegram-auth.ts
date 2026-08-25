import { createHmac, timingSafeEqual } from "node:crypto";

export type TelegramWebUser={id:number;first_name:string;last_name?:string;username?:string;language_code?:string;photo_url?:string};
export type TelegramAuth={user:TelegramWebUser;authDate:number;queryId?:string};

export function validateTelegramInitData(initData:string,botToken:string,maxAgeSeconds=86_400):TelegramAuth{
  if(!initData)throw new Error("Telegram initData отсутствует");
  if(!botToken)throw new Error("TELEGRAM_BOT_TOKEN не настроен");
  const params=new URLSearchParams(initData);const received=params.get("hash");
  if(!received||!/^[a-f0-9]{64}$/i.test(received))throw new Error("Некорректная подпись Telegram");
  params.delete("hash");
  const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret=createHmac("sha256","WebAppData").update(botToken).digest();
  const expected=createHmac("sha256",secret).update(check).digest("hex");
  const a=Buffer.from(received,"hex"),b=Buffer.from(expected,"hex");
  if(a.length!==b.length||!timingSafeEqual(a,b))throw new Error("Подпись Telegram не прошла проверку");
  const authDate=Number(params.get("auth_date"));
  if(!Number.isFinite(authDate)||Math.abs(Date.now()/1000-authDate)>maxAgeSeconds)throw new Error("Сессия Telegram устарела");
  const rawUser=params.get("user");if(!rawUser)throw new Error("Telegram не передал пользователя");
  const user=JSON.parse(rawUser) as TelegramWebUser;
  if(!Number.isSafeInteger(user.id))throw new Error("Некорректный Telegram ID");
  return {user,authDate,queryId:params.get("query_id")??undefined};
}
