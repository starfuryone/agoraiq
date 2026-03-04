"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// validator.ts — SignalValidator
//
// Validates a (potentially partial) SignalFields object against Cornix's rules
// and AgoraIQ's publishing requirements.
//
// Errors   → hard blockers. publish() must reject if any exist.
// Warnings → advisory. UI shows them, but publish() is still allowed.
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalValidator = void 0;
// Cornix accepts leverage in this exact format
const LEVERAGE_PATTERN = /^(Cross|Isolated)\s+\d+x$/;
// Valid uppercase symbol — 3–12 alphanumeric chars, no slash
const SYMBOL_PATTERN = /^[A-Z0-9]{3,12}$/;
class SignalValidator {
    /**
     * Validates a full or partial signal.
     * Accepts `Partial<SignalFields>` so the UI can call this live as the user
     * fills in fields, without needing every field to be present.
     */
    validate(signal) {
        const errors = [];
        const warnings = [];
        // ── Symbol ─────────────────────────────────────────────────────────────
        if (!signal.symbol || signal.symbol.trim() === '') {
            errors.push({
                field: 'symbol',
                code: 'MISSING',
                message: 'Symbol is required (e.g. BTCUSDT)',
            });
        }
        else if (!SYMBOL_PATTERN.test(signal.symbol.trim())) {
            errors.push({
                field: 'symbol',
                code: 'INVALID_FORMAT',
                message: 'Symbol must be uppercase with no slash (e.g. BTCUSDT not BTC/USDT)',
            });
        }
        // ── Direction ──────────────────────────────────────────────────────────
        if (!signal.direction) {
            errors.push({
                field: 'direction',
                code: 'MISSING',
                message: 'Direction (LONG or SHORT) is required',
            });
        }
        else if (signal.direction !== 'LONG' && signal.direction !== 'SHORT') {
            errors.push({
                field: 'direction',
                code: 'INVALID',
                message: 'Direction must be LONG or SHORT',
            });
        }
        // ── Exchange ───────────────────────────────────────────────────────────
        if (!signal.exchange || signal.exchange.trim() === '') {
            warnings.push({
                field: 'exchange',
                message: 'No exchange specified — Cornix users may not know where to execute',
            });
        }
        // ── Entries ────────────────────────────────────────────────────────────
        const entries = signal.entries;
        if (!entries || entries.length === 0) {
            errors.push({
                field: 'entries',
                code: 'MISSING',
                message: 'At least one entry price is required',
            });
        }
        else {
            if (entries.length > 2) {
                errors.push({
                    field: 'entries',
                    code: 'TOO_MANY',
                    message: 'Entry can be a single price or a range (max 2 prices)',
                });
            }
            const invalidEntry = entries.find((e) => !Number.isFinite(e) || e <= 0);
            if (invalidEntry !== undefined) {
                errors.push({
                    field: 'entries',
                    code: 'INVALID',
                    message: 'All entry prices must be positive numbers',
                });
            }
            // Range: lower must be less than upper
            if (entries.length === 2 &&
                entries[0] !== undefined &&
                entries[1] !== undefined &&
                entries[0] >= entries[1]) {
                errors.push({
                    field: 'entries',
                    code: 'INVALID',
                    message: 'Entry range must be [lower, upper] — first value must be less than second',
                });
            }
        }
        // ── Stop Loss ──────────────────────────────────────────────────────────
        if (signal.stopLoss === undefined || signal.stopLoss === null) {
            errors.push({
                field: 'stopLoss',
                code: 'MISSING',
                message: 'Stop Loss is required — signals cannot be published without a stop loss',
            });
        }
        else if (!Number.isFinite(signal.stopLoss) || signal.stopLoss <= 0) {
            errors.push({
                field: 'stopLoss',
                code: 'INVALID',
                message: 'Stop Loss must be a positive number',
            });
        }
        // ── Targets ────────────────────────────────────────────────────────────
        if (!signal.targets || signal.targets.length === 0) {
            errors.push({
                field: 'targets',
                code: 'MISSING',
                message: 'At least one Take Profit target is required',
            });
        }
        else {
            const invalidTarget = signal.targets.find((tp) => !Number.isFinite(tp) || tp <= 0);
            if (invalidTarget !== undefined) {
                errors.push({
                    field: 'targets',
                    code: 'INVALID',
                    message: 'All Take Profit targets must be positive numbers',
                });
            }
            if (signal.targets.length === 1) {
                warnings.push({
                    field: 'targets',
                    message: 'Only 1 TP set — consider adding TP2/TP3 for better Cornix compatibility and risk management',
                });
            }
        }
        // ── Leverage ───────────────────────────────────────────────────────────
        if (signal.leverage !== undefined && signal.leverage !== '') {
            if (!LEVERAGE_PATTERN.test(signal.leverage)) {
                errors.push({
                    field: 'leverage',
                    code: 'INVALID_FORMAT',
                    message: 'Leverage must use Cornix format: "Cross 10x" or "Isolated 5x"',
                });
            }
        }
        else {
            warnings.push({
                field: 'leverage',
                message: 'No leverage specified — Cornix will use its own default setting',
            });
        }
        // ── Cross-field directional checks ─────────────────────────────────────
        // Only run when we have enough data to make meaningful assertions
        const hasEntries = signal.entries && signal.entries.length > 0 && signal.entries.every((e) => e > 0);
        const hasSL = signal.stopLoss !== undefined &&
            Number.isFinite(signal.stopLoss) &&
            signal.stopLoss > 0;
        const hasTargets = signal.targets &&
            signal.targets.length > 0 &&
            signal.targets.every((tp) => tp > 0);
        const hasDirection = signal.direction === 'LONG' || signal.direction === 'SHORT';
        if (hasEntries && hasSL && hasTargets && hasDirection) {
            const avgEntry = signal.entries.reduce((sum, e) => sum + e, 0) / signal.entries.length;
            const sl = signal.stopLoss;
            const tps = signal.targets;
            if (signal.direction === 'LONG') {
                // SL must be below entry
                if (sl >= avgEntry) {
                    errors.push({
                        field: 'stopLoss',
                        code: 'INVALID_DIRECTION',
                        message: `LONG stop loss (${sl}) must be below entry (${avgEntry})`,
                    });
                }
                // TPs must be ascending
                for (let i = 1; i < tps.length; i++) {
                    if (tps[i] <= tps[i - 1]) {
                        errors.push({
                            field: 'targets',
                            code: 'NOT_SEQUENTIAL',
                            message: `LONG targets must be ascending — TP${i + 1} (${tps[i]}) must be greater than TP${i} (${tps[i - 1]})`,
                        });
                        break; // one error is enough
                    }
                }
                // TP1 must be above entry
                if (tps[0] !== undefined && tps[0] <= avgEntry) {
                    errors.push({
                        field: 'targets',
                        code: 'TP_BEYOND_ENTRY',
                        message: `LONG TP1 (${tps[0]}) must be above entry (${avgEntry})`,
                    });
                }
            }
            if (signal.direction === 'SHORT') {
                // SL must be above entry
                if (sl <= avgEntry) {
                    errors.push({
                        field: 'stopLoss',
                        code: 'INVALID_DIRECTION',
                        message: `SHORT stop loss (${sl}) must be above entry (${avgEntry})`,
                    });
                }
                // TPs must be descending
                for (let i = 1; i < tps.length; i++) {
                    if (tps[i] >= tps[i - 1]) {
                        errors.push({
                            field: 'targets',
                            code: 'NOT_SEQUENTIAL',
                            message: `SHORT targets must be descending — TP${i + 1} (${tps[i]}) must be less than TP${i} (${tps[i - 1]})`,
                        });
                        break;
                    }
                }
                // TP1 must be below entry
                if (tps[0] !== undefined && tps[0] >= avgEntry) {
                    errors.push({
                        field: 'targets',
                        code: 'TP_BEYOND_ENTRY',
                        message: `SHORT TP1 (${tps[0]}) must be below entry (${avgEntry})`,
                    });
                }
            }
            // ── Risk/Reward warning ─────────────────────────────────────────────
            // R:R < 1.0 is a warning, not an error. Trader may have reasons.
            if (errors.length === 0 && tps[0] !== undefined) {
                const risk = Math.abs(avgEntry - sl);
                const reward = Math.abs(tps[0] - avgEntry);
                if (risk > 0) {
                    const rr = reward / risk;
                    if (rr < 1.0) {
                        warnings.push({
                            field: 'targets',
                            message: `Risk/Reward is ${rr.toFixed(2)}:1 — TP1 gives less reward than the stop loss risk`,
                        });
                    }
                }
            }
        }
        // ── Risk/Reward calculation ─────────────────────────────────────────────
        let riskReward = null;
        if (hasEntries && hasSL && hasTargets) {
            const avgEntry = signal.entries.reduce((sum, e) => sum + e, 0) / signal.entries.length;
            const risk = Math.abs(avgEntry - signal.stopLoss);
            const reward = Math.abs(signal.targets[0] - avgEntry);
            if (risk > 0) {
                riskReward = parseFloat((reward / risk).toFixed(2));
            }
        }
        return {
            valid: errors.length === 0,
            errors,
            warnings,
            riskReward,
        };
    }
}
exports.SignalValidator = SignalValidator;
//# sourceMappingURL=validator.js.map