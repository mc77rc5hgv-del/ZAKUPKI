import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readStoreFile, writeStoreFile } from "../dist/infrastructure/security/encrypted-store.js";

const directory = mkdtempSync(path.join(tmpdir(), "zakupki-concurrent-store-"));
const file = path.join(directory, "store.json");
await Promise.all(Array.from({ length: 50 }, (_, seq) => writeStoreFile(file, { seq, payload: "x".repeat(1_000) })));
const value = await readStoreFile(file, null);
assert.ok(value && Number.isInteger(value.seq) && value.seq >= 0 && value.seq < 50);
assert.equal(value.payload.length, 1_000);
assert.equal(existsSync(`${file}.tmp`), false);
console.log("storage concurrency: ok");
