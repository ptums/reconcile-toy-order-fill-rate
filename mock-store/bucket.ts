export const MAX = 1000;
export const RESTORE_RATE = 50; // points per second

export interface Bucket {
  available: number;
  lastUpdate: number; // ms since 1970 (Date.now())
}

// A new set of buckets (one for each access token). Each app, and each test, gets its own.
export function createBuckets() {
  const buckets = new Map<string, Bucket>();

  function refill(token: string, now = Date.now()): Bucket {
    const bucket = buckets.get(token) ?? { available: MAX, lastUpdate: now };
    const seconds = (now - bucket.lastUpdate) / 1000;
    bucket.available = Math.min(MAX, bucket.available + seconds * RESTORE_RATE);
    bucket.lastUpdate = now;
    buckets.set(token, bucket);
    return bucket;
  }

  function take(token: string, cost: number, now = Date.now()): boolean {
    const bucket = refill(token, now);
    if (bucket.available < cost) return false;
    bucket.available -= cost;
    return true;
  }

  return { refill, take };
}
