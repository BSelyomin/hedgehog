import {beforeEach,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),getHoldings:vi.fn()}));
vi.mock('../db.ts',()=>({query:mocks.query,iso:(d:Date|null)=>d?.toISOString()??null}));
vi.mock('./holdings.ts',()=>({getHoldings:mocks.getHoldings}));
import {holdingsHistory,summarizeOutcome} from './holdings-history.ts';
const observation={ticker:'CPI-AUG-THRESHOLD',event_ticker:'KXCPI-26AUG',series_ticker:'KXCPI',title:'CPI above threshold?',prob_24h_before:.7,outcome:1,odds_time:new Date('2026-09-10T12:29:00Z'),close_time:new Date('2026-09-11T12:29:00Z'),loaded_at:new Date('2026-10-01T00:00:00Z'),event_title:'CPI August',released_at:new Date('2026-09-11T12:30:00Z'),source_url:'https://www.bls.gov/news.release/archives/cpi_09112026.htm'};
beforeEach(()=>{
 mocks.query.mockReset();mocks.getHoldings.mockReset().mockResolvedValue({holdings:[{symbol:'TLT',valueUsd:10000}]});
 mocks.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM series_tags'))return [{series_ticker:'KXCPI',tag:'inflation'}];
  if(sql.includes('FROM stock_tags'))return [{symbol:'TLT',tag:'inflation'}];
  if(sql.includes('FROM measured_links'))return [{symbol:'TLT',driver:'DGS2',b:.2,se:.01,days:250,reliable:true,computed_at:new Date('2026-10-09T00:00:00Z')}];
  if(sql.includes('count(DISTINCT event_ticker)'))return [{count:'1'}];
  if(sql.includes('FROM settled_markets s'))return [observation];
  if(sql.includes('FROM prices'))return ['TLT','SPY'].flatMap(symbol=>[{symbol,ts:new Date('2026-09-10T00:00:00Z'),close:100},{symbol,ts:new Date('2026-09-11T00:00:00Z'),close:symbol==='TLT'?105:102}]);
  return [];
 });
});
it('uses only the requested current portfolio and reviewed links with a common SPY window',async()=>{
 const d=await holdingsHistory('account-session','inflation');expect(mocks.getHoldings).toHaveBeenCalledWith('account-session');expect(d.currentHoldings).toBe(true);
 expect(d.events[0].holdings[0].type).toBe('Measured');expect(d.events[0].holdings[0].move?.change).toBeCloseTo(.05);expect(d.events[0].spyMove?.change).toBeCloseTo(.02);
 expect(d.events[0].holdings[0].move?.beforeDate).toBe(d.events[0].spyMove?.beforeDate);expect(d.events[0].predictions[0].predatesRelease).toBe(true);
 expect(d.events[0].holdings[0]).not.toHaveProperty('dollarProfit');
 expect(d.events[0].holdings[0].vsSpy).toBeCloseTo(.03);expect(d.comparableEvents).toBe(1);expect(d.events[0].outcome).toEqual({contracts:1,yes:1,biggestMiss:null});
});
it('never substitutes market close time when the release is not verified',async()=>{
 const original=mocks.query.getMockImplementation()!;
 mocks.query.mockImplementation(async(sql:string)=>sql.includes('FROM settled_markets s')?[{...observation,released_at:null,source_url:null}]:original(sql));
 const d=await holdingsHistory('session');expect(d.events[0].release).toBeNull();expect(d.events[0].holdings[0].move).toBeNull();expect(d.events[0].windowNote).toContain('not used as a substitute');
});
it('returns no other portfolio data when a requested symbol is not owned or subject tags do not match',async()=>{
 expect((await holdingsHistory('session','all','AAPL')).events).toEqual([]);expect(mocks.query).not.toHaveBeenCalled();
 expect((await holdingsHistory('session','rates')).events).toEqual([]);
});
it('flags quotes recorded after the release instead of calling them a prior forecast',async()=>{
 const original=mocks.query.getMockImplementation()!;
 mocks.query.mockImplementation(async(sql:string)=>sql.includes('FROM settled_markets s')?[{...observation,odds_time:new Date('2026-09-12T12:00:00Z')}]:original(sql));
 expect((await holdingsHistory('session')).events[0].predictions[0].predatesRelease).toBe(false);
});
it('does not assume non-US security closes happen after the US release',async()=>{
 mocks.getHoldings.mockResolvedValue({holdings:[{symbol:'VOD.L',valueUsd:1000}]});
 const original=mocks.query.getMockImplementation()!;
 mocks.query.mockImplementation(async(sql:string)=>{
  if(sql.includes('FROM stock_tags'))return [{symbol:'VOD.L',tag:'inflation'}];
  if(sql.includes('FROM prices'))return ['VOD.L','SPY'].flatMap(symbol=>[{symbol,ts:new Date('2026-09-10T00:00:00Z'),close:100},{symbol,ts:new Date('2026-09-11T00:00:00Z'),close:105}]);
  return original(sql);
 });
 const h=(await holdingsHistory('session')).events[0].holdings[0];expect(h.move).toBeNull();expect(h.moveNote).toContain('not been verified');
});

it('names the largest miss and ignores quotes taken after the release',()=>{
 const c=[{title:'a',probability:.9,outcome:0},{title:'b',probability:.99,outcome:0},{title:'c',probability:.6,outcome:1}];
 expect(summarizeOutcome(c,[true,false,true])).toEqual({contracts:3,yes:1,biggestMiss:c[0]});
 expect(summarizeOutcome([{title:'c',probability:.6,outcome:1}],[true]).biggestMiss).toBeNull();
});
