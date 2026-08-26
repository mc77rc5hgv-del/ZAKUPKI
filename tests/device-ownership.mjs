import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.BOT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "zakupki-device-owner-"));
const store = await import("../dist/infrastructure/persistence/device-store.js");
const { generateDeviceToken } = await import("../dist/infrastructure/security/pairing.js");
await store.loadDeviceStore();
const deviceId = "shared-device-123";
await store.registerDevice({ deviceId, ownerTelegramId: 42, token: generateDeviceToken() });
await assert.rejects(() => store.registerDevice({ deviceId, ownerTelegramId: 77, token: generateDeviceToken() }), /DEVICE_ID_ALREADY_OWNED/);
assert.equal(store.findDevice(deviceId).ownerTelegramId, 42);
await store.registerDevice({ deviceId, ownerTelegramId: 42, token: generateDeviceToken(), displayName: "Re-paired" });
assert.equal(store.findDevice(deviceId).displayName, "Re-paired");
console.log("device ownership: ok");
