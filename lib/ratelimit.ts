const WINDOW_MS = 60_000;
const windows = new Map<string, { count: number; resetAt: number }>();
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number }
export function checkRateLimit(key: string, maxRequests = 20): RateLimitResult {
  const now = Date.now();
  for (const [key, window] of windows) if (now >= window.resetAt) windows.delete(key);
  let window = windows.get(key);
  if (!window) {
    // Fail closed if the bounded limiter fills up; never evict active limits.
    if (windows.size >= 10000) return { allowed: false, remaining: 0, resetAt: now + WINDOW_MS };
    window = { count: 0, resetAt: now + WINDOW_MS }; windows.set(key, window);
  }
  const allowed = window.count < maxRequests;
  if (allowed) window.count++;
  return { allowed, remaining: Math.max(0, maxRequests - window.count), resetAt: window.resetAt };
}
