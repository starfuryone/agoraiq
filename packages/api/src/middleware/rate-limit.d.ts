/** Rate limiter for public proof endpoints (IP-based) */
export declare const proofRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Rate limiter for provider webhook endpoints */
export declare const webhookRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
export declare function sseConnectionGuard(req: any, res: any, next: any): void;
//# sourceMappingURL=rate-limit.d.ts.map