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

it('includes held companies without direct series and keeps their macro relevance separate',async()=>{
 holdings.mockResolvedValue({holdings:[{symbol:'OTHER0'},{symbol:'SPY'}]});links.mockResolvedValue(new Map([['CPI',[{symbol:'OTHER0',type:'Related',evidence:'Shared inflation topic'}]]]));
 query.mockImplementation(async(sql:string)=>sql.includes('series_tags')?[{series_ticker:'CPI',tag:'inflation'}]:sql.includes('track_entities')?[{symbol:'OTHER0',name:'Held company',kind:'company'},{symbol:'SPY',name:'Fund',kind:'fund'}]:[]);
 const d=await trackRatings('owner');expect(d.companies.map(c=>c.symbol)).toEqual(['OTHER0']);expect(d.companies[0].relatedThemes).toEqual(['Inflation']);expect(d.companies[0].rating.accuracy).toBeNull();
});
it('puts usable theme and company data first before paginating',async()=>{
 query.mockImplementation(async(sql:string)=>sql.includes('series_tags')?[{series_ticker:'OIL',tag:'oil'},{series_ticker:'Z-S',tag:'OTHER11'}]:sql.includes('track_entities')?Array.from({length:12},(_,i)=>({symbol:`OTHER${i}`,name:`Other company ${i}`,kind:'company'})):sql.includes('track_quotes')?[{series_ticker:'Z-S',event:'E',bid:'.7',ask:'.8',outcome:1,status:'quoted',fetched_at:new Date()},{series_ticker:'OIL',event:'E2',bid:'.2',ask:'.3',outcome:0,status:'quoted',fetched_at:new Date()},{series_ticker:'OIL',event:'E3',bid:'.2',ask:'.3',outcome:0,status:'quoted',fetched_at:new Date()}]:[]);
 const d=await trackRatings('owner',24,1,'other');expect(d.themes[0].name).toBe('Oil');expect(d.companies[0].symbol).toBe('OTHER11');expect(d.companies).toHaveLength(10);
});
