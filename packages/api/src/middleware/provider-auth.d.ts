import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@agoraiq/db';
export declare function providerAuth(db: PrismaClient): (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=provider-auth.d.ts.map