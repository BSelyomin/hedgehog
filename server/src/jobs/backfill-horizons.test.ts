import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),kalshi:vi.fn()}));
vi.mock('../db.ts',()=>({query:mocks.query}));
vi.mock('../services/kalshi.ts',async original=>({...await original<typeof import('../services/kalshi.ts')>(),kalshi:mocks.kalshi}));
import { backfill } from './backfill.ts';
const market={ticker:'M',event_ticker:'E',title:'Synthetic test question',status:'finalized',result:'yes',close_time:'2026-10-10T12:30:00Z'};
beforeEach(()=>{
 mocks.query.mockReset().mockImplementation(async(sql:string)=>sql.includes('SELECT DISTINCT e.series_ticker')?[{series_ticker:'S',category:'Test'}]:[]);
 mocks.kalshi.mockReset().mockImplementation(async(path:string,params:Record<string,string>)=>{
  if(path.endsWith('/candlesticks')) {
   const hours=(Date.parse(market.close_time)/1000-Number(params.end_ts))/3600;
   if(hours!==168) return {candlesticks:[]};
   return {candlesticks:[{end_period_ts:Number(params.end_ts),yes_bid:{close_dollars:'.4'},yes_ask:{close_dollars:'.6'}}]};
  }
  return {markets:[market],cursor:''};
 });
});
it('stores a real seven-day candle even when 24-hour and 30-day quotes are absent, with separate exclusions',async()=>{
 await backfill({series:['S'],maxMarkets:1});
 const stored=mocks.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO forecast_observations'));
 expect(stored).toHaveLength(1);expect(stored[0][1].slice(0,2)).toEqual(['M',168]);expect(stored[0][1].slice(6,8)).toEqual([.4,.6]);
 expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO settled_markets'))).toBe(false);
 const skipped=mocks.query.mock.calls.filter(([sql])=>sql.includes('INSERT INTO backfill_skips'));
 expect(skipped.map(([,values])=>values[5]).sort((a,b)=>a-b)).toEqual([24,720]);
 expect(skipped.every(([,values])=>values[3]==='no_quote')).toBe(true);
});
it('does not advance a failed page or record an API outage as a missing quote',async()=>{
 mocks.kalshi.mockImplementation(async(path:string)=>{
  if(path.endsWith('/candlesticks')) throw new Error('Kalshi retry limit');
  return {markets:[market],cursor:'NEXT'};
 });
 await backfill({series:['S'],maxMarkets:1});
 expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO job_state'))).toBe(false);
 expect(mocks.query.mock.calls.some(([sql])=>sql.includes('INSERT INTO backfill_skips'))).toBe(false);
});
