import {it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {CategoryEvidence} from './screens/track-record';import type {CategoryRecord} from '../../shared/types';
it('renders low-sample warnings, bucket counts and market-level evidence',()=>{
 const c:CategoryRecord={category:'Economics',count:2,avgMiss:20,brier:.29,firstClose:'2026-10-01T00:00:00Z',lastClose:'2026-10-02T00:00:00Z',eligibleForTrust:false,relevantHoldings:['TLT'],eventCount:1,baseRateBrier:.25,headline70:{count:2,observedRate:null,low:null,high:null},buckets:[{low:.6,high:.7,count:2,meanProb:.65,observedRate:.5}],examples:[{ticker:'verified-market',title:'An actual question',probability:.65,outcome:1,closeTime:'2026-10-02T00:00:00Z',oddsTime:'2026-10-01T00:00:00Z'}]};
 const html=renderToStaticMarkup(<CategoryEvidence category={c} minSettled={30}/>);expect(html).toContain('early sample');expect(html).toContain('30-market threshold');expect(html).toContain('An actual question');expect(html).toContain('65.0%');expect(html).toContain('Only 2 markets');expect(html).not.toContain('Actually happened</span>');expect(html).toContain('1 distinct events');expect(html).toContain('0.250');expect(html).toContain('What happened');expect(html).toContain('Explore the details');expect(html).not.toContain('<details open');expect(html).toContain('independent events');
});
it('shows the 65–75% rate with its plausible range once enough markets support it',()=>{
 const c:CategoryRecord={category:'Economics',count:40,avgMiss:5,brier:.2,firstClose:null,lastClose:null,eligibleForTrust:true,relevantHoldings:[],eventCount:12,baseRateBrier:.24,headline70:{count:10,observedRate:.7,low:.397,high:.892},buckets:[],examples:[]};
 const html=renderToStaticMarkup(<CategoryEvidence category={c} minSettled={30}/>);expect(html).toContain('70.0%');expect(html).toContain('39.7%');expect(html).toContain('89.2%');expect(html).toContain('12 distinct events');
});
