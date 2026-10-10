import {beforeEach,it,expect,vi} from 'vitest';
const {query,links,holdings}=vi.hoisted(()=>({query:vi.fn(),links:vi.fn(),holdings:vi.fn()}));
vi.mock('../db.ts',()=>({query,iso:(d:Date|null)=>d?.toISOString()??null}));
vi.mock('./history-links.ts',async original=>({...await original<typeof import('./history-links.ts')>(),historyLinks:links}));
vi.mock('./holdings.ts',()=>({getHoldings:holdings}));
import {trackRatings} from './track-ratings.ts';
import {SP500_BENCHMARK_SERIES} from './history-subjects.ts';
// Which of the service's reads a statement is. The skip read names the history table too, so it is told apart first.
const read=(sql:string)=>sql.includes('FROM backfill_skips')?'skips':sql.includes('FROM settled_markets s LEFT JOIN')?'day':sql.includes('FROM forecast_observations s LEFT JOIN')?'other':sql.includes('FROM series_tags')?'tags':sql.includes('FROM track_entities')?'entities':'unknown';
type Rows=Partial<Record<ReturnType<typeof read>,unknown[]>>;
const database=(rows:Rows)=>query.mockImplementation(async(sql:string)=>rows[read(sql)]??[]);
const quote=(series_ticker:string,event:string,probability:number,outcome:number,extra={})=>({series_ticker,event,probability,outcome,loaded_at:new Date('2026-10-10T12:00:00Z'),known:false,...extra});
beforeEach(()=>{
 query.mockReset();links.mockReset();holdings.mockReset();
 holdings.mockResolvedValue({holdings:[{symbol:'SPY'}]});links.mockResolvedValue(new Map([['AAPL-S',[{symbol:'AAPL',type:'Direct',evidence:'Exact company tag'}]]]));
 database({tags:[{series_ticker:'AAPL-S',tag:'AAPL'},{series_ticker:'FUND-S',tag:'SPY'}],entities:[{symbol:'AAPL',name:'Apple',kind:'company'},{symbol:'SPY',name:'Index fund',kind:'fund'},...Array.from({length:12},(_,i)=>({symbol:`OTHER${i}`,name:`Other company ${i}`,kind:'company'}))]});
});
it('limits default companies to portfolio links, excludes funds, and scopes relationships to the session',async()=>{
 const d=await trackRatings('owner',24);expect(d.companies.map(c=>c.symbol)).toEqual(['AAPL']);expect(d.fundSymbols).toEqual(['SPY']);expect(links).toHaveBeenCalledWith('owner',expect.any(Array));expect(holdings).toHaveBeenCalledWith('owner');expect(d.themes).toHaveLength(6);
});
it('paginates global company lookup and reads only the selected horizon',async()=>{
 const d=await trackRatings('owner',720,2,'other');expect(d.companies).toHaveLength(2);expect(d.totalCompanies).toBe(12);expect(d.page).toBe(2);
 expect(query.mock.calls.find(([sql])=>read(sql)==='other')?.[1]).toEqual([720]);expect(query.mock.calls.find(([sql])=>read(sql)==='skips')?.[1]).toEqual([720]);
 expect(query.mock.calls.some(([sql])=>read(sql)==='day')).toBe(false);expect(d.companies.every(c=>c.rating.accuracy===null)).toBe(true);
 await expect(trackRatings('owner',48)).rejects.toThrow('Unsupported');
});
it('reads the 24-hour record from the track record itself, so a database that holds it shows it',async()=>{
 database({tags:[{series_ticker:'OIL',tag:'oil'},{series_ticker:'AAPL-S',tag:'AAPL'}],entities:[{symbol:'AAPL',name:'Apple',kind:'company'}],
  day:[quote('OIL','BRENT-1',.34,1),quote('OIL','BRENT-1',.12,0),quote('OIL','BRENT-2',.9,1),quote('OIL','BRENT-2',.5,1),quote('AAPL-S','CALL',.97,1),quote('UNTAGGED','X',.9,0)]});
 holdings.mockResolvedValue({holdings:[{symbol:'AAPL',valueUsd:100}]});
 const d=await trackRatings('owner');
 // 0.34 that happened is a miss for the favoured side; an even quote favours neither.
 expect(d.themes.find(t=>t.id==='oil')?.rating).toMatchObject({evaluated:3,matched:2,tied:1,eventCount:2,missing:0,excluded:0,accuracy:2/3,grade:null,label:'Limited history'});
 expect(d.companies.find(c=>c.symbol==='AAPL')?.rating).toMatchObject({evaluated:1,matched:1,accuracy:1});
 expect(d.asOf).toBe('2026-10-10T12:00:00.000Z');
 const sql=query.mock.calls.map(([statement])=>String(statement));
 expect(sql.find(statement=>read(statement)==='day')).toContain('s.prob_24h_before probability');
 expect(query.mock.calls.find(([statement])=>read(statement)==='day')?.[1]).toEqual([]);
 expect(sql.some(statement=>read(statement)==='other')).toBe(false);
 // The stores that were only ever a second copy are not read.
 expect(sql.some(statement=>/track_markets|track_quotes|track_company_series|track_benchmark_series/.test(statement))).toBe(false);
});
it('leaves out a quote published after a verified release, and counts a market as unscored only where no reading exists',async()=>{
 database({tags:[{series_ticker:'CPI',tag:'inflation'}],entities:[],day:[quote('CPI','CPI-AUG',.8,1),quote('CPI','CPI-AUG',.99,1,{known:true})],skips:[{series_ticker:'CPI',reason:'no_quote'},{series_ticker:'CPI',reason:'no_quote'},{series_ticker:'CPI',reason:'outcome_known'},{series_ticker:'OTHER',reason:'no_quote'}]});
 const d=await trackRatings('owner');
 expect(d.themes.find(t=>t.id==='inflation')?.rating).toMatchObject({evaluated:1,matched:1,missing:2,excluded:2});
 const [day,skips]=['day','skips'].map(kind=>String(query.mock.calls.find(([sql])=>read(sql)===kind)?.[0]));
 expect(day).toContain('(r.released_at IS NOT NULL AND r.released_at<=s.odds_time) known');
 expect(skips).toContain('NOT EXISTS(SELECT 1 FROM settled_markets s WHERE s.ticker=k.ticker)');
 expect(query.mock.calls.find(([sql])=>read(sql)==='skips')?.[1]).toEqual([24]);
});
it('names a holding from its Yahoo profile until the ticker catalogue has reached it',async()=>{
 await trackRatings('owner');
 const sql=String(query.mock.calls.find(([statement])=>read(statement)==='entities')?.[0]);
 expect(sql).toContain('FROM security_profiles p');
 expect(sql).toContain('NOT EXISTS(SELECT 1 FROM track_entities e WHERE e.symbol=p.symbol)');
 expect(sql).toContain(`CASE p.quote_type WHEN 'EQUITY' THEN 'company' WHEN 'INDEX' THEN 'index' ELSE 'fund' END`);
});

