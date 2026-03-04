import asyncio
import os
import logging
from datetime import datetime

import asyncpg

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('stats_cron')

DATABASE_URL = os.environ.get('DATABASE_URL', 'postgresql://agoraiq:agoraiq@127.0.0.1:5432/agoraiq').split('?')[0]

PERIODS = [('7d', 7), ('30d', 30), ('90d', 90), ('all', 9999)]


async def run():
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    try:
        rows = await pool.fetch(
            """SELECT id, name FROM providers
               WHERE marketplace_visible = true AND "isActive" = true"""
        )
        log.info(f'Recomputing stats for {len(rows)} providers')

        for row in rows:
            pid, name = row['id'], row['name']

            for period_label, days in PERIODS:
                await pool.execute(
                    'SELECT compute_provider_stats_v3($1, $2, $3)',
                    pid, period_label, days,
                )

            snap = await pool.fetchrow(
                """SELECT expectancy_r, vol_adj_expectancy, r_stddev,
                          cherry_pick_score, sample_confidence, data_completeness, trade_count
                   FROM provider_stats_snapshot
                   WHERE provider_id = $1 AND period = '30d'""", pid
            )
            if snap:
                vae = f'{snap["vol_adj_expectancy"]:+.3f}' if snap['vol_adj_expectancy'] is not None else 'NULL'
                log.info(
                    f'  {name}: trades={snap["trade_count"]} '
                    f'E(R)={snap["expectancy_r"]:+.3f} VaE={vae} '
                    f'cherry={snap["cherry_pick_score"]:.3f} '
                    f'completeness={snap["data_completeness"]:.1%}'
                )

            # Current month
            month = datetime.utcnow().strftime('%Y-%m')
            await pool.execute('SELECT compute_monthly_stats($1, $2)', pid, month)

        # Auto-promote tiers
        await pool.execute("""
            UPDATE providers SET marketplace_tier = 'VERIFIED'
            WHERE marketplace_visible = true AND "isActive" = true
              AND id IN (
                SELECT provider_id FROM provider_stats_snapshot
                WHERE period = '30d' AND trade_count >= 30
                  AND data_completeness >= 0.6
                  AND sample_confidence != 'Low'
              )
        """)
        await pool.execute("""
            UPDATE providers SET marketplace_tier = 'BETA'
            WHERE marketplace_visible = true AND "isActive" = true
              AND marketplace_tier = 'VERIFIED'
              AND id NOT IN (
                SELECT provider_id FROM provider_stats_snapshot
                WHERE period = '30d' AND trade_count >= 30
                  AND data_completeness >= 0.6
                  AND sample_confidence != 'Low'
              )
        """)
        promoted = await pool.fetch(
            "SELECT name, marketplace_tier FROM providers WHERE marketplace_tier = 'VERIFIED' AND \"isActive\" = true"
        )
        log.info(f'Tier check: {len(promoted)} VERIFIED providers')
        log.info('Stats recompute complete')
    finally:
        await pool.close()


if __name__ == '__main__':
    asyncio.run(run())
