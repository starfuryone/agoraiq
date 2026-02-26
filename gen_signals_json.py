import psycopg2, json
from datetime import datetime, timezone

conn = psycopg2.connect("postgresql://agoraiq:Desf19848@127.0.0.1:5432/agoraiq")
cur = conn.cursor()

# Get 2 most recent trades per symbol for variety
cur.execute("""
    SELECT DISTINCT ON (t.symbol, t.id)
           t.symbol, t.direction, t."entryPrice", t."tpPrice", t."slPrice",
           t.status, t."rMultiple", t."pnlPct", t."exitedAt", t."createdAt",
           s."signalTs"
    FROM trades t JOIN signals s ON t."signalId" = s.id
    ORDER BY t.symbol, t.id, s."signalTs" DESC
""")
all_trades = cur.fetchall()

# Group by symbol, take 2 per symbol
from collections import defaultdict
by_symbol = defaultdict(list)
for row in all_trades:
    by_symbol[row[0]].append(row)

selected = []
for sym in by_symbol:
    trades = sorted(by_symbol[sym], key=lambda r: r[10], reverse=True)[:2]
    selected.extend(trades)

# Sort final list by signalTs desc
selected.sort(key=lambda r: r[10], reverse=True)

def fmt_price(p):
    if p is None: return "—"
    if p >= 1000: return f"{p:,.0f}"
    if p >= 1: return f"{p:,.2f}"
    if p >= 0.001: return f"{p:.4f}"
    return f"{p:.8f}"

def time_ago(dt):
    if dt is None: return "—"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    diff = datetime.now(timezone.utc) - dt
    hours = diff.total_seconds() / 3600
    if hours < 1: return f"{int(diff.total_seconds()/60)}m ago"
    if hours < 24: return f"{int(hours)}h ago"
    return f"{int(hours/24)}d ago"

def pair_fmt(symbol):
    s = symbol.upper()
    for quote in ["USDT", "BUSD", "USD", "ETH", "BTC"]:
        if s.endswith(quote):
            base = s[:-len(quote)]
            return f"{base}/{quote}"
    return s

signals = []
for row in selected:
    symbol, direction, entry, tp, sl, status, r_mult, pnl, exited, created, sig_ts = row

    if status == "HIT_TP":
        s_status = "win"
        result = f"+{r_mult:.1f}R" if r_mult else "+1.0R"
        pct = f"+{abs(pnl):.2f}%" if pnl else ""
    elif status == "HIT_SL":
        s_status = "loss"
        result = f"–{abs(r_mult):.1f}R" if r_mult else "–1.0R"
        pct = f"–{abs(pnl):.2f}%" if pnl else ""
    elif status == "ACTIVE":
        s_status = "active"
        result = "Active"
        pct = ""
    else:
        s_status = "expired"
        result = "Expired"
        pct = f"{pnl:+.2f}%" if pnl else ""

    signals.append({
        "pair": pair_fmt(symbol),
        "direction": direction,
        "exchange": "Binance Futures",
        "source": "Intelligent Trading Bot",
        "entryPrice": fmt_price(entry),
        "tp": fmt_price(tp),
        "sl": fmt_price(sl),
        "result": result,
        "pct": pct,
        "status": s_status,
        "time": time_ago(exited or sig_ts)
    })

cur.close()
conn.close()

with open("/var/www/agoraiq-landing/signals.json", "w") as f:
    json.dump(signals, f)

print(f"✅ Generated {len(signals)} signals across {len(by_symbol)} symbols")