it('includes held companies without direct series and keeps their macro relevance separate',async()=>{
 holdings.mockResolvedValue({holdings:[{symbol:'OTHER0'},{symbol:'SPY'}]});links.mockResolvedValue(new Map([['CPI',[{symbol:'OTHER0',type:'Related',evidence:'Shared inflation topic'}]]]));
 database({tags:[{series_ticker:'CPI',tag:'inflation'}],entities:[{symbol:'OTHER0',name:'Held company',kind:'company'},{symbol:'SPY',name:'Fund',kind:'fund'}]});
 const d=await trackRatings('owner');expect(d.companies.map(c=>c.symbol)).toEqual(['OTHER0']);expect(d.companies[0].relatedThemes).toEqual(['Inflation']);expect(d.companies[0].rating.accuracy).toBeNull();
});
it('puts usable theme and company data first before paginating',async()=>{
 database({tags:[{series_ticker:'OIL',tag:'oil'},{series_ticker:'Z-S',tag:'OTHER11'}],entities:Array.from({length:12},(_,i)=>({symbol:`OTHER${i}`,name:`Other company ${i}`,kind:'company'})),
  day:[quote('Z-S','E',.75,1),quote('OIL','E2',.25,0),quote('OIL','E3',.25,0)]});
 const d=await trackRatings('owner',24,1,'other');expect(d.themes[0].name).toBe('Oil');expect(d.companies[0].symbol).toBe('OTHER11');expect(d.companies).toHaveLength(10);
});
it('scores SPY using explicit benchmark questions, keeps funds separate and scopes portfolio values',async()=>{
 holdings.mockResolvedValue({holdings:[{symbol:'SPY',valueUsd:4000},{symbol:'TLT',valueUsd:1000},{symbol:'AAPL',valueUsd:5000}]});
 // The benchmark is the reviewed list of index-price series, whatever else is tagged with the fund.
 expect(SP500_BENCHMARK_SERIES).toEqual(['KXINX','KXINXU','KXINXAB','KXINXW','KXINXM','KXINXY']);
 database({tags:[{series_ticker:'CPI',tag:'inflation'},{series_ticker:'KXSP500ADDQ',tag:'SPY'}],entities:[{symbol:'SPY',name:'S&P ETF',kind:'fund'},{symbol:'TLT',name:'Treasury ETF',kind:'fund'},{symbol:'AAPL',name:'Apple',kind:'company'}],
  day:[quote('KXINXY','E',.75,1),quote('CPI','CPI',.75,1),quote('KXSP500ADDQ','ADD',.9,0)]});
 const d=await trackRatings('owner');expect(d.funds[0]).toMatchObject({id:'sp500',rating:{accuracy:1,evaluated:1},linkedHoldings:[{symbol:'SPY',valueUsd:4000,share:.4}]});expect(d.funds.find(f=>f.symbol==='TLT')?.rating.accuracy).toBeNull();expect(d.companies.some(c=>c.symbol==='SPY'||c.symbol==='TLT')).toBe(false);expect(d.themes.some(c=>c.symbol==='SPY'||c.symbol==='TLT')).toBe(false);
});

