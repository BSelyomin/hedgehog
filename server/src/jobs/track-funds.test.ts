import {it,expect,vi} from 'vitest';
vi.mock('../db.ts',()=>({query:vi.fn()}));vi.mock('../services/kalshi.ts',()=>({kalshi:vi.fn(),KALSHI_BASE:'https://external-api.kalshi.com/trade-api/v2'}));
import {sp500Series} from './track-funds.ts';
it('accepts the reviewed index-level identities with their actual index source',()=>{
 const s={ticker:'KXINXW',title:'S&P 500 range',category:'Financials',settlement_sources:[{name:'Google Finance',url:'https://www.google.com/finance/quote/.INX:INDEXSP?hl=en'}]};
 expect(sp500Series(s)).toBe(true);expect(sp500Series({...s,ticker:'KXINX'})).toBe(true);expect(sp500Series({...s,ticker:'KXINXI'})).toBe(false);expect(sp500Series({...s,ticker:'KXNEXTCOMPANYSP500',category:'Companies'})).toBe(false);expect(sp500Series({...s,settlement_sources:[{name:'Google',url:'https://www.google.com/finance/quote/NDX:INDEXNASDAQ'}]})).toBe(false);
});
