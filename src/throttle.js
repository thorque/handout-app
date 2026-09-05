import { setTimeout as defaultSleep } from "node:timers/promises";

const IDLE_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 10000;

export function delayFor(failures) {
  if (failures <= 2) return 0;
  return Math.min(1000 * 2 ** (failures - 3), 10000);
}

export function createThrottle({ sleep = defaultSleep, now = Date.now } = {}) {
  const entries = new Map();

  function dropIdle() {
    const cutoff = now() - IDLE_MS;
    for (const [key, entry] of entries) {
      if (entry.stamp < cutoff) entries.delete(key);
    }
  }

  function evictOldestIfFull() {
    if (entries.size < MAX_ENTRIES) return;
    let oldestKey;
    let oldestStamp = Infinity;
    for (const [key, entry] of entries) {
      if (entry.stamp < oldestStamp) {
        oldestStamp = entry.stamp;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) entries.delete(oldestKey);
  }

  async function penalise(key) {
    dropIdle();
    evictOldestIfFull();
    const existing = entries.get(key);
    const count = (existing ? existing.count : 0) + 1;
    entries.set(key, { count, stamp: now() });
    const delay = delayFor(count);
    await sleep(delay);
    return delay;
  }

  function clear(key) {
    entries.delete(key);
  }

  function size() {
    return entries.size;
  }

  return { penalise, clear, size };
}
