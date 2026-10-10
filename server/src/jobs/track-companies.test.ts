import {it,expect,vi} from 'vitest';
vi.mock('../db.ts',()=>({query:vi.fn()}));vi.mock('../services/kalshi.ts',()=>({kalshi:vi.fn(),KALSHI_BASE:'https://external-api.kalshi.com/trade-api/v2'}));
import {companySeriesEvidence} from './track-companies.ts';
it('requires issuer identity in an official settlement source, not a proposed broad company tag',()=>{
 const s={ticker:'KXEARNINGSMENTIONJPM',title:'JPM Earnings',category:'Mentions',settlement_sources:[{name:'JPMorgan Chase & Co. Investor Events',url:'https://www.jpmorganchase.com/ir/events'}]};
 expect(companySeriesEvidence(s,{symbol:'JPM',name:'JPMorgan Chase & Co.'})).toContain('JPMorgan');
 expect(companySeriesEvidence({...s,ticker:'KXEARNINGSMENTIONGS',title:'Goldman Sachs',settlement_sources:[{name:'Goldman Sachs Investor Events',url:'https://www.goldmansachs.com'}]},{symbol:'JPM',name:'JPMorgan Chase & Co.'})).toBeNull();
 expect(companySeriesEvidence({...s,settlement_sources:[]},{symbol:'JPM',name:'JPMorgan Chase & Co.'})).toBeNull();
});
it('accepts verified Apple and Microsoft identity and rejects similarly named non-company subjects',()=>{
 expect(companySeriesEvidence({ticker:'KXMSFTMENTION',title:'Microsoft Mention',category:'Mentions',settlement_sources:[{name:'Microsoft Corporation Investor Events',url:'https://www.microsoft.com/investor'}]},{symbol:'MSFT',name:'Microsoft Corporation'})).not.toBeNull();
 expect(companySeriesEvidence({ticker:'KXMAMDANI',title:'Mamdani',category:'Elections',settlement_sources:[]},{symbol:'AMD',name:'Advanced Micro Devices, Inc.'})).toBeNull();
});

it('skips incomplete catalog metadata without interrupting other companies',()=>{expect(companySeriesEvidence({ticker:'KXEARNINGSMENTIONAAPL',title:'Apple earnings',category:'Mentions',settlement_sources:[{} as any]},{symbol:'AAPL',name:'Apple Inc.'})).toBeNull();});
it('supports a named financial company series with a third-party source but excludes entertainment rankings',()=>{
 const source={name:'Carbon Arc',url:'https://www.carbonarc.co'};
 expect(companySeriesEvidence({ticker:'KXCVXCC',title:'Chevron Credit Card Spend',category:'Financials',settlement_sources:[source]},{symbol:'CVX',name:'Chevron Corporation'})).toContain('Chevron');
 expect(companySeriesEvidence({ticker:'RANK',title:'Netflix movie ranking',category:'Entertainment',settlement_sources:[{name:'Netflix',url:'https://www.netflix.com'}]},{symbol:'NFLX',name:'Netflix Inc.'})).toBeNull();
});
