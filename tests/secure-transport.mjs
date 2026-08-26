import assert from "node:assert/strict";
import { assertSecureHubHttpUrl, toAgentWebSocketUrl } from "../dist/infrastructure/security/transport-url.js";

assert.equal(toAgentWebSocketUrl("https://example.test/base?token=bad"), "wss://example.test/agent/socket");
assert.equal(toAgentWebSocketUrl("http://127.0.0.1:3000"), "ws://127.0.0.1:3000/agent/socket");
assert.equal(toAgentWebSocketUrl("http://localhost:3000"), "ws://localhost:3000/agent/socket");
assert.throws(() => assertSecureHubHttpUrl("http://example.test"), /HTTPS/);
assert.throws(() => assertSecureHubHttpUrl("ftp://example.test"), /HTTPS/);
assert.throws(() => assertSecureHubHttpUrl("https://user:secret@example.test"), /логин|пароль/);
console.log("secure transport: ok");
