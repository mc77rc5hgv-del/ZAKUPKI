import assert from "node:assert/strict";
import { publicError } from "../dist/interfaces/web/server.js";

assert.equal(publicError(new Error("C:\\Users\\operator\\.rts-profile browser failed at https://private")), "Операция не выполнена. Проверьте подключение к РТС и повторите попытку.");
assert.equal(publicError(new Error("RTS_TIMEOUT")), "РТС не ответил вовремя. Повторите попытку.");
assert.equal(publicError(new Error("AGENT_OFFLINE")), "Подключённый компьютер не в сети. Запустите локальный агент и повторите попытку.");
console.log("web error safety: ok");
