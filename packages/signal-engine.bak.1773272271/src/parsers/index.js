"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseLLM = exports.parseCornix = void 0;
exports.parseSignal = parseSignal;
const cornix_1 = require("./cornix");
const llm_1 = require("./llm");
async function parseSignal(raw, options) {
    // RAW_PASSTHROUGH — no parsing, caller handles it
    if (options.mode === 'RAW_PASSTHROUGH') {
        return {
            success: true,
            confidence: 1.0,
            explanation: 'Raw passthrough — no parsing applied',
            errors: [],
            usedLLM: false,
        };
    }
    // FREEFORM — go straight to LLM
    if (options.mode === 'FREEFORM') {
        const llmOpts = {};
        if (options.llmPromptTemplate !== undefined)
            llmOpts.promptTemplate = options.llmPromptTemplate;
        if (options.promptVersion !== undefined)
            llmOpts.promptVersion = options.promptVersion;
        const result = await (0, llm_1.parseLLM)(raw, llmOpts);
        return { ...result, usedLLM: true };
    }
    // CORNIX — try regex first, fall back to LLM if below threshold
    if (options.mode === 'CORNIX') {
        const cornixResult = (0, cornix_1.parseCornix)(raw);
        if (cornixResult.confidence >= options.confidenceThreshold) {
            return { ...cornixResult, usedLLM: false };
        }
        console.log(`[parser] Cornix confidence ${cornixResult.confidence} below threshold ` +
            `${options.confidenceThreshold} — falling back to LLM`);
        const fallbackOpts = {};
        if (options.llmPromptTemplate !== undefined)
            fallbackOpts.promptTemplate = options.llmPromptTemplate;
        if (options.promptVersion !== undefined)
            fallbackOpts.promptVersion = options.promptVersion;
        const llmResult = await (0, llm_1.parseLLM)(raw, fallbackOpts);
        return { ...llmResult, usedLLM: true };
    }
    // STRICT_JSON — expect raw to already be valid JSON signal
    try {
        const json = JSON.parse(raw);
        return {
            success: true,
            confidence: 1.0,
            explanation: 'Strict JSON passthrough',
            data: json,
            errors: [],
            usedLLM: false,
        };
    }
    catch {
        return {
            success: false,
            confidence: 0,
            explanation: 'STRICT_JSON mode but message is not valid JSON',
            errors: ['Invalid JSON'],
            usedLLM: false,
        };
    }
}
var cornix_2 = require("./cornix");
Object.defineProperty(exports, "parseCornix", { enumerable: true, get: function () { return cornix_2.parseCornix; } });
var llm_2 = require("./llm");
Object.defineProperty(exports, "parseLLM", { enumerable: true, get: function () { return llm_2.parseLLM; } });
//# sourceMappingURL=index.js.map