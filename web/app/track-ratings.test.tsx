import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TrackRecord,RatingCard} from './screens/track-record';
import {historicalRating} from '../../server/src/math/historical-rating';
it('exposes the two requested tabs and defaults to 24 hours before trading close',()=>{
 const html=renderToStaticMarkup(<TrackRecord/>);expect(html).toContain('Asset holdings');expect(html).toContain('Companies');expect(html).toContain('value="24" selected');expect(html).toContain("before you put weight on today&#x27;s odds");expect(html).not.toContain('<table');expect(html).toContain('1 hour before trading close');
});
it('keeps a small observed percentage ungraded and explains the actual holding relationship',()=>{
 const html=renderToStaticMarkup(<RatingCard item={{id:'oil',name:'Oil',rating:historicalRating([{event:'e',bid:.7,ask:.8,outcome:1,status:'quoted'}]),linkedHoldings:[{symbol:'XOM',type:'Related',evidence:'Shared oil topic'}]}}/>);
 expect(html).toContain('100.0%');expect(html).toContain('Limited history');expect(html).toContain('Shared oil topic');expect(html).not.toContain('Always right');
});
