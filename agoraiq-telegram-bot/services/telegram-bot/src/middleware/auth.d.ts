import { Context, MiddlewareFn } from "telegraf";
export interface AgoraIQContext extends Context {
    aqUser?: {
        linked: boolean;
        userId?: string;
        tier?: string;
        tierExpiresAt?: string;
    };
}
export declare const loadUser: MiddlewareFn<AgoraIQContext>;
export declare const requireLinked: MiddlewareFn<AgoraIQContext>;
//# sourceMappingURL=auth.d.ts.map