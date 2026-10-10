import {it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {HistoricalEvent} from './screens/holdings-history';import type {HoldingEventHistory} from '../../shared/types';
it('shows observed returns with benchmark and keeps missing release timing explicit',()=>{
 const e:HoldingEventHistory={eventTicker:'event',seriesTicker:'series',title:'CPI release',subjects:['Inflation'],release:null,windowNote:'Release time has not been verified.',spyMove:null,predictions:[{ticker:'contract',title:'CPI above threshold?',probability:.7,outcome:1,quoteAt:'2026-09-10T12:30:00Z',closeAt:'2026-09-11T12:30:00Z',predatesRelease:null}],outcome:{contracts:1,yes:1,biggestMiss:null},holdings:[{symbol:'TLT',type:'Related',evidence:'Shared reviewed inflation tag',measuredAt:null,moveNote:null,move:null,vsSpy:null}]};
 const html=renderToStaticMarkup(<HistoricalEvent event={e}/>);expect(html).toContain('Release time not verified');expect(html).toContain('70.0%');expect(html).toContain('SPY, same dates');expect(html).toContain('Unavailable');expect(html).not.toContain('>0.0%</td>');expect(html).toContain('historical dollar profit');expect(html).toContain('1 of 1 contracts resolved Yes');expect(html).toContain('no price comparison');
});

it('shows each holding against SPY and names the largest miss',()=>{
 const move={beforeDate:'2026-09-10',afterDate:'2026-09-11',beforeClose:100,afterClose:105,change:.05};
 const e:HoldingEventHistory={eventTicker:'e',seriesTicker:'s',title:'CPI',subjects:['Inflation'],release:{at:'2026-09-11T12:30:00Z',sourceUrl:'https://www.bls.gov/x'},windowNote:null,spyMove:{...move,afterClose:102,change:.02},predictions:[],outcome:{contracts:4,yes:1,biggestMiss:{title:'CPI above 0.4%?',probability:.8,outcome:0}},holdings:[{symbol:'TLT',type:'Measured',evidence:'x',measuredAt:null,moveNote:null,move,vsSpy:.03}]};
 const html=renderToStaticMarkup(<HistoricalEvent event={e}/>);
 expect(html).toContain('+3.00 pts');expect(html).toContain('+5.00%');expect(html).toContain('CPI above 0.4%?');expect(html).toContain('resolved No');
});
