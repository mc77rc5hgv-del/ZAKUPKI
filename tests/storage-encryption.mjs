import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "zakupki-storage-encryption-"));
const file = path.join(dir, "bot.json");
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");

const { readStoreFile, writeStoreFile } = await import("../dist/infrastructure/security/encrypted-store.js");

const secretMarker = "SUPER-SECRET-TENDER-NOTE-42";
await writeStoreFile(file, { users: { 1: { note: secretMarker } } });

// the file on disk must never contain the plaintext content
const raw = await fs.readFile(file, "utf8");
assert.ok(!raw.includes(secretMarker), "plaintext content must not appear in the encrypted file");
const envelope = JSON.parse(raw);
assert.equal(envelope.__encrypted, true);
assert.equal(envelope.v, 1);
assert.ok(envelope.iv && envelope.tag && envelope.data);

// a fresh IV is used for every write
await writeStoreFile(file, { users: { 1: { note: secretMarker } } });
const secondEnvelope = JSON.parse(await fs.readFile(file, "utf8"));
assert.notEqual(secondEnvelope.iv, envelope.iv);

// the correct key reads it back faithfully
const roundTrip = await readStoreFile(file, { users: {} });
assert.equal(roundTrip.users["1"].note, secretMarker);

// the wrong key fails clearly, without leaking key material or a stack trace
const rightKey = process.env.DATA_ENCRYPTION_KEY;
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
await assert.rejects(
  () => readStoreFile(file, { users: {} }),
  err => {
    assert.match(err.message, /неверный.*ключ|повреждён/i);
    assert.ok(!err.message.includes(rightKey));
    return true;
  },
);

// missing key on an encrypted store is also a clear error, not silent data loss
delete process.env.DATA_ENCRYPTION_KEY;
await assert.rejects(() => readStoreFile(file, { users: {} }), /зашифровано.*DATA_ENCRYPTION_KEY/i);

// an invalid key length is rejected up front
process.env.DATA_ENCRYPTION_KEY = "too-short";
await assert.rejects(() => writeStoreFile(file, { users: {} }), /32 байта/i);

console.log("storage encryption: ok");
