import { query } from '../db.ts';
import { yahoo } from './prices.ts';

// Names the tickers Kalshi has markets on, and says whether each is a company, a fund or an
// index, for the Track record page. It covers tickers nobody holds too, which the holdings'
// own Yahoo profiles (security_profiles) do not, so a company can be looked up before it is
// bought. A few at a time, held tickers first; a fund is never expanded into its constituents.
export async function trackEntities(limit = 20) {
    const rows = await query<{ symbol: string }>(`SELECT a.tag symbol FROM allowed_tags a LEFT JOIN track_entities e ON e.symbol=a.tag
        WHERE a.tag ~ '^[A-Z][A-Z0-9.\\-^=]{0,14}$' AND (e.symbol IS NULL OR e.updated_at<now()-interval '7 days')
        ORDER BY EXISTS(SELECT 1 FROM portfolio_holdings h WHERE h.symbol=a.tag) DESC,a.tag LIMIT $1`, [limit]);
    if (!rows.length)
        return 0;
    const quotes = await yahoo.quote(rows.map(r => r.symbol));
    let stored = 0;
    for (const q of quotes) {
        const kind = q.quoteType === 'EQUITY' ? 'company' : ['ETF', 'MUTUALFUND'].includes(q.quoteType) ? 'fund' : q.quoteType === 'INDEX' ? 'index' : null;
        const name = q.longName ?? q.shortName;
        // Yahoo can answer with a different symbol than the one asked for; only what was asked is kept.
        if (!kind || !name || !rows.some(r => r.symbol === q.symbol))
            continue;
        await query(`INSERT INTO track_entities(symbol,name,kind) VALUES($1,$2,$3) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,kind=excluded.kind,updated_at=now()`, [q.symbol, name, kind]);
        stored++;
    }
    return stored;
}