it('orders the records by history, accuracy or name, with unscored records last when ordered by accuracy',async()=>{
 const tags=['oil','fed-rates','inflation'].map(tag=>({series_ticker:tag.toUpperCase(),tag}));
 // Oil: 3 of 4 right. Fed rates: 2 of 2. Inflation: 1 of 3. The other themes have nothing.
 const day=[quote('OIL','a',.8,1),quote('OIL','b',.8,1),quote('OIL','c',.8,1),quote('OIL','d',.8,0),quote('FED-RATES','e',.2,0),quote('FED-RATES','f',.7,1),quote('INFLATION','g',.6,1),quote('INFLATION','h',.6,0),quote('INFLATION','i',.6,0)];
 database({tags,entities:[],day});
 const names=async(sort?:'history'|'accuracy-high'|'accuracy-low'|'name')=>(await trackRatings('owner',24,1,'',1,{sort})).themes.map(theme=>theme.name);
 const unscored=['Direct company markets','Stock market','Treasury yields'];
 expect(await names()).toEqual(['Oil','Inflation','Fed rates',...unscored]);
 expect(await names('history')).toEqual(await names());
 expect(await names('accuracy-high')).toEqual(['Fed rates','Oil','Inflation',...unscored]);
 expect(await names('accuracy-low')).toEqual(['Inflation','Oil','Fed rates',...unscored]);
 expect(await names('name')).toEqual(['Direct company markets','Fed rates','Inflation','Oil','Stock market','Treasury yields']);
});
it('keeps only the chosen grade or the records with history, before paging',async()=>{
 const graded=(series:string,right:number)=>Array.from({length:40},(_,i)=>quote(series,`${series}-${i}`,.8,i<right?1:0));
 database({tags:[{series_ticker:'OIL',tag:'oil'},{series_ticker:'CPI',tag:'inflation'},{series_ticker:'FED',tag:'fed-rates'},...Array.from({length:12},(_,i)=>({series_ticker:`S${i}`,tag:`OTHER${i}`}))],
  entities:Array.from({length:12},(_,i)=>({symbol:`OTHER${i}`,name:`Other company ${i}`,kind:'company'})),
  // Oil earns an A, inflation a C; Fed rates has one question, too few for a grade. Three companies have history.
  day:[...graded('OIL',38),...graded('CPI',24),quote('FED','x',.8,1),...['S3','S7','S9'].flatMap(series=>graded(series,36))]});
 const themes=async(view:Parameters<typeof trackRatings>[5])=>(await trackRatings('owner',24,1,'other',1,view)).themes.map(theme=>`${theme.name}:${theme.rating.grade}`);
 expect(await themes({grade:'A'})).toEqual(['Direct company markets:A','Oil:A']);
 expect(await themes({grade:'C'})).toEqual(['Inflation:C']);
 expect(await themes({grade:'D'})).toEqual([]);
 expect(await themes({grade:'none'})).toEqual(['Fed rates:null','Stock market:null','Treasury yields:null']);
 // Most questions first; Inflation and Oil have forty each, so the name decides between them.
 expect(await themes({scored:true})).toEqual(['Direct company markets:A','Inflation:C','Oil:A','Fed rates:null']);
 expect(await themes({grade:'none',scored:true})).toEqual(['Fed rates:null']);
 // Companies are narrowed before they are counted and paged.
 const all=await trackRatings('owner',24,1,'other');expect([all.totalCompanies,all.companies.length]).toEqual([12,10]);
 const scored=await trackRatings('owner',24,1,'other',1,{scored:true,sort:'name'});
 expect([scored.totalCompanies,scored.page,scored.companies.map(company=>company.symbol)]).toEqual([3,1,['OTHER3','OTHER7','OTHER9']]);
 expect((await trackRatings('owner',24,2,'other',1,{scored:true})).page).toBe(1);
});
it('paginates funds independently of company pages',async()=>{
 holdings.mockResolvedValue({holdings:Array.from({length:12},(_,i)=>({symbol:`FUND${i}`,valueUsd:100}))});
 database({entities:Array.from({length:12},(_,i)=>({symbol:`FUND${i}`,name:`Fund ${i}`,kind:'fund'}))});
 const d=await trackRatings('owner',24,1,'',2);expect(d.totalFunds).toBe(13);expect(d.fundPage).toBe(2);expect(d.funds).toHaveLength(3);expect(d.page).toBe(1);expect(d.companies).toEqual([]);
});
