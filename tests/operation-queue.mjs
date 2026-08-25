import assert from "node:assert/strict";

process.env.RTS_QUEUE_TIMEOUT_MS = "250";
const { withPageQueue } = await import("../dist/infrastructure/rts/operation-queue.js");

// tasks never run concurrently: each one only starts after the previous settles
let active = 0;
let maxActive = 0;
const order = [];
async function tracked(id, ms) {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise(resolve => setTimeout(resolve, ms));
  order.push(id);
  active -= 1;
  return id;
}

const results = await Promise.all([
  withPageQueue(() => tracked("a", 30)),
  withPageQueue(() => tracked("b", 10)),
  withPageQueue(() => tracked("c", 20)),
]);

assert.equal(maxActive, 1, "no two queued tasks must run concurrently");
assert.deepEqual(order, ["a", "b", "c"], "queued tasks must run strictly in submission order");
assert.deepEqual(results, ["a", "b", "c"]);

// a task slower than the queue timeout fails its own caller promptly, without
// being cancelled — it keeps running for real in the background.
const slowStartedAt = Date.now();
await assert.rejects(() => withPageQueue(() => tracked("slow", 700)), /RTS_QUEUE_TIMEOUT|очере/i);
const timedOutAfterMs = Date.now() - slowStartedAt;
assert.ok(timedOutAfterMs < 500, `the caller must not wait for the full task duration (waited ${timedOutAfterMs}ms)`);
assert.ok(!order.includes("slow"), "the slow task must not have finished yet at the moment its caller times out");

// wait past its real completion, outside the queue
await new Promise(resolve => setTimeout(resolve, 600));
assert.ok(order.includes("slow"), "the slow task must still run to completion in the background, not be abandoned");
assert.ok(Date.now() - slowStartedAt >= 700, "the slow task's real duration must not have been cut short");

// the queue is free again: a fresh task now gets its own full timeout budget
const next = await withPageQueue(() => tracked("after-slow", 5));
assert.equal(next, "after-slow");
assert.deepEqual(order.slice(-2), ["slow", "after-slow"], "the slow task must be recorded as done before the next one runs");

console.log("operation queue: ok");
