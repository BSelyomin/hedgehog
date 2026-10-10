import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({query:vi.fn(),kalshi:vi.fn()}));
vi.mock('../db.ts',()=>({query:mocks.query}));vi.mock('../services/kalshi.ts',()=>({kalshi:mocks.kalshi,quote:vi.fn()}));
import {historyMetadata} from './backfill.ts';
it('recovers verified identities without replacing probabilities or outcomes or guessing series',async()=>{
 mocks.query.mockResolvedValueOnce([{ticker:'stored'}]).mockResolvedValue([]);
 mocks.kalshi.mockResolvedValueOnce({markets:[{ticker:'stored',event_ticker:'event',title:'Original question'},{ticker:'unsolicited',event_ticker:'other'}]}).mockResolvedValueOnce({event:{series_ticker:'CPI'}}).mockResolvedValueOnce({markets:[]});
 await historyMetadata();expect(mocks.kalshi).toHaveBeenCalledWith('/events/event');
 expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('SET series_ticker=COALESCE'),['stored','CPI','event','Original question']);
 expect(mocks.query.mock.calls.some(([sql])=>sql.includes('prob_24h_before=')||sql.includes('outcome='))).toBe(false);
 expect(mocks.query).toHaveBeenCalledTimes(2);
});
