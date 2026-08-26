import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(path.join(tmpdir(), "zakupki-storage-migration-"));
const file = path.join(dir, "bot.json");

delete process.env.DATA_ENCRYPTION_KEY;
const { readStoreFile, writeStoreFile } = await import("../dist/infrastructure/security/encrypted-store.js");

// simulate an existing plaintext bot.json from before encryption was configured
const legacyPlaintext = JSON.stringify({ users: { 1: { note: "legacy plaintext record" } } }, null, 2);
await fs.writeFile(file, legacyPlaintext, "utf8");
const oldPlaintextBackup = path.join(dir, "bot.json.bak-old-deployment");
await fs.writeFile(oldPlaintextBackup, legacyPlaintext, "utf8");

// reading it back with no key configured still works (today's behavior, unchanged)
const readBeforeKey = await readStoreFile(file, { users: {} });
assert.equal(readBeforeKey.users["1"].note, "legacy plaintext record");

// now the operator configures a key and the process writes again — this must
// transparently migrate the file to the encrypted envelope AND keep only an
// encrypted backup of the original plaintext.
process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("hex");
await writeStoreFile(file, readBeforeKey);

const afterMigration = JSON.parse(await fs.readFile(file, "utf8"));
assert.equal(afterMigration.__encrypted, true);

const backups = (await fs.readdir(dir)).filter(name => name.startsWith("bot.json.bak-"));
assert.equal(backups.length, 2, "new and pre-existing migration backups must both be retained");
const newBackup = backups.find(name => /\.enc$/.test(name));
assert.ok(newBackup, "new migration backup must be marked as encrypted");
const backupContent = await fs.readFile(path.join(dir, newBackup), "utf8");
const backupEnvelope = JSON.parse(backupContent);
assert.equal(backupEnvelope.__encrypted, true, "the backup must use the encrypted envelope");
assert.equal(backupContent.includes("legacy plaintext record"), false, "plaintext must not remain in the backup");
const restoredBackup = await readStoreFile(path.join(dir, backups[0]), { users: {} });
assert.equal(restoredBackup.users["1"].note, "legacy plaintext record");
const remediatedOldBackup = await fs.readFile(oldPlaintextBackup, "utf8");
assert.equal(JSON.parse(remediatedOldBackup).__encrypted, true, "old plaintext backups must be encrypted in place");
assert.equal(remediatedOldBackup.includes("legacy plaintext record"), false);

// a further write must NOT create additional backups (only the first migration does)
await writeStoreFile(file, readBeforeKey);
const backupsAfterSecondWrite = (await fs.readdir(dir)).filter(name => name.startsWith("bot.json.bak-"));
assert.equal(backupsAfterSecondWrite.length, 2);

// reading post-migration with the configured key returns the same data
const readAfterMigration = await readStoreFile(file, { users: {} });
assert.equal(readAfterMigration.users["1"].note, "legacy plaintext record");

console.log("storage migration: ok");
