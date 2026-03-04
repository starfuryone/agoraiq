"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
const buckets = new Map();
function checkRateLimit(key, maxRequests, windowMs) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, retryAfterMs: 0 };
    }
    if (bucket.count >= maxRequests) {
        return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    bucket.count++;
    return { allowed: true, retryAfterMs: 0 };
}
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (now > bucket.resetAt)
            buckets.delete(key);
    }
}, 5 * 60 * 1000);
//# sourceMappingURL=rateLimit.js.map