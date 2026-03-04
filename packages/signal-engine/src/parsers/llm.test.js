"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("./index");
const FREEFORM_1 = `
guys btc looks great rn
going long around 65k area
targets 66.5, 68, 70
stop below 63k
10x on binance futures
`;
const FREEFORM_2 = `
ETH short setup
entry zone 3200-3250
tp1 3100 tp2 2950 tp3 2800
sl 3400
spot trade no leverage
`;
const CORNIX_LOW_CONFIDENCE = `
BTCUSDT LONG
somewhere around 65000
maybe stop at 62000
`;
async function run() {
    console.log('\n── Freeform 1 (BTC long, casual language) ──');
    const r1 = await (0, index_1.parseSignal)(FREEFORM_1, {
        mode: 'FREEFORM',
        confidenceThreshold: 0.6,
    });
    console.log(`Used LLM:    ${r1.usedLLM}`);
    console.log(`Success:     ${r1.success}`);
    console.log(`Confidence:  ${r1.confidence}`);
    console.log(`Explanation: ${r1.explanation}`);
    if (r1.data) {
        console.log(`Pair:        ${r1.data.pair} ${r1.data.direction}`);
        console.log(`Entry:       ${r1.data.entryMin} – ${r1.data.entryMax}`);
        console.log(`SL:          ${r1.data.stopLoss}`);
        console.log(`TPs:         ${r1.data.takeProfits.join(', ')}`);
    }
    console.log('\n── Freeform 2 (ETH short, spot) ──');
    const r2 = await (0, index_1.parseSignal)(FREEFORM_2, {
        mode: 'FREEFORM',
        confidenceThreshold: 0.6,
    });
    console.log(`Used LLM:    ${r2.usedLLM}`);
    console.log(`Success:     ${r2.success}`);
    console.log(`Confidence:  ${r2.confidence}`);
    if (r2.data) {
        console.log(`Pair:        ${r2.data.pair} ${r2.data.direction} [${r2.data.marketType}]`);
        console.log(`Entry:       ${r2.data.entryMin} – ${r2.data.entryMax}`);
        console.log(`SL:          ${r2.data.stopLoss}`);
        console.log(`TPs:         ${r2.data.takeProfits.join(', ')}`);
    }
    console.log('\n── Cornix with low confidence → LLM fallback ──');
    const r3 = await (0, index_1.parseSignal)(CORNIX_LOW_CONFIDENCE, {
        mode: 'CORNIX',
        confidenceThreshold: 0.75,
    });
    console.log(`Used LLM:    ${r3.usedLLM}`);
    console.log(`Success:     ${r3.success}`);
    console.log(`Confidence:  ${r3.confidence}`);
    console.log(`Explanation: ${r3.explanation}`);
}
run().catch(console.error);
//# sourceMappingURL=llm.test.js.map