import assert from "node:assert/strict";
import { assessRtsSession } from "../dist/domain/session-detection.js";

assert.equal(assessRtsSession({ body:"Продавец/покупатель (коммерческий) Мои поиски Уведомления Избранное Корзина" }).likelyLoggedIn,true);
assert.equal(assessRtsSession({ body:"Каталог закупок",controls:"Войти Зарегистрироваться",hasPassword:false }).likelyLoggedIn,false);
assert.equal(assessRtsSession({ body:"Авторизация",controls:"Войти",hasPassword:true }).likelyLoggedIn,false);
assert.equal(assessRtsSession({ body:"Мои заявки",controls:"Выйти" }).likelyLoggedIn,true);
console.log("RTS session detection: ok");
