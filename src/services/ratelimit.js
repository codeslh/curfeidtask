// Fixed-window in-memory rate limiter (single process). Keyed by route name + client IP.
const buckets = new Map();

export function rateLimit({ name, windowMs, max, message = 'Çok fazla istek. Lütfen biraz bekleyin.' }) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset <= now) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Drop expired windows so the map does not grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60_000).unref();

export function resetRateLimits() {
  buckets.clear();
}
