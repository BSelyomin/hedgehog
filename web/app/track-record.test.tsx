import {it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {CategoryEvidence,ThemeOverview,ThemeConnections,visibleThemes,TrackRecord} from './screens/track-record';import type {CategoryRecord,HistorySubject} from '../../shared/types';
it('renders low-sample warnings, bucket counts and market-level evidence',()=>{
 const c:CategoryRecord={category:'Economics',count:2,avgMiss:20,brier:.29,firstClose:'2026-10-01T00:00:00Z',lastClose:'2026-10-02T00:00:00Z',eligibleForTrust:false,relevantHoldings:['TLT'],eventCount:1,baseRateBrier:.25,coverage:{scored:2,noQuote:3,outcomeKnown:1},headline70:{count:2,observedRate:null,low:null,high:null},buckets:[{low:.6,high:.7,count:2,meanProb:.65,observedRate:.5}],examples:[{ticker:'verified-market',title:'An actual question',probability:.65,outcome:1,closeTime:'2026-10-02T00:00:00Z',oddsTime:'2026-10-01T00:00:00Z'}]};
 const html=renderToStaticMarkup(<CategoryEvidence category={c} minSettled={30}/>);expect(html).toContain('early sample');expect(html).toContain('30-market threshold');expect(html).toContain('An actual question');expect(html).toContain('65.0%');expect(html).toContain('Only 2 markets');expect(html).not.toContain('Actually happened</span>');expect(html).toContain('1 distinct events');expect(html).toContain('0.250');expect(html).toContain('2 of 6 settled markets scored');expect(html).toContain('3 had no bid–ask quote');expect(html).toContain('already happened');expect(html).toContain('What happened');expect(html).toContain('Explore the details');expect(html).not.toContain('<details open');expect(html).toContain('independent events');
});
it('preserves the purpose and offers four explicit close-based horizons',()=>{
 const html=renderToStaticMarkup(<TrackRecord/>);
 expect(html).toContain("See how earlier Kalshi predictions compared with real outcomes, before you put weight on today&#x27;s odds.");
 expect(html).toContain('30 days before trading close');expect(html).toContain('7 days before trading close');expect(html).toContain('24 hours before trading close');expect(html).toContain('1 hour before trading close');
 expect(html).toContain('Portfolio relevance');expect(html).toContain('By Market');expect(html).toContain('By Holding');
});
it('filters whole theme records by reviewed holdings links without pooling their statistics',()=>{
 const themes=[{id:'oil',title:'Oil',record:null,seriesTickers:['OIL'],eventCount:0,unknownEventMarkets:0,kalshiCategories:[],linkedHoldings:[{symbol:'XOM',type:'Direct',evidence:'Reviewed company series'}]},{id:'credit',title:'Credit',record:null,seriesTickers:[],eventCount:0,unknownEventMarkets:0,kalshiCategories:[],linkedHoldings:[]}] as HistorySubject[];
 expect(visibleThemes(themes,true).map(s=>s.id)).toEqual(['oil']);expect(visibleThemes(themes,false)).toHaveLength(2);
 const html=renderToStaticMarkup(<ThemeOverview themes={themes} horizonHours={720} relevant={false} select={()=>{}}/>);
 expect(html).toContain('No usable history at this horizon yet');expect(html).not.toContain('0.0%');
 const connections=renderToStaticMarkup(<ThemeConnections subject={themes[0]} events={[]}/>);
 expect(connections).toContain('XOM');expect(connections).toContain('Reviewed company series');
});
it('shows the 65–75% rate with its plausible range once enough markets support it',()=>{
 const c:CategoryRecord={category:'Economics',count:40,avgMiss:5,brier:.2,firstClose:null,lastClose:null,eligibleForTrust:true,relevantHoldings:[],eventCount:12,baseRateBrier:.24,coverage:{scored:40,noQuote:0,outcomeKnown:0},headline70:{count:10,observedRate:.7,low:.397,high:.892},buckets:[],examples:[]};
 const html=renderToStaticMarkup(<CategoryEvidence category={c} minSettled={30}/>);expect(html).toContain('70.0%');expect(html).toContain('39.7%');expect(html).toContain('89.2%');expect(html).toContain('12 distinct events');expect(html).toContain('No unscored markets have been recorded');
});
import {TrustExplainer} from './screens/track-record';
it('explains the trust parts and bands from server values',()=>{
 const html=renderToStaticMarkup(<TrustExplainer t={{spread:30,activity:25,depth:20,trackRecord:25,high:80,medium:60}} minSettled={30}/>);
 expect(html).toContain('0 to 100');expect(html).toContain('High 80 or more');expect(html).toContain('Medium 60–79');expect(html).toContain('at least 30 settled markets');
});
import {contextLine} from './screens/track-record';import type {TrackRecordResponse} from '../../shared/types';
it('describes what each tab and topic is showing in plain language',()=>{
 const data={totalMarkets:120,reviewedSeries:9} as TrackRecordResponse;
 expect(contextLine('accuracy',data)).toContain('all 120 settled markets');
 expect(contextLine('holdings',data)).toContain('across all topics');
 expect(contextLine('holdings',data,{id:'rates',title:'Interest rates'} as any)).toContain('about interest rates');
 expect(contextLine('accuracy',data,{id:'rates',title:'Interest rates',record:{count:14}} as any)).toContain('the 14 settled markets about interest rates');
});

it('limits holding relevance to the selected stock or ETF without changing the market record',()=>{
 const record={count:126} as CategoryRecord;
 const subjects=[{id:'inflation',title:'Inflation',seriesTickers:['CPI'],record,eventCount:49,unknownEventMarkets:0,kalshiCategories:['Economics'],linkedHoldings:[{symbol:'SPY',type:'Related',evidence:'Reviewed inflation tag'},{symbol:'TLT',type:'Measured',evidence:'Measured driver association'}]}] as HistorySubject[];
 expect(visibleThemes(subjects,true,['SPY'])[0].record).toBe(record);
 expect(visibleThemes(subjects,true,['AAPL'])).toEqual([]);
 const html=renderToStaticMarkup(<ThemeConnections subject={subjects[0]} events={[]} symbols={['SPY']}/>);
 expect(html).toContain('SPY');expect(html).toContain('Reviewed inflation tag');expect(html).not.toContain('TLT');
});
