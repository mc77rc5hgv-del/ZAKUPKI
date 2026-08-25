import { RtsError } from "./errors.js";

// All MCP tools share one Playwright page. Running two tool calls concurrently
// (e.g. a Telegram command and a scheduled watch check firing at the same
// moment) would let them navigate/read the same page out from under each
// other. This is a simple FIFO mutex: the next queued task only actually starts
// once the previous one has truly settled, so the browser is never touched by
// two tasks at once — even if a caller gave up waiting on a timeout.
//
// A per-task timeout still lets a caller move on instead of hanging forever:
// its returned promise races the real task against the timeout. The timeout
// losing that race does not cancel or detach the real task — it keeps running,
// and the queue still waits for it before starting the next one. The clock
// starts at submission, not at actual execution, so time already spent queued
// behind an earlier task counts against a task's own budget — a task queued
// behind one slower than the timeout can time out before it ever gets to run.
// That is intentional (an honest "how long will this caller actually wait"),
// not a bug: it also means recovery from a truly wedged Playwright action
// relies on Playwright's own per-action timeout (RTS_TIMEOUT_MS) eventually
// rejecting the real task — this queue does not forcibly kill the browser.
const QUEUE_TIMEOUT_MS = Math.max(200, Number(process.env.RTS_QUEUE_TIMEOUT_MS ?? 120_000));

let tail: Promise<void> = Promise.resolve();

export function withPageQueue<T>(task: () => Promise<T>): Promise<T> {
  const previousTail = tail;
  const real = previousTail.then(task, task);
  tail = real.then(() => undefined, () => undefined); // next task waits for real completion either way
  return raceWithTimeout(real);
}

function raceWithTimeout<T>(real: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new RtsError("RTS_QUEUE_TIMEOUT", `Операция не завершилась за ${Math.round(QUEUE_TIMEOUT_MS / 1000)} с в очереди браузера.`)),
      QUEUE_TIMEOUT_MS,
    );
    real.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}
