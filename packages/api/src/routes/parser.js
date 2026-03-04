"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createParserRoutes = createParserRoutes;
const express_1 = require("express");
const signal_engine_1 = require("@agoraiq/signal-engine");
function createParserRoutes() {
    const router = (0, express_1.Router)();
    router.post('/test', async (req, res) => {
        try {
            const { raw, parserMode, confidenceThreshold, promptTemplate } = req.body;
            if (!raw || typeof raw !== 'string') {
                return res.status(400).json({ error: 'raw message is required' });
            }
            const result = await (0, signal_engine_1.parseSignal)(raw, {
                mode: parserMode ?? 'CORNIX',
                confidenceThreshold: confidenceThreshold ?? 0.75,
                llmPromptTemplate: promptTemplate ?? null,
            });
            return res.json(result);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return res.status(500).json({ error: msg });
        }
    });
    return router;
}
//# sourceMappingURL=parser.js.map