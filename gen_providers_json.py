import psycopg2, json

conn = psycopg2.connect("postgresql://agoraiq:Desf19848@127.0.0.1:5432/agoraiq")
cur = conn.cursor()

cur.execute("""
    SELECT symbol,
           count(*) FILTER (WHERE "exitedAt" > NOW() - INTERVAL '30 days' OR status='ACTIVE') as signals_30d,
           count(*) FILTER (WHERE status='HIT_TP' AND "exitedAt" > NOW() - INTERVAL '30 days') as wins,
           count(*) FILTER (WHERE status='HIT_SL' AND "exitedAt" > NOW() - INTERVAL '30 days') as losses,
           COALESCE(AVG("rMultiple") FILTER (WHERE status IN ('HIT_TP','HIT_SL') AND "exitedAt" > NOW() - INTERVAL '30 days'), 0) as avg_rr,
           COALESCE(SUM("pnlPct") FILTER (WHERE "exitedAt" > NOW() - INTERVAL '30 days'), 0) as total_return,
           count(*) FILTER (WHERE status='ACTIVE') as active
    FROM trades
    GROUP BY symbol ORDER BY signals_30d DESC
""")

providers = []
for row in cur.fetchall():
    symbol, sig, wins, losses, avg_rr, total_ret, active = row
    closed = wins + losses
    wr = round(wins / closed * 100, 1) if closed > 0 else 0
    
    base = symbol.upper()
    for quote in ["USDT","ETH","BTC"]:
        if base.endswith(quote):
            base = base[:-len(quote)]
            break

    providers.append({
        "name": f"ITB-{symbol}",
        "category": "Futures",
        "signals": sig,
        "winRate": f"{wr}%",
        "avgRR": round(avg_rr, 2),
        "return30d": f"+{total_ret:.1f}%" if total_ret >= 0 else f"{total_ret:.1f}%",
        "status": "Active" if active > 0 else "Closed"
    })

cur.close()
conn.close()

with open("/var/www/agoraiq-landing/providers.json", "w") as f:
    json.dump(providers, f)

print(f"✅ Generated {len(providers)} providers")
