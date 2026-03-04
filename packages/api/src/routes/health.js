"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthRoutes = createHealthRoutes;
const express_1 = require("express");
function createHealthRoutes(db) {
    const router = (0, express_1.Router)();
    router.get('/health', async (_req, res) => {
        try {
            await db.$queryRaw `SELECT 1`;
            res.json({ status: 'ok', timestamp: new Date().toISOString() });
        }
        catch {
            res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
        }
    });
    return router;
}
//# sourceMappingURL=health.js.map