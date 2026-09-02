
'use strict';

// Limitador barato em memoria para absorver bursts antes de tocar MySQL/scrypt.
// Nao substitui o rate-limit persistente; e uma primeira camada de baixo custo.
function createInMemoryGuard({ limit, windowMs, maxKeys = 10000 }) {
  const buckets = new Map();

  function cleanup(now) {
    if (buckets.size <= maxKeys) return;
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
      if (buckets.size <= maxKeys) break;
    }
    while (buckets.size > maxKeys) buckets.delete(buckets.keys().next().value);
  }

  function consume(key, now = Date.now()) {
    const safeKey = String(key || 'unknown').slice(0, 256);
    let bucket = buckets.get(safeKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(safeKey, bucket);
    }
    bucket.count += 1;
    cleanup(now);
    if (bucket.count > limit) return { ok: false, retryAfterMs: Math.max(1, bucket.resetAt - now) };
    return { ok: true, remaining: Math.max(0, limit - bucket.count), retryAfterMs: 0 };
  }

  return { consume, size: () => buckets.size, clear: () => buckets.clear() };
}

module.exports = { createInMemoryGuard };
