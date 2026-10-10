import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), quoteSummary: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('./prices.ts', () => ({ yahoo: { quoteSummary: mocks.quoteSummary } }));
import { fetchProfile, profiles } from './profiles.ts';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); mocks.query.mockReset(); mocks.quoteSummary.mockReset(); });

it('reads a company from its quote type, sector and industry in one request', async () => {
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'EQUITY', longName: 'ExxonMobil Holdings Corporation' }, assetProfile: { sector: 'Energy', industry: 'Oil & Gas Integrated' } });
    // A field that is not text is dropped, not passed on: the reply is not schema-checked.
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'EQUITY', longName: 7 }, assetProfile: { sector: ['Energy'], industry: '  ' } });
    expect(await fetchProfile('XOM')).toMatchObject({ quote_type: 'EQUITY' });
    expect(await fetchProfile('ODD')).toEqual({ symbol: 'ODD', quote_type: 'EQUITY', name: null, sector: null, industry: null, fund_category: null });
    mocks.quoteSummary.mockClear();
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'EQUITY', longName: 'ExxonMobil Holdings Corporation' }, assetProfile: { sector: 'Energy', industry: 'Oil & Gas Integrated' } });
    expect(await fetchProfile('XOM')).toEqual({ symbol: 'XOM', quote_type: 'EQUITY', name: 'ExxonMobil Holdings Corporation', sector: 'Energy', industry: 'Oil & Gas Integrated', fund_category: null });
    expect(mocks.quoteSummary).toHaveBeenCalledTimes(1);
    expect(mocks.quoteSummary).toHaveBeenCalledWith('XOM', { modules: ['quoteType', 'assetProfile'] }, { validateResult: false });
});
it('asks for a fund’s category, and keeps the log quiet only for that request', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const spied = console.log;
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'MUTUALFUND', shortName: 'Vanguard 500 Index Admiral' } })
        .mockImplementationOnce(async () => { console.log('validator noise'); return { fundProfile: { categoryName: 'Large Blend' } }; });
    expect(await fetchProfile('VFIAX')).toEqual({ symbol: 'VFIAX', quote_type: 'MUTUALFUND', name: 'Vanguard 500 Index Admiral', sector: null, industry: null, fund_category: 'Large Blend' });
    expect(mocks.quoteSummary).toHaveBeenLastCalledWith('VFIAX', { modules: ['fundProfile'] }, { validateResult: false });
    expect(log).not.toHaveBeenCalled();
    expect(console.log).toBe(spied);
});
it('restores the log when the fund request fails, and does not accept a category that is not text', async () => {
    const spied = vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'ETF' } }).mockRejectedValueOnce(new Error('network'));
    await expect(fetchProfile('TLT')).rejects.toThrow('network');
    expect(console.log).toBe(spied);
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'ETF' } }).mockResolvedValueOnce({ fundProfile: { categoryName: { raw: 3 } } });
    expect(await fetchProfile('ODD')).toMatchObject({ quote_type: 'ETF', fund_category: null });
});
it('returns nothing for a symbol Yahoo does not know as a security', async () => {
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'NONE' } });
    expect(await fetchProfile('HOME')).toBeNull();
    mocks.quoteSummary.mockResolvedValueOnce({});
    expect(await fetchProfile('BLANK')).toBeNull();
    expect(mocks.quoteSummary).toHaveBeenCalledTimes(2);
});
it('stores a profile for each held ticker that is due, and carries on past the ones it cannot read', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mocks.query.mockResolvedValueOnce([{ symbol: 'HOME' }, { symbol: 'SAVINGS' }, { symbol: 'XOM' }]).mockResolvedValue([]);
    mocks.quoteSummary.mockResolvedValueOnce({ quoteType: { quoteType: 'NONE' } }).mockRejectedValueOnce(new Error('Quote not found for symbol: SAVINGS'))
        .mockResolvedValueOnce({ quoteType: { quoteType: 'EQUITY', longName: 'ExxonMobil' }, assetProfile: { sector: 'Energy', industry: 'Oil' } });
    await profiles();
    // Only securities that have no profile yet, or an old one, are asked for; brokerage holdings count.
    expect(mocks.query.mock.calls[0][0]).toContain('FROM portfolio_holdings h LEFT JOIN security_profiles p');
    expect(mocks.query.mock.calls[0][0]).toContain("h.asset_type='security' AND (p.symbol IS NULL OR p.updated_at<now()-interval '30 days')");
    const writes = mocks.query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO security_profiles'));
    expect(writes).toHaveLength(1);
    expect(writes[0][1]).toEqual(['XOM', 'EQUITY', 'ExxonMobil', 'Energy', 'Oil', null]);
});
