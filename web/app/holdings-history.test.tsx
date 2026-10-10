import {it,expect} from 'vitest';import {renderToStaticMarkup} from 'react-dom/server';
import {HistoricalEvent} from './screens/holdings-history';import type {HoldingEventHistory} from '../../shared/types';
it('shows observed returns with benchmark and keeps missing release timing explicit',()=>{
 const e:HoldingEventHistory={eventTicker:'event',seriesTicker:'series',title:'CPI release',subjects:['Inflation'],release:null,windowNote:'Release time has not been verified.',spyMove:null,predictions:[{ticker:'contract',title:'CPI above threshold?',probability:.7,outcome:1,quoteAt:'2026-09-10T12:30:00Z',closeAt:'2026-09-11T12:30:00Z',predatesRelease:null}],holdings:[{symbol:'TLT',type:'Related',evidence:'Shared reviewed inflation tag',measuredAt:null,moveNote:null,move:null}]};
 const html=renderToStaticMarkup(<HistoricalEvent event={e}/>);expect(html).toContain('Release time not verified');expect(html).toContain('70.0%');expect(html).toContain('SPY, same dates');expect(html).toContain('Unavailable');expect(html).not.toContain('>0.0%</td>');expect(html).toContain('historical dollar profit');
});
