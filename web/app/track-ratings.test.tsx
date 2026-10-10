import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TrackRecord,RatingCard,FundPosition} from './screens/track-record';
import {TRACK_SORTS} from '../../shared/types';
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
 const html=renderToStaticMarkup(<HoldingDisclosure name="Index" holdings={links}/>);expect(html).toContain('$4,000.00');expect(html).toContain('40.0% of portfolio');expect(html).toContain('Search holdings for Index');expect(html).toContain('values you entered');
 // Every holding is laid out in the open; the list no longer scrolls inside a small box.
 expect(html).toContain('<p class="note" role="status">2 of 2 holdings');expect(html).toContain('<ul class="rating-holding-list" aria-label="Index linked holdings">');expect(html).not.toMatch(/Scroll within this list|rating-holdings-scroll/);
});
const rated=historicalRating([{event:'e',probability:.8,outcome:1,status:'quoted'}]);
it('opens a record’s linked holdings across the whole card, not inside its last column',()=>{
 const html=renderToStaticMarkup(<RatingCard item={{id:'oil',name:'Oil',rating:rated,linkedHoldings:[{symbol:'XOM',type:'Related',evidence:'Shared oil topic'}]}}/>);
 // The disclosure is a child of the card itself, after the three columns.
 expect(html).toMatch(/<div class="rating-context">.*?<\/div><details class="rating-disclosure"><summary>Related to 1 of your holdings<\/summary>/s);
 expect(html).toMatch(/<\/details><\/section>$/);
});
it('states a fund’s position plainly, since a fund is the holding and not related to it',()=>{
 const fund=renderToStaticMarkup(<RatingCard item={{id:'TLT',symbol:'TLT',name:'Treasury ETF',kind:'fund',scope:'Questions directly about this fund or index',rating:rated,linkedHoldings:[{symbol:'TLT',type:'Related',evidence:'This fund is a saved portfolio holding.',valueUsd:10000,share:.0235}]}}/>);
 expect(fund).not.toMatch(/Related to \d+ of your holdings|rating-disclosure/);
 expect(fund).toContain('<p class="note rating-position">You hold this fund: <strong class="mono">$10,000.00</strong> · 2.4% of portfolio. The record covers only questions about this fund itself, never broad rate or inflation questions.</p>');
 const benchmark=renderToStaticMarkup(<RatingCard item={{id:'sp500',name:'S&P 500',kind:'benchmark',scope:'S&P 500 index-level predictions',rating:rated,linkedHoldings:[{symbol:'SPY',type:'Related',evidence:'SPY tracks the S&P 500.',valueUsd:4000,share:.4}]}}/>);
 expect(benchmark).not.toContain('Related to');
 expect(benchmark).toContain('Tracked by <strong>SPY</strong>, which you hold: <strong class="mono">$4,000.00</strong> · 40.0% of portfolio. The record rates questions about the index, not the fund’s share price.');
 // Not held, and a holding with no amount entered.
 expect(renderToStaticMarkup(<FundPosition item={{id:'sp500',name:'S&P 500',kind:'benchmark',rating:rated,linkedHoldings:[]}}/>)).toBe('<p class="note">You hold no fund that tracks this index.</p>');
 expect(renderToStaticMarkup(<FundPosition item={{id:'GLD',symbol:'GLD',name:'Gold',kind:'fund',rating:rated,linkedHoldings:[{symbol:'GLD',type:'Related',evidence:'',valueUsd:null,share:null}]}}/>)).toContain('You hold this fund. The record covers only');
});
it('offers an order, a grade and a history filter above the records',()=>{
 const html=renderToStaticMarkup(<TrackRecord/>);
 expect(TRACK_SORTS.map(sort=>sort.key)).toEqual(['history','accuracy-high','accuracy-low','name']);
 expect(html).toContain('<select aria-label="Sort by"><option value="history" selected="">Most questions scored</option><option value="accuracy-high">Highest accuracy</option><option value="accuracy-low">Lowest accuracy</option><option value="name">Name, A to Z</option></select>');
 expect(html).toContain('<select aria-label="Grade"><option value="" selected="">Any grade</option><option value="A">A · 90% or more</option>');
 expect(html).toContain('<option value="none">No grade yet</option>');
 expect(html).toContain('<input type="checkbox"/> Only records with history');
 // Nothing is narrowed to begin with, so there is nothing to clear.
 expect(html).not.toContain('Clear sorting and filters');
});
