import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "zakupki-profile-safety-"));
const child = path.resolve("tests/profile-safety-child.mjs");
const run = (profileDir, allow, confirm) => spawnSync(process.execPath, [child], {
  cwd: process.cwd(), encoding: "utf8",
  env: { ...process.env, RTS_PROFILE_DIR: profileDir, RTS_ALLOW_PROFILE_DELETION: String(allow), TEST_CONFIRM: confirm },
});
const makeOwned = async directory => {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, ".zakupki-rts-profile.json"), JSON.stringify({ magic: "zakupki-rts-browser-profile-v1" }));
  await fs.writeFile(path.join(directory, "cookie-data"), "must only be deleted after all guards pass");
};

const owned = path.join(root, "rts-profile");
await makeOwned(owned);
assert.match(run(owned, false, "DELETE_RTS_PROFILE").stderr, /отключено/);
assert.equal((await fs.stat(owned)).isDirectory(), true);
assert.match(run(owned, true, "wrong").stderr, /подтверждение/);
assert.equal((await fs.stat(owned)).isDirectory(), true);

const unowned = path.join(root, "victim-data");
await fs.mkdir(unowned);
await fs.writeFile(path.join(unowned, "important.txt"), "keep");
assert.match(run(unowned, true, "DELETE_RTS_PROFILE").stderr, /не помечен/);
assert.equal(await fs.readFile(path.join(unowned, "important.txt"), "utf8"), "keep");

assert.match(run(process.cwd(), true, "DELETE_RTS_PROFILE").stderr, /небезопасный/);
const success = run(owned, true, "DELETE_RTS_PROFILE");
assert.equal(success.status, 0, success.stderr);
await assert.rejects(fs.stat(owned));
console.log("profile safety: ok");
