import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), getHoldings: vi.fn() }));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('./holdings.ts', () => ({ getHoldings: mocks.getHoldings }));
import { historyLinks, themeLinks } from './history-links.ts';
beforeEach(() => { mocks.query.mockReset().mockResolvedValue([]); mocks.getHoldings.mockReset(); });
it('uses the requested holdings and exact reviewed series, without category-wide relevance', async () => {
    mocks.getHoldings.mockResolvedValue({holdings:[{symbol:'GOOGL',valueUsd:100},{symbol:'TLT',valueUsd:100}]});
    mocks.query.mockImplementation(async (sql:string) => sql.includes('stock_tags') ? [{symbol:'TLT',tag:'inflation'}] : []);
    const links = await historyLinks('owner', [{series_ticker:'GOOGLE',tag:'GOOGL'},{series_ticker:'CPI',tag:'inflation'},{series_ticker:'FED',tag:'fed-rates'}]);
    expect(mocks.getHoldings).toHaveBeenCalledWith('owner');
    expect(themeLinks(['GOOGLE'],links).map(l=>l.symbol)).toEqual(['GOOGL']);
    expect(themeLinks(['CPI'],links)[0].type).toBe('Related');
    expect(themeLinks(['FED'],links)).toEqual([]);
});
it('reuses asset-specific rules and keeps property geography requirements', async () => {
    mocks.getHoldings.mockResolvedValue({holdings:[{symbol:'SAVINGS',valueUsd:1000,assetType:'cash'},{symbol:'HOME',valueUsd:1000,assetType:'property',details:{state:'Florida'}}]});
    mocks.query.mockImplementation(async (sql:string) => sql.includes('FROM events') ? [{series_ticker:'FED',title:'Federal Reserve rate decision'},{series_ticker:'FL',title:'Florida housing prices'},{series_ticker:'TX',title:'Texas housing prices'}] : []);
    const links = await historyLinks('owner',[{series_ticker:'FED',tag:'fed-rates'},{series_ticker:'FL',tag:'housing'},{series_ticker:'TX',tag:'housing'}]);
    expect(themeLinks(['FED'],links)[0].type).toBe('Calculated');
    expect(themeLinks(['FL'],links).map(l=>l.symbol)).toEqual(['HOME']);
    expect(themeLinks(['TX'],links)).toEqual([]);
});
it('keeps a series’ tags and event titles together however the rows are interleaved, and reads recent yields only', async () => {
    mocks.getHoldings.mockResolvedValue({holdings:[{symbol:'XOM',valueUsd:100},{symbol:'HOME',valueUsd:1000,assetType:'property',details:{state:'Florida'}}]});
    mocks.query.mockImplementation(async (sql:string) => sql.includes('stock_tags') ? [{symbol:'XOM',tag:'oil'}] : sql.includes('FROM events') ? [{series_ticker:'MIX',title:'Texas housing prices'},{series_ticker:'OTHER',title:'Brent close'},{series_ticker:'MIX',title:'Florida housing prices'}] : []);
    const links = await historyLinks('owner',[{series_ticker:'MIX',tag:'geopolitics'},{series_ticker:'OTHER',tag:'oil'},{series_ticker:'MIX',tag:'oil'},{series_ticker:'MIX',tag:'housing'}]);
    // The oil tag reaches XOM, and the second of the series' titles names the property's state.
    expect(themeLinks(['MIX'],links).map(l=>l.symbol)).toEqual(['HOME','XOM']);
    expect(themeLinks(['OTHER'],links).map(l=>l.symbol)).toEqual(['XOM']);
    expect([...links.keys()]).toEqual(['MIX','OTHER']);
    const yields = mocks.query.mock.calls.map(([sql]) => String(sql)).find(sql => sql.includes("IN('DGS2','DGS10')"));
    expect(yields).toContain("ts>now()-interval '30 days'");
});
