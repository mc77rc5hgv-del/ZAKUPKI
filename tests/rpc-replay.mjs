import assert from "node:assert/strict";
import { createReplayGuard } from "../dist/application/replay-guard.js";

const guard = createReplayGuard(60_000);
const now = 1_000_000_000;

assert.equal(guard.isReplay("a", now, now), false, "first use of an id must pass");
assert.equal(guard.isReplay("a", now, now + 1_000), true, "reusing the same id must be rejected as replay");
assert.equal(guard.isReplay("b", now - 120_000, now), true, "a timestamp far in the past must be rejected as stale");
assert.equal(guard.isReplay("c", now + 120_000, now), true, "a timestamp far in the future must be rejected");
assert.equal(guard.isReplay("d", now, now + 30_000), false, "a fresh id within the window must pass");
assert.equal(guard.isReplay("d", now, now + 40_000), true, "the same id, replayed later within the window, must still be rejected");

// exact captured-frame replay: identical id AND identical timestamp resent verbatim
const guard2 = createReplayGuard(60_000);
const frame = { id: "captured-1", ts: now };
assert.equal(guard2.isReplay(frame.id, frame.ts, now), false);
assert.equal(guard2.isReplay(frame.id, frame.ts, now + 5_000), true, "resending an identical captured frame must be rejected");

console.log("rpc replay protection: ok");
