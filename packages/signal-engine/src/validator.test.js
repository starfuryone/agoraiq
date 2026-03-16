"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// validator.test.ts
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("../src/validator");
// ── Fixtures ──────────────────────────────────────────────────────────────────
/** Minimum valid LONG signal */
const validLong = {
    symbol: 'BTCUSDT',
    direction: 'LONG',
    exchange: 'Binance Futures',
    entries: [94500],
    stopLoss: 93000,
    targets: [96000, 97500, 99000],
    leverage: 'Cross 10x',
    footer: 'By @AgoraIQ',
};
/** Minimum valid SHORT signal */
const validShort = {
    symbol: 'ETHUSDT',
    direction: 'SHORT',
    exchange: 'Bybit',
    entries: [3200],
    stopLoss: 3350,
    targets: [3100, 3000, 2900],
    leverage: 'Isolated 5x',
};
// Helper: clone and override fields
function make(base, overrides) {
    return { ...base, ...overrides };
}
// ─────────────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('SignalValidator', () => {
    let v;
    (0, vitest_1.beforeEach)(() => {
        v = new validator_1.SignalValidator();
    });
    // ── Happy paths ─────────────────────────────────────────────────────────────
    (0, vitest_1.describe)('valid signals', () => {
        (0, vitest_1.it)('accepts a complete LONG signal', () => {
            const result = v.validate(validLong);
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
        });
        (0, vitest_1.it)('accepts a complete SHORT signal', () => {
            const result = v.validate(validShort);
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
        });
        (0, vitest_1.it)('accepts a LONG signal with entry range', () => {
            const result = v.validate({ ...validLong, entries: [94000, 94500] });
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
        });
        (0, vitest_1.it)('accepts a SHORT signal with entry range', () => {
            const result = v.validate({ ...validShort, entries: [3150, 3200] });
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
        });
        (0, vitest_1.it)('accepts a signal with no leverage (produces warning, not error)', () => {
            const { leverage: _, ...noLeverage } = validLong;
            const result = v.validate(noLeverage);
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.errors).toHaveLength(0);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'leverage')).toBe(true);
        });
        (0, vitest_1.it)('accepts a signal with no footer', () => {
            const { footer: _, ...noFooter } = validLong;
            const result = v.validate(noFooter);
            (0, vitest_1.expect)(result.valid).toBe(true);
        });
        (0, vitest_1.it)('accepts a signal with a single TP (warns, not error)', () => {
            const result = v.validate({ ...validLong, targets: [96000] });
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'targets')).toBe(true);
        });
    });
    // ── Symbol validation ───────────────────────────────────────────────────────
    (0, vitest_1.describe)('symbol', () => {
        (0, vitest_1.it)('rejects missing symbol', () => {
            const result = v.validate(make(validLong, { symbol: '' }));
            (0, vitest_1.expect)(result.valid).toBe(false);
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'symbol', code: 'MISSING' }));
        });
        (0, vitest_1.it)('rejects symbol with slash (BTC/USDT)', () => {
            const result = v.validate(make(validLong, { symbol: 'BTC/USDT' }));
            (0, vitest_1.expect)(result.valid).toBe(false);
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'symbol', code: 'INVALID_FORMAT' }));
        });
        (0, vitest_1.it)('rejects lowercase symbol', () => {
            const result = v.validate(make(validLong, { symbol: 'btcusdt' }));
            (0, vitest_1.expect)(result.valid).toBe(false);
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'symbol', code: 'INVALID_FORMAT' }));
        });
        (0, vitest_1.it)('accepts symbols with numbers (BTC3LUSDT)', () => {
            const result = v.validate(make(validLong, { symbol: 'BTC3LUSDT' }));
            (0, vitest_1.expect)(result.valid).toBe(true);
        });
    });
    // ── Direction validation ────────────────────────────────────────────────────
    (0, vitest_1.describe)('direction', () => {
        (0, vitest_1.it)('rejects missing direction', () => {
            const result = v.validate(make(validLong, { direction: undefined }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'direction', code: 'MISSING' }));
        });
        (0, vitest_1.it)('rejects invalid direction string', () => {
            const result = v.validate(make(validLong, { direction: 'BUY' }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'direction', code: 'INVALID' }));
        });
    });
    // ── Entry validation ────────────────────────────────────────────────────────
    (0, vitest_1.describe)('entries', () => {
        (0, vitest_1.it)('rejects missing entries', () => {
            const result = v.validate(make(validLong, { entries: [] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'MISSING' }));
        });
        (0, vitest_1.it)('rejects more than 2 entries', () => {
            const result = v.validate(make(validLong, { entries: [94000, 94200, 94500] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'TOO_MANY' }));
        });
        (0, vitest_1.it)('rejects negative entry price', () => {
            const result = v.validate(make(validLong, { entries: [-100] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'INVALID' }));
        });
        (0, vitest_1.it)('rejects zero entry price', () => {
            const result = v.validate(make(validLong, { entries: [0] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'INVALID' }));
        });
        (0, vitest_1.it)('rejects entry range where lower >= upper', () => {
            const result = v.validate(make(validLong, { entries: [95000, 94000] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'INVALID' }));
        });
        (0, vitest_1.it)('rejects entry range with equal values', () => {
            const result = v.validate(make(validLong, { entries: [94500, 94500] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'entries', code: 'INVALID' }));
        });
    });
    // ── Stop Loss validation ────────────────────────────────────────────────────
    (0, vitest_1.describe)('stopLoss', () => {
        (0, vitest_1.it)('rejects missing stop loss', () => {
            const result = v.validate(make(validLong, { stopLoss: undefined }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'MISSING' }));
        });
        (0, vitest_1.it)('rejects zero stop loss', () => {
            const result = v.validate(make(validLong, { stopLoss: 0 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID' }));
        });
        (0, vitest_1.it)('rejects negative stop loss', () => {
            const result = v.validate(make(validLong, { stopLoss: -100 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID' }));
        });
    });
    // ── Target validation ───────────────────────────────────────────────────────
    (0, vitest_1.describe)('targets', () => {
        (0, vitest_1.it)('rejects missing targets', () => {
            const result = v.validate(make(validLong, { targets: [] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'MISSING' }));
        });
        (0, vitest_1.it)('rejects negative target', () => {
            const result = v.validate(make(validLong, { targets: [-100] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'INVALID' }));
        });
        (0, vitest_1.it)('warns for single TP', () => {
            const result = v.validate({ ...validLong, targets: [96000] });
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'targets')).toBe(true);
        });
    });
    // ── Directional logic (LONG) ────────────────────────────────────────────────
    (0, vitest_1.describe)('LONG directional rules', () => {
        (0, vitest_1.it)('rejects SL above entry', () => {
            // Entry 94500, SL 96000 — invalid for LONG
            const result = v.validate(make(validLong, { stopLoss: 96000 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID_DIRECTION' }));
        });
        (0, vitest_1.it)('rejects SL equal to entry', () => {
            const result = v.validate(make(validLong, { stopLoss: 94500 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID_DIRECTION' }));
        });
        (0, vitest_1.it)('rejects non-ascending targets for LONG', () => {
            // TP2 lower than TP1
            const result = v.validate(make(validLong, { targets: [96000, 95000, 99000] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'NOT_SEQUENTIAL' }));
        });
        (0, vitest_1.it)('rejects equal adjacent targets for LONG', () => {
            const result = v.validate(make(validLong, { targets: [96000, 96000, 99000] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'NOT_SEQUENTIAL' }));
        });
        (0, vitest_1.it)('rejects TP1 below entry for LONG', () => {
            // Entry 94500, TP1 94000
            const result = v.validate(make(validLong, { targets: [94000, 97500, 99000] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'TP_BEYOND_ENTRY' }));
        });
        (0, vitest_1.it)('rejects TP1 equal to entry for LONG', () => {
            const result = v.validate(make(validLong, { targets: [94500, 97500, 99000] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'TP_BEYOND_ENTRY' }));
        });
    });
    // ── Directional logic (SHORT) ───────────────────────────────────────────────
    (0, vitest_1.describe)('SHORT directional rules', () => {
        (0, vitest_1.it)('rejects SL below entry for SHORT', () => {
            // Entry 3200, SL 3100 — invalid for SHORT
            const result = v.validate(make(validShort, { stopLoss: 3100 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID_DIRECTION' }));
        });
        (0, vitest_1.it)('rejects SL equal to entry for SHORT', () => {
            const result = v.validate(make(validShort, { stopLoss: 3200 }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'stopLoss', code: 'INVALID_DIRECTION' }));
        });
        (0, vitest_1.it)('rejects non-descending targets for SHORT', () => {
            // TP2 higher than TP1
            const result = v.validate(make(validShort, { targets: [3100, 3200, 2900] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'NOT_SEQUENTIAL' }));
        });
        (0, vitest_1.it)('rejects TP1 above entry for SHORT', () => {
            // Entry 3200, TP1 3300
            const result = v.validate(make(validShort, { targets: [3300, 3000, 2900] }));
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'targets', code: 'TP_BEYOND_ENTRY' }));
        });
    });
    // ── Leverage ────────────────────────────────────────────────────────────────
    (0, vitest_1.describe)('leverage', () => {
        (0, vitest_1.it)('accepts "Cross 10x"', () => {
            const result = v.validate({ ...validLong, leverage: 'Cross 10x' });
            (0, vitest_1.expect)(result.errors.filter((e) => e.field === 'leverage')).toHaveLength(0);
        });
        (0, vitest_1.it)('accepts "Isolated 5x"', () => {
            const result = v.validate({ ...validLong, leverage: 'Isolated 5x' });
            (0, vitest_1.expect)(result.errors.filter((e) => e.field === 'leverage')).toHaveLength(0);
        });
        (0, vitest_1.it)('rejects "10x" (missing Cross/Isolated)', () => {
            const result = v.validate({ ...validLong, leverage: '10x' });
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'leverage', code: 'INVALID_FORMAT' }));
        });
        (0, vitest_1.it)('rejects "cross 10x" (lowercase)', () => {
            const result = v.validate({ ...validLong, leverage: 'cross 10x' });
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'leverage', code: 'INVALID_FORMAT' }));
        });
        (0, vitest_1.it)('rejects "10X" (uppercase X)', () => {
            const result = v.validate({ ...validLong, leverage: 'Cross 10X' });
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ field: 'leverage', code: 'INVALID_FORMAT' }));
        });
        (0, vitest_1.it)('warns when leverage is absent', () => {
            const { leverage: _, ...noLev } = validLong;
            const result = v.validate(noLev);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'leverage')).toBe(true);
        });
    });
    // ── Risk/Reward ─────────────────────────────────────────────────────────────
    (0, vitest_1.describe)('risk/reward calculation', () => {
        (0, vitest_1.it)('calculates R:R correctly for LONG', () => {
            // Entry 94500, SL 93000 (risk 1500), TP1 96000 (reward 1500) → 1.0
            const result = v.validate(validLong);
            (0, vitest_1.expect)(result.riskReward).toBe(1.0);
        });
        (0, vitest_1.it)('calculates R:R correctly for SHORT', () => {
            // Entry 3200, SL 3350 (risk 150), TP1 3100 (reward 100) → 0.67
            const result = v.validate(validShort);
            (0, vitest_1.expect)(result.riskReward).toBe(0.67);
        });
        (0, vitest_1.it)('warns when R:R < 1.0', () => {
            // Entry 94500, SL 93000 (risk 1500), TP1 95000 (reward 500) → 0.33
            const result = v.validate({ ...validLong, targets: [95000, 97500, 99000] });
            (0, vitest_1.expect)(result.valid).toBe(true);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'targets')).toBe(true);
        });
        (0, vitest_1.it)('returns null R:R when fields are incomplete', () => {
            const result = v.validate({ symbol: 'BTCUSDT', direction: 'LONG' });
            (0, vitest_1.expect)(result.riskReward).toBeNull();
        });
    });
    // ── Partial input (live validation UX) ─────────────────────────────────────
    (0, vitest_1.describe)('partial input (live validation)', () => {
        (0, vitest_1.it)('handles completely empty input gracefully', () => {
            const result = v.validate({});
            (0, vitest_1.expect)(result.valid).toBe(false);
            (0, vitest_1.expect)(result.errors.length).toBeGreaterThan(0);
        });
        (0, vitest_1.it)('handles only symbol provided', () => {
            const result = v.validate({ symbol: 'BTCUSDT' });
            (0, vitest_1.expect)(result.valid).toBe(false);
            (0, vitest_1.expect)(result.errors.some((e) => e.field === 'direction')).toBe(true);
            (0, vitest_1.expect)(result.errors.some((e) => e.field === 'entries')).toBe(true);
            (0, vitest_1.expect)(result.errors.some((e) => e.field === 'stopLoss')).toBe(true);
            (0, vitest_1.expect)(result.errors.some((e) => e.field === 'targets')).toBe(true);
        });
        (0, vitest_1.it)('skips directional checks when entry is missing', () => {
            // If entries are missing, we can't check SL direction — no phantom errors
            const result = v.validate({
                symbol: 'BTCUSDT',
                direction: 'LONG',
                stopLoss: 93000, // would be invalid if we had entry — but entry is missing
                targets: [96000],
            });
            // Should get MISSING errors, not INVALID_DIRECTION
            (0, vitest_1.expect)(result.errors.some((e) => e.code === 'INVALID_DIRECTION')).toBe(false);
        });
        (0, vitest_1.it)('skips directional checks when stop loss is missing', () => {
            const result = v.validate({
                symbol: 'BTCUSDT',
                direction: 'LONG',
                entries: [94500],
                targets: [96000],
            });
            (0, vitest_1.expect)(result.errors.some((e) => e.code === 'INVALID_DIRECTION')).toBe(false);
        });
    });
    // ── Entry range edge cases ──────────────────────────────────────────────────
    (0, vitest_1.describe)('entry range + directional rules', () => {
        (0, vitest_1.it)('uses average entry for LONG SL check with range', () => {
            // entries [94000, 95000], avg = 94500
            // SL 94200 < avg 94500 → valid
            const result = v.validate({
                ...validLong,
                entries: [94000, 95000],
                stopLoss: 94200,
            });
            (0, vitest_1.expect)(result.valid).toBe(true);
        });
        (0, vitest_1.it)('rejects SL inside range midpoint for LONG', () => {
            // entries [94000, 95000], avg = 94500
            // SL 94600 > avg 94500 → invalid
            const result = v.validate({
                ...validLong,
                entries: [94000, 95000],
                stopLoss: 94600,
            });
            (0, vitest_1.expect)(result.errors).toContainEqual(vitest_1.expect.objectContaining({ code: 'INVALID_DIRECTION' }));
        });
    });
    // ── Exchange warning ────────────────────────────────────────────────────────
    (0, vitest_1.describe)('exchange', () => {
        (0, vitest_1.it)('warns when exchange is missing', () => {
            const { exchange: _, ...noExchange } = validLong;
            const result = v.validate(noExchange);
            (0, vitest_1.expect)(result.warnings.some((w) => w.field === 'exchange')).toBe(true);
        });
        (0, vitest_1.it)('valid without exchange (warning only)', () => {
            const { exchange: _, ...noExchange } = validLong;
            // Need to add exchange back as empty to trigger the warning branch
            const result = v.validate({ ...noExchange, exchange: '' });
            (0, vitest_1.expect)(result.valid).toBe(true);
        });
    });
});
//# sourceMappingURL=validator.test.js.map