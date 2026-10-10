import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TrackRecord,RatingCard} from './screens/track-record';
import {historicalRating} from '../../server/src/math/historical-rating';
it('exposes separate asset, company and fund tabs and defaults to 24 hours before trading close',()=>{
 const html=renderToStaticMarkup(<TrackRecord/>);expect(html).toContain('Asset holdings');expect(html).toContain('Companies');expect(html).toContain('ETFs &amp; index funds');expect(html).toContain('value="24" selected');expect(html).toContain("before you put weight on today&#x27;s odds");expect(html).not.toContain('<table');expect(html).toContain('1 hour before trading close');
});
it('keeps a small observed percentage ungraded and explains the actual holding relationship',()=>{
 const html=renderToStaticMarkup(<RatingCard item={{id:'oil',name:'Oil',rating:historicalRating([{event:'e',bid:.7,ask:.8,outcome:1,status:'quoted'}]),linkedHoldings:[{symbol:'XOM',type:'Related',evidence:'Shared oil topic'}]}}/>);
 expect(html).toContain('100.0%');expect(html).toContain('Limited history');expect(html).toContain('Shared oil topic');expect(html).not.toContain('Always right');
});

import {filterLinkedHoldings,HoldingDisclosure} from './screens/track-record';
it('searches linked holdings by name or ticker and displays entered amounts and portfolio shares',()=>{
 const links=[{symbol:'SPY',name:'S&P 500 ETF',valueUsd:4000,share:.4,type:'Related' as const,evidence:'Index benchmark'},{symbol:'AAPL',name:'Apple Inc.',valueUsd:1250,share:.125,type:'Direct' as const,evidence:'Company'}];
 expect(filterLinkedHoldings(links,' apple ')).toEqual([links[1]]);expect(filterLinkedHoldings(links,'spy')).toEqual([links[0]]);expect(filterLinkedHoldings(links,'absent')).toEqual([]);
 const html=renderToStaticMarkup(<HoldingDisclosure name="Index" holdings={links}/>);expect(html).toContain('$4,000.00');expect(html).toContain('40.0% of portfolio');expect(html).toContain('Search holdings for Index');expect(html).toContain('Scroll within this list');expect(html).toContain('values you entered');
});
