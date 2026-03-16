/**
 * @agoraiq/signal-engine — Explanation Engine
 *
 * Translates machine-readable reason codes and risk flags into
 * human-readable explanations for Telegram/dashboard display.
 */

import type { FinalSignal, ReasonCode } from "./types";

const REASON_EXPLANATIONS: Record<string, string> = {
  EMA_BULLISH_ALIGNMENT:
    "Price is above the 50 EMA and the 50 EMA is above the 200 EMA.",
  EMA_BEARISH_ALIGNMENT:
    "Price is below the 50 EMA and the 50 EMA is below the 200 EMA.",
  RSI_BULLISH_MIDZONE:
    "RSI is in a healthy bullish range, showing momentum without extreme overheating.",
  RSI_BEARISH_MIDZONE:
    "RSI is in a healthy bearish range, showing selling pressure without capitulation.",
  RSI_OVERSOLD: "RSI is oversold, increasing the odds of a bounce.",
  RSI_OVERBOUGHT:
    "RSI is overbought, increasing the odds of a pullback.",
  MACD_POSITIVE: "MACD momentum is positive.",
  MACD_NEGATIVE: "MACD momentum is negative.",
  RESISTANCE_BREAKOUT: "Price broke above recent resistance.",
  SUPPORT_BREAKDOWN: "Price broke below recent support.",
  VOLUME_CONFIRMATION:
    "Volume exceeds the breakout threshold, confirming the move.",
  ORDERBOOK_BUY_PRESSURE:
    "Order book shows significant buy-side imbalance.",
  ORDERBOOK_SELL_PRESSURE:
    "Order book shows significant sell-side imbalance.",
  BOLLINGER_LOWER_EXTREME:
    "Price is at or below the lower Bollinger Band — statistically oversold.",
  BOLLINGER_UPPER_EXTREME:
    "Price is at or above the upper Bollinger Band — statistically overbought.",
  NO_STRONG_NEGATIVE_SENTIMENT:
    "Sentiment is not strongly negative, supporting a bounce.",
  NO_STRONG_POSITIVE_SENTIMENT:
    "Sentiment is not strongly positive, supporting a fade.",
  POSITIVE_NEWS_CATALYST:
    "A strong positive news catalyst is supporting the move.",
  NEGATIVE_NEWS_CATALYST:
    "A strong negative news catalyst is pressuring the asset.",
  SOURCE_CREDIBLE: "The news source has high credibility.",
  OPEN_INTEREST_CONFIRMATION:
    "Open interest is growing, confirming fresh positioning.",
  POSITIVE_SENTIMENT: "Overall market sentiment is bullish.",
  NEGATIVE_SENTIMENT: "Overall market sentiment is bearish.",
  // Order book depth
  BID_WALL_SUPPORT:
    "A large bid wall is providing price support below the entry zone.",
  ASK_WALL_RESISTANCE:
    "A large ask wall is acting as resistance above the current price.",
  DEPTH_RATIO_BULLISH:
    "Order book depth is heavily weighted toward bids — buyers have more ammunition.",
  DEPTH_RATIO_BEARISH:
    "Order book depth is heavily weighted toward asks — sellers have more ammunition.",
  // Whale activity
  WHALE_BUYING:
    "Institutional-size buy trades detected in the last hour — smart money is accumulating.",
  WHALE_SELLING:
    "Institutional-size sell trades detected in the last hour — smart money is distributing.",
  // Liquidation clusters
  SHORT_SQUEEZE_ZONE:
    "A cluster of short liquidations sits above the current price — forced buying will fuel the move.",
  LONG_SQUEEZE_ZONE:
    "A cluster of long liquidations sits below the current price — forced selling will fuel the move.",
  LIQUIDATION_CASCADE:
    "A liquidation cascade is in progress — rapid forced exits are creating volatility.",
  // Cross-exchange
  CROSS_EXCHANGE_CONSENSUS:
    "Multiple exchanges confirm the directional move — broad market agreement.",
  CROSS_EXCHANGE_DIVERGENCE:
    "Prices are diverging across exchanges — the move may be isolated or leverage-driven.",
};

const RISK_FLAG_EXPLANATIONS: Record<string, string> = {
  HIGH_VOLATILITY_EVENT:
    "⚠️ High-volatility event regime — wider stops recommended.",
  LOW_LIQUIDITY: "⚠️ Low liquidity — slippage risk elevated.",
  CROWDED_LONGS:
    "⚠️ Funding rate suggests crowded long positioning — squeeze risk.",
  CROWDED_SHORTS:
    "⚠️ Funding rate suggests crowded short positioning — squeeze risk.",
  EVENT_SHOCK:
    "⚠️ Extreme news event in progress — heightened unpredictability.",
  THIN_ORDERBOOK:
    "⚠️ Order book depth is thin — large orders will cause significant slippage.",
  WHALE_COUNTER_TRADE:
    "⚠️ Institutional traders are trading against this direction.",
  LIQUIDATION_CASCADE_ACTIVE:
    "⚠️ Liquidation cascade in progress — price action is erratic and gap risk is elevated.",
  CROSS_EXCHANGE_DIVERGENCE:
    "⚠️ Significant price divergence across exchanges — the move may reverse.",
  WIDE_SPREAD:
    "⚠️ Bid-ask spread is wider than normal — execution costs will be higher.",
};

/**
 * Translate reason codes to human-readable explanations.
 */
export function translateReasonCodes(codes: ReasonCode[]): string[] {
  return codes.map(
    (code) => REASON_EXPLANATIONS[code] ?? code
  );
}

/**
 * Translate risk flags to human-readable warnings.
 */
export function translateRiskFlags(flags: string[]): string[] {
  return flags.map(
    (flag) => RISK_FLAG_EXPLANATIONS[flag] ?? flag
  );
}

/**
 * Format a complete alert message for Telegram/notifications.
 */
export function formatAlertMessage(signal: FinalSignal): string {
  const reasons = translateReasonCodes(signal.reasonCodes);
  const risks = translateRiskFlags(signal.riskFlags);

  const lines = [
    `📊 ${signal.symbol} ${signal.direction} (${signal.timeframe})`,
    `Confidence: ${signal.confidence}`,
    `Score: ${signal.finalScore.toFixed(1)}`,
    `Strategy: ${signal.strategyType}`,
    `Entry: ${signal.entryLow.toFixed(2)} – ${signal.entryHigh.toFixed(2)}`,
    `Stop: ${signal.stopLoss.toFixed(2)}`,
    `TP1: ${signal.takeProfit1.toFixed(2)}`,
    `TP2: ${signal.takeProfit2.toFixed(2)}`,
    `Expected R: ${signal.expectedR.toFixed(1)}`,
    `Regime: ${signal.regime}`,
    "",
    "Why:",
    ...reasons.map((r) => `• ${r}`),
  ];

  if (risks.length > 0) {
    lines.push("", "Risk Flags:");
    lines.push(...risks.map((r) => `• ${r}`));
  }

  // AI reasoning section
  if (signal.aiReasoning?.available) {
    const ai = signal.aiReasoning;
    lines.push("");
    lines.push("🧠 AI Analysis:");
    lines.push(ai.narrative);

    if (ai.keyFactors.length > 0) {
      lines.push(...ai.keyFactors.map((f) => `• ${f}`));
    }

    if (ai.macroContext) {
      lines.push(`Macro: ${ai.macroContext}`);
    }

    if (ai.caution) {
      lines.push(`⚠️ ${ai.caution}`);
    }

    const adj = ai.scoreAdjustment;
    if (adj !== 0) {
      lines.push(
        `AI adjustment: ${adj > 0 ? "+" : ""}${adj} (confidence: ${(ai.aiConfidence * 100).toFixed(0)}%)`
      );
    }
  }

  return lines.join("\n");
}
