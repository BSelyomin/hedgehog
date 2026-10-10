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
