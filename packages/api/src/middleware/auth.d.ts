import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@agoraiq/db';
export interface AuthPayload {
    userId: string;
    email: string;
    workspaceId: string;
    role: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthPayload;
        }
    }
}
/** Verify JWT bearer token — rejects 401 if missing/invalid */
export declare function requireAuth(req: Request, res: Response, next: NextFunction): void;
/** Check that the authenticated user has an active subscription */
export declare function requireSubscription(db: PrismaClient): (req: Request, res: Response, next: NextFunction) => Promise<void>;
/** Check for admin role */
export declare function requireAdmin(req: Request, res: Response, next: NextFunction): void;
/** Generate a JWT token */
export declare function signToken(payload: AuthPayload): string;
//# sourceMappingURL=auth.d.ts.map