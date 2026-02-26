# ═══════════════════════════════════════════════════════════════
# PATCH: Register AgoraIQ output in ITB's generators.py
#
# In  common/generators.py , find the  output_feature_set()
# function and add this block after the existing generator checks:
# ═══════════════════════════════════════════════════════════════

# --- Add this to the  output_feature_set()  function in generators.py ---
# Insert AFTER the line:  elif generator == "trader_mt5":
#                           generator_fn = get_trader_functions(Venue.MT5)["trader"]

    elif generator == "notifier_agoraiq":
        from outputs.notifier_agoraiq import send_agoraiq_signal
        generator_fn = send_agoraiq_signal

# --- End of patch ---


# ═══════════════════════════════════════════════════════════════
# FULL EXAMPLE CONFIG (add to output_sets in your .jsonc)
# ═══════════════════════════════════════════════════════════════
#
# {
#     "output_sets": [
#         // ... existing outputs ...
#
#         {"generator": "notifier_agoraiq", "config": {
#             "agoraiq_url": "https://agoraiq.net/api/v1/providers/itb/signals",
#             "agoraiq_token": "your-provider-token",
#             "provider_key": "itb-btc-1h-svc",
#
#             "buy_signal_column": "buy_signal_column",
#             "sell_signal_column": "sell_signal_column",
#             "score_column": "trade_score",
#
#             "include_transaction": true,
#             "send_holds": false,
#
#             // Copy band config from your score_notification_model
#             "positive_bands": [
#                 {"edge": 0.08, "sign": "〉〉〉📈", "text": "BUY ZONE"},
#                 {"edge": 0.04, "sign": "〉〉", "text": "strong"},
#                 {"edge": 0.02, "sign": "〉", "text": "weak"}
#             ],
#             "negative_bands": [
#                 {"edge": -0.02, "sign": "〈", "text": "weak"},
#                 {"edge": -0.04, "sign": "〈〈", "text": "strong"},
#                 {"edge": -0.08, "sign": "〈〈〈📉", "text": "SELL ZONE"}
#             ]
#         }}
#     ]
# }
