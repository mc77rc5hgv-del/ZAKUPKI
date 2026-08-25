// Rejects RPC request ids that are stale or already processed — mitigates a
// captured hub->agent frame being replayed later by an on-path relay. Pure and
// stateful-by-construction so it is trivially unit-testable in isolation.
export function createReplayGuard(windowMs = 60_000) {
  const seen = new Map<string, number>();
  return {
    isReplay(id: string, ts: number, now = Date.now()): boolean {
      for (const [seenId, seenAt] of seen) if (now - seenAt > windowMs * 2) seen.delete(seenId);
      if (!Number.isFinite(ts) || Math.abs(now - ts) > windowMs) return true;
      if (seen.has(id)) return true;
      seen.set(id, now);
      return false;
    },
    size(): number {
      return seen.size;
    },
  };
}
