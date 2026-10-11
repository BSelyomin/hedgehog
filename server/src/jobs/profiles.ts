import { query } from '../db.ts';
import { yahoo } from './prices.ts';
import { runWithoutRetry } from '../services/no-retry.ts';

export interface SecurityProfile {
    symbol: string;
    quote_type: string;
    name: string | null;
    sector: string | null;
    industry: string | null;
    fund_category: string | null;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

// yahoo-finance2 3.15 leaves a debug print in its validator that fires dozens of times for every
// mutual fund's fund profile. It is muted for that one call; a real failure still throws.
async function muted<T>(work: () => Promise<T>): Promise<T> {
    const log = console.log;
    console.log = () => {};
    try { return await work(); } finally { console.log = log; }
}

// Yahoo's replies are read field by field rather than through the library's schema: it rejects a
// symbol that is not a security, and every mutual fund's fund profile, before they can be read.
interface Reply {
    quoteType?: { quoteType?: unknown; longName?: unknown; shortName?: unknown };
    assetProfile?: { sector?: unknown; industry?: unknown };
    fundProfile?: { categoryName?: unknown };
}
const unchecked = { validateResult: false } as const;

// What kind of security a ticker is, as Yahoo describes it. Null when Yahoo does not know it.
export async function fetchProfile(symbol: string): Promise<SecurityProfile | null> {
    const info = await yahoo.quoteSummary(symbol, { modules: ['quoteType', 'assetProfile'] }, unchecked) as Reply;
    const type = text(info.quoteType?.quoteType);
    if (!type || type === 'NONE')
        return null;
    let category: string | null = null;
    if (type === 'ETF' || type === 'MUTUALFUND') {
        const fund = await muted(() => yahoo.quoteSummary(symbol, { modules: ['fundProfile'] }, unchecked)) as Reply;
        category = text(fund.fundProfile?.categoryName);
    }
    return { symbol, quote_type: type, name: text(info.quoteType?.longName) ?? text(info.quoteType?.shortName), sector: text(info.assetProfile?.sector), industry: text(info.assetProfile?.industry), fund_category: category };
}

// Profiles change rarely: a held ticker is looked up when first seen and again after thirty days.
export async function profiles() {
    const due = await query<{ symbol: string }>(`SELECT DISTINCT h.symbol FROM portfolio_holdings h LEFT JOIN security_profiles p ON p.symbol=h.symbol
        WHERE h.asset_type='security' AND (p.symbol IS NULL OR p.updated_at<now()-interval '30 days') ORDER BY h.symbol`);
    for (const { symbol } of due) {
        try {
            const profile = await runWithoutRetry(`profiles:${symbol}`, () => fetchProfile(symbol));
            if (!profile) {
                console.warn('No security profile for symbol', symbol);
                continue;
            }
            await query(`INSERT INTO security_profiles(symbol,quote_type,name,sector,industry,fund_category,updated_at) VALUES($1,$2,$3,$4,$5,$6,now())
                ON CONFLICT(symbol) DO UPDATE SET quote_type=excluded.quote_type,name=excluded.name,sector=excluded.sector,industry=excluded.industry,fund_category=excluded.fund_category,updated_at=now()`,
            [profile.symbol, profile.quote_type, profile.name, profile.sector, profile.industry, profile.fund_category]);
            console.log('Security profile loaded', symbol, profile.quote_type);
        } catch {
            // Keep unclassified; failed provider work requires an explicit CLI run.
            console.warn('Security profile stopped after failure; automatic retries disabled', symbol);
        }
    }
}
