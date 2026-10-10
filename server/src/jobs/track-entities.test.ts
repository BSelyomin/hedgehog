import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), quote: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('./prices.ts', () => ({ yahoo: { quote: mocks.quote } }));
import { trackEntities } from './track-entities.ts';

const stored = () => mocks.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO track_entities')).map(([, values]) => values);
beforeEach(() => { mocks.query.mockReset(); mocks.quote.mockReset(); });

it('names each ticker asked for and says what kind of thing it is', async () => {
    mocks.query.mockImplementation(async (sql: string) => sql.includes('FROM allowed_tags') ? ['AAPL', 'SPY', 'TLTX', '^GSPC', 'BTC-USD', 'GONE'].map(symbol => ({ symbol })) : []);
    mocks.quote.mockResolvedValue([
        { symbol: 'AAPL', quoteType: 'EQUITY', longName: 'Apple Inc.', shortName: 'Apple' },
        { symbol: 'SPY', quoteType: 'ETF', shortName: 'SPDR S&P 500' },
        { symbol: 'TLTX', quoteType: 'MUTUALFUND', longName: 'A Treasury Fund' },
        { symbol: '^GSPC', quoteType: 'INDEX', longName: 'S&P 500' },
        // Neither a company, a fund nor an index.
        { symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY', longName: 'Bitcoin USD' },
        // No name published.
        { symbol: 'GONE', quoteType: 'EQUITY' },
        // Yahoo answered with a symbol that was not asked for.
        { symbol: 'AAPL.MX', quoteType: 'EQUITY', longName: 'Apple Inc.' },
    ]);
    expect(await trackEntities()).toBe(4);
    expect(mocks.quote).toHaveBeenCalledWith(['AAPL', 'SPY', 'TLTX', '^GSPC', 'BTC-USD', 'GONE']);
    expect(stored()).toEqual([['AAPL', 'Apple Inc.', 'company'], ['SPY', 'SPDR S&P 500', 'fund'], ['TLTX', 'A Treasury Fund', 'fund'], ['^GSPC', 'S&P 500', 'index']]);
});
it('asks only for tickers not yet named or named over a week ago, held ones first, a few at a time', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await trackEntities(5)).toBe(0);
    const [sql, values] = mocks.query.mock.calls[0];
    expect(sql).toContain(`e.symbol IS NULL OR e.updated_at<now()-interval '7 days'`);
    expect(sql).toContain('ORDER BY EXISTS(SELECT 1 FROM portfolio_holdings h WHERE h.symbol=a.tag) DESC');
    expect(values).toEqual([5]);
    // Nothing due: Yahoo is not called at all.
    expect(mocks.quote).not.toHaveBeenCalled();
});
