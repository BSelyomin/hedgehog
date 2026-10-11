import {beforeEach,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());vi.mock('../db.ts',()=>({query,iso:(d:Date|null)=>d?.toISOString()??null}));
import {trackRecord} from './track-record.ts';
const row=(ticker:string,p:number,outcome:number)=>({ticker,title:null,category:'Economics',prob_24h_before:p,outcome,close_time:new Date('2026-10-01T00:00:00Z'),odds_time:new Date('2026-09-30T00:00:00Z'),loaded_at:new Date('2026-10-02T00:00:00Z')});
beforeEach(()=>{query.mockReset().mockResolvedValue([]);});
it('reports absent history and portfolio relevance separately',async()=>{
 query.mockResolvedValueOnce([]).mockResolvedValueOnce([{count:'2'}]).mockResolvedValueOnce([{category:'Economics',symbol:'TLT'}]);
 const d=await trackRecord('session');expect(d.totalMarkets).toBe(0);expect(d.categories).toEqual([]);expect(d.relevantCategories).toEqual([{category:'Economics',holdings:['TLT']}]);
 expect(query.mock.calls[2][1]).toEqual(['session']);
});
it('keeps seven-day and thirty-day datasets and exclusions separate from legacy 24-hour history',async()=>{
 for(const horizon of [1,168,720]) {
  query.mockReset().mockResolvedValue([]);
  query.mockImplementation(async(sql:string,values:unknown[])=>{
   if(sql.includes('FROM forecast_observations')) {expect(values).toEqual([horizon]);return [{...row('long-horizon',.2,0),series_ticker:'OIL',event_ticker:'event'}];}
   if(sql.includes('FROM backfill_skips')) {expect(values).toEqual([horizon]);return [{category:'Economics',series_ticker:'OIL',reason:'no_quote'}];}
   if(sql.includes('SELECT series_ticker,tag'))return [{series_ticker:'OIL',tag:'oil'}];
   return [];
  });
  const d=await trackRecord(undefined,horizon);
  expect(d.horizonHours).toBe(horizon);expect(d.totalMarkets).toBe(1);
  expect(d.subjects.find(s=>s.id==='oil')?.record?.brier).toBeCloseTo(.04);
  expect(d.categories[0].coverage.noQuote).toBe(1);
  expect(query.mock.calls.some(([sql])=>sql.includes('FROM settled_markets s'))).toBe(false);
 }
});
it('leaves longer horizons empty when no observations exist rather than reusing 24-hour probabilities',async()=>{
 query.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{series_ticker:'OIL',tag:'oil'}]).mockResolvedValueOnce([{category:'Test',series_ticker:'OIL',reason:'no_quote'}]);
 const d=await trackRecord(undefined,720);expect(d.totalMarkets).toBe(0);
 expect(d.subjects.filter(s=>s.id!=='all')).toHaveLength(8);
 expect(d.subjects.every(s=>s.record===null)).toBe(true);
 expect(d.subjects.find(s=>s.id==='oil')?.coverage).toEqual({scored:0,noQuote:1,outcomeKnown:0});
 await expect(trackRecord(undefined,48)).rejects.toThrow('Unsupported');
});
it('counts sourced releases separately from Kalshi event identifiers',async()=>{
 const released_at=new Date('2026-09-11T12:30:00Z'),source_url='https://www.bls.gov/release';
 query.mockResolvedValueOnce([{...row('headline',.5,1),event_ticker:'headline',released_at,source_url},{...row('core',.5,0),event_ticker:'core',released_at,source_url}]).mockResolvedValueOnce([{count:'2'}]);
 const c=(await trackRecord()).categories[0];expect(c.eventCount).toBe(2);expect(c.knownReleaseCount).toBe(1);expect(c.marketsWithRelease).toBe(2);expect(c.examples[0].release?.sourceUrl).toBe(source_url);
});
it('uses verified outcomes, retains evidence timestamps, and does not treat a small sample as trust eligible',async()=>{
 query.mockResolvedValueOnce([row('first',.7,1),row('second',.7,0)]).mockResolvedValueOnce([{count:'1'}]).mockResolvedValueOnce([{category:'Economics',symbol:'TLT'}]);
 const d=await trackRecord('session'),c=d.categories[0];expect(c.count).toBe(2);expect(c.brier).toBeCloseTo(.29);expect(c.avgMiss).toBeCloseTo(20);expect(c.headline70).toEqual({count:2,observedRate:null,low:null,high:null});expect(c.baseRateBrier).toBeCloseTo(.25);expect(c.eligibleForTrust).toBe(false);expect(c.examples[0].title).toBe('first');expect(c.examples[0].oddsTime).toBe('2026-09-30T00:00:00.000Z');expect(c.relevantHoldings).toEqual(['TLT']);
});
it('limits examples without limiting statistics and applies the shared trust threshold',async()=>{
 query.mockResolvedValueOnce(Array.from({length:30},(_,i)=>row(String(i),.5,i%2))).mockResolvedValueOnce([{count:'1'}]);
 const d=await trackRecord();expect(d.categories[0].examples).toHaveLength(12);expect(d.categories[0].count).toBe(30);expect(d.categories[0].eligibleForTrust).toBe(true);expect(d.categories[0].brier).toBe(.25);expect(query).toHaveBeenCalledTimes(4);
});

it('groups history by verified subject tags without changing category statistics',async()=>{
 const inflation={...row('cpi',.7,1),series_ticker:'KXCPI',event_ticker:'release'};
 const rates={...row('fed',.7,0),series_ticker:'KXFEDCUT',event_ticker:'meeting'};
 query.mockResolvedValueOnce([inflation,{...inflation,ticker:'second-cpi'},rates]).mockResolvedValueOnce([{count:'2'}]).mockResolvedValueOnce([{series_ticker:'KXCPI',tag:'inflation'},{series_ticker:'KXFEDCUT',tag:'fed-rates'}]);
 const d=await trackRecord();expect(d.categories[0].count).toBe(3);
 expect(d.subjects.find(s=>s.id==='inflation')?.record?.count).toBe(2);expect(d.subjects.find(s=>s.id==='inflation')?.eventCount).toBe(1);
 expect(d.subjects.find(s=>s.id==='rates')?.record?.headline70?.observedRate).toBeNull();expect(d.subjects.find(s=>s.id==='inflation')?.record?.eventCount).toBe(1);
 expect(d.subjects.find(s=>s.id==='companies')?.record).toBeNull();
});

it('reports the 65-75% rate with a range only once enough markets support it',async()=>{
 query.mockResolvedValueOnce(Array.from({length:10},(_,i)=>row(String(i),.7,i<7?1:0))).mockResolvedValueOnce([{count:'1'}]);
 const h=(await trackRecord()).categories[0].headline70!;expect(h.count).toBe(10);expect(h.observedRate).toBe(.7);expect(h.low).toBeCloseTo(.397,2);expect(h.high).toBeCloseTo(.892,2);
});

it('reports markets that could not be scored so coverage is visible',async()=>{
 query.mockResolvedValueOnce([row('a',.7,1)]).mockResolvedValueOnce([{count:'1'}]).mockResolvedValueOnce([]).mockResolvedValueOnce([{category:'Economics',series_ticker:'S',reason:'no_quote'},{category:'Economics',series_ticker:'S',reason:'outcome_known'},{category:'Politics',series_ticker:'S',reason:'no_quote'}]);
 const c=(await trackRecord()).categories[0];expect(c.coverage).toEqual({scored:1,noQuote:1,outcomeKnown:1});
});
