/**
 * In-memory sliding window rate limiter for webhooks and order mutations.
 * Returns 429 Too Many Requests with standard rate limit headers when limit exceeded.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Periodic cleanup of expired records every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
      if (record.resetAt <= now) {
        memoryStore.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export function resetRateLimit(): void {
  memoryStore.clear();
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

export function checkRateLimit(
  identifier: string,
  limit = 60,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now();
  const existing = memoryStore.get(identifier);

  if (!existing || existing.resetAt <= now) {
    const record: RateLimitRecord = {
      count: 1,
      resetAt: now + windowMs,
    };
    memoryStore.set(identifier, record);
    return {
      allowed: true,
      limit,
      remaining: limit - 1,
      reset: Math.ceil(record.resetAt / 1000),
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, limit - existing.count);
  const allowed = existing.count <= limit;

  return {
    allowed,
    limit,
    remaining,
    reset: Math.ceil(existing.resetAt / 1000),
  };
}

export function rateLimit(
  identifier: string,
  limit = 60,
  windowMs = 60_000,
): { allowed: boolean; retryAfterSeconds: number; limit: number; remaining: number } {
  const res = checkRateLimit(identifier, limit, windowMs);
  return {
    allowed: res.allowed,
    retryAfterSeconds: Math.max(1, res.reset - Math.ceil(Date.now() / 1000)),
    limit: res.limit,
    remaining: res.remaining,
  };
}

export function createRateLimitHeaders(res: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(res.limit),
    "X-RateLimit-Remaining": String(res.remaining),
    "X-RateLimit-Reset": String(res.reset),
    ...(res.allowed ? {} : { "Retry-After": String(Math.max(1, res.reset - Math.ceil(Date.now() / 1000))) }),
  };
}
