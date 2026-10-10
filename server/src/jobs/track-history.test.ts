import {beforeEach,it,expect,vi} from 'vitest';
const {query,kalshi,candles}=vi.hoisted(()=>({query:vi.fn(),kalshi:vi.fn(),candles:vi.fn()}));
vi.mock('../db.ts',()=>({query}));vi.mock('../services/kalshi.ts',()=>({kalshi}));
vi.mock('./prices.ts',()=>({yahoo:{quote:vi.fn()}}));
vi.mock('./backfill.ts',async original=>({...await original<typeof import('./backfill.ts')>(),loadCandles:candles}));
import {finalBinary,trackHistory,quoteOutcomeKnown} from './track-history.ts';
const market={ticker:'M',series_ticker:'S',event_ticker:'E',status:'finalized',result:'yes',market_type:'binary',close_time:'2026-01-01T12:00:00Z',settlement_ts:'2026-01-01T13:00:00Z'};
beforeEach(()=>{query.mockReset().mockImplementation(async(sql:string)=>sql.includes('SELECT t.series')?[{series_ticker:'S'}]:sql.includes('RETURNING id')?[{id:'1'}]:[]);kalshi.mockReset().mockResolvedValue({markets:[market],cursor:'next'});candles.mockReset().mockResolvedValue([]);});
it('accepts only verified final binary outcomes, never close time as settlement',()=>{
 expect(finalBinary(market as any)).toBe(true);
 for(const patch of [{status:'settled'},{is_provisional:true},{result:''},{market_type:'scalar'},{mve_collection_ticker:'combo'},{mve_selected_legs:[{}]},{settlement_ts:undefined},{settlement_ts:'2999-01-01T00:00:00Z'}])expect(finalBinary({...market,...patch} as any)).toBe(false);
});
it('uses official archive endpoints, preserves bounded continuation, and writes only additive tables',async()=>{
 kalshi.mockResolvedValue({markets:[market,{...market,ticker:'M2'}],cursor:'next'});
 expect(await trackHistory({maxMarkets:1})).toEqual({processed:1});
 expect(kalshi).toHaveBeenCalledWith('/historical/markets',{series_ticker:'S',limit:'100'});
 expect(candles).toHaveBeenCalledTimes(4);
 expect(query.mock.calls.find(([sql])=>sql.includes('INSERT INTO track_sync'))?.[1]).toEqual(['S','historical','',1]);
 for(const [sql]of query.mock.calls.filter(([s])=>s.startsWith('INSERT')||s.startsWith('UPDATE')||s.startsWith('DELETE')))expect(sql).toMatch(/^INSERT INTO track_/);
});
it('does not mark an API outage as missing or advance the page',async()=>{
 candles.mockRejectedValue(new Error('outage'));await expect(trackHistory({maxMarkets:1})).rejects.toThrow('outage');
 expect(query.mock.calls.some(([s])=>s.includes('INSERT INTO track_quotes')||s.includes('INSERT INTO track_sync'))).toBe(false);
});

it('excludes quotes after final settlement even when occurrence time is absent',()=>{expect(quoteOutcomeKnown(market as any,Date.parse(market.settlement_ts)/1000)).toBe(true);expect(quoteOutcomeKnown(market as any,Date.parse(market.close_time)/1000-86400)).toBe(false);});
