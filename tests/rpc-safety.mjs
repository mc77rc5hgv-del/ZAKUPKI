import assert from "node:assert/strict";
import { safeRpcError, sanitizeRpcResult } from "../dist/application/rpc-safety.js";
import { isAllowedRpcMethod } from "../dist/application/rpc-allowlist.js";

const sanitized = sanitizeRpcResult({
  path: "C:\\Users\\operator\\secret\\document.pdf",
  documents: [{ name: "contract.pdf", path: "/home/operator/private/contract.pdf" }],
  nested: { profileDir: "/private/profile", stack: "secret stack", value: 1 },
});
assert.deepEqual(sanitized, {
  savedLocally: true,
  documents: [{ name: "contract.pdf", savedLocally: true }],
  nested: { value: 1 },
});
assert.deepEqual(safeRpcError(new Error("/home/operator/.rts-profile failed at https://secret")), {
  code: "RPC_FAILED", message: "Локальный агент не смог выполнить операцию.",
});
assert.deepEqual(safeRpcError({ code: "RTS_TIMEOUT", message: "private path" }), {
  code: "RTS_TIMEOUT", message: "РТС не ответил вовремя. Повторите попытку.",
});
assert.equal(isAllowedRpcMethod("rts_forget_profile"), false, "profile deletion must never be relayed through Railway");
console.log("rpc safety: ok");
