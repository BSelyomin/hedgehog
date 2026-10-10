import {beforeEach,it,expect,vi} from 'vitest';
const query=vi.hoisted(()=>vi.fn());vi.mock('../db.ts',()=>({query,iso:(d:Date|null)=>d?.toISOString()??null}));
import {trackRecord} from './track-record.ts';
const row=(ticker:string,p:number,outcome:number)=>({ticker,title:null,category:'Economics',prob_24h_before:p,outcome,close_time:new Date('2026-10-01T00:00:00Z'),odds_time:new Date('2026-09-30T00:00:00Z'),loaded_at:new Date('2026-10-02T00:00:00Z')});
beforeEach(()=>query.mockReset().mockResolvedValue([]));
it('reports absent history and portfolio relevance separately',async()=>{
 query.mockResolvedValueOnce([]).mockResolvedValueOnce([{count:'2'}]).mockResolvedValueOnce([{category:'Economics',symbol:'TLT'}]);
 const d=await trackRecord('session');expect(d.totalMarkets).toBe(0);expect(d.categories).toEqual([]);expect(d.relevantCategories).toEqual([{category:'Economics',holdings:['TLT']}]);
 expect(query.mock.calls[2][1]).toEqual(['session']);
});
it('uses verified outcomes, retains evidence timestamps, and does not treat a small sample as trust eligible',async()=>{
 query.mockResolvedValueOnce([row('first',.7,1),row('second',.7,0)]).mockResolvedValueOnce([{count:'1'}]).mockResolvedValueOnce([{category:'Economics',symbol:'TLT'}]);
 const d=await trackRecord('session'),c=d.categories[0];expect(c.count).toBe(2);expect(c.brier).toBeCloseTo(.29);expect(c.avgMiss).toBeCloseTo(20);expect(c.headline70).toEqual({count:2,observedRate:.5});expect(c.eligibleForTrust).toBe(false);expect(c.examples[0].title).toBe('first');expect(c.examples[0].oddsTime).toBe('2026-09-30T00:00:00.000Z');expect(c.relevantHoldings).toEqual(['TLT']);
});
it('limits examples without limiting statistics and applies the shared trust threshold',async()=>{
 query.mockResolvedValueOnce(Array.from({length:30},(_,i)=>row(String(i),.5,i%2))).mockResolvedValueOnce([{count:'1'}]);
 const d=await trackRecord();expect(d.categories[0].examples).toHaveLength(12);expect(d.categories[0].count).toBe(30);expect(d.categories[0].eligibleForTrust).toBe(true);expect(d.categories[0].brier).toBe(.25);expect(query).toHaveBeenCalledTimes(3);
});

it('groups history by verified subject tags without changing category statistics',async()=>{
 const inflation={...row('cpi',.7,1),series_ticker:'KXCPI',event_ticker:'release'};
 const rates={...row('fed',.7,0),series_ticker:'KXFEDCUT',event_ticker:'meeting'};
 query.mockResolvedValueOnce([inflation,{...inflation,ticker:'second-cpi'},rates]).mockResolvedValueOnce([{count:'2'}]).mockResolvedValueOnce([{series_ticker:'KXCPI',tag:'inflation'},{series_ticker:'KXFEDCUT',tag:'fed-rates'}]);
 const d=await trackRecord();expect(d.categories[0].count).toBe(3);
 expect(d.subjects.find(s=>s.id==='inflation')?.record?.count).toBe(2);expect(d.subjects.find(s=>s.id==='inflation')?.eventCount).toBe(1);
 expect(d.subjects.find(s=>s.id==='rates')?.record?.headline70?.observedRate).toBe(0);
 expect(d.subjects.find(s=>s.id==='companies')?.record).toBeNull();
});
