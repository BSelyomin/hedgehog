import {beforeEach,it,expect,vi} from 'vitest';
const {query,links,holdings}=vi.hoisted(()=>({query:vi.fn(),links:vi.fn(),holdings:vi.fn()}));
vi.mock('../db.ts',()=>({query,iso:(d:Date|null)=>d?.toISOString()??null}));
vi.mock('./history-links.ts',async original=>({...await original<typeof import('./history-links.ts')>(),historyLinks:links}));
vi.mock('./holdings.ts',()=>({getHoldings:holdings}));
import {trackRatings} from './track-ratings.ts';
beforeEach(()=>{
 query.mockReset();links.mockReset();holdings.mockReset();
 holdings.mockResolvedValue({holdings:[{symbol:'SPY'}]});links.mockResolvedValue(new Map([['AAPL-S',[{symbol:'AAPL',type:'Direct',evidence:'Exact company tag'}]]]));
 query.mockImplementation(async(sql:string)=>sql.includes('series_tags')?[{series_ticker:'AAPL-S',tag:'AAPL'},{series_ticker:'FUND-S',tag:'SPY'}]:sql.includes('track_entities')?[{symbol:'AAPL',name:'Apple',kind:'company'},{symbol:'SPY',name:'Index fund',kind:'fund'},...Array.from({length:12},(_,i)=>({symbol:`OTHER${i}`,name:`Other company ${i}`,kind:'company'}))]:[]);
});
it('limits default companies to portfolio links, excludes funds, and scopes relationships to the session',async()=>{
 const d=await trackRatings('owner',24);expect(d.companies.map(c=>c.symbol)).toEqual(['AAPL']);expect(d.fundSymbols).toEqual(['SPY']);expect(links).toHaveBeenCalledWith('owner',expect.any(Array));expect(holdings).toHaveBeenCalledWith('owner');expect(d.themes).toHaveLength(6);
});
it('paginates global company lookup and reads only the selected horizon',async()=>{
 const d=await trackRatings('owner',720,2,'other');expect(d.companies).toHaveLength(2);expect(d.totalCompanies).toBe(12);expect(d.page).toBe(2);
 expect(query.mock.calls.find(([sql])=>sql.includes('track_quotes'))?.[1]).toEqual([720]);expect(d.companies.every(c=>c.rating.accuracy===null)).toBe(true);
 await expect(trackRatings('owner',48)).rejects.toThrow('Unsupported');
});
