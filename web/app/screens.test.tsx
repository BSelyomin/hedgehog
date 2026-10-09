import {it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {AddHoldings} from './screens/holdings';
import {Overview} from './screens/overview';
import {Calendar} from './screens/calendar';
import {EventPage} from './screens/event';
import {Moves} from './screens/moves';
import {Earnings} from './screens/earnings';
import {TrackRecord} from './screens/track-record';
import Hedgehog from './hedgehog';
it('renders every screen without fabricated market data',()=>{
 for(const screen of [<AddHoldings/>,<Overview/>,<Calendar/>,<EventPage ticker="unconfigured"/>,<Moves/>,<Earnings/>,<TrackRecord/>]){
  const html=renderToStaticMarkup(screen);
  expect(html).toContain('<h1>');
  expect(html).not.toContain('Sample data');
 }
 expect(renderToStaticMarkup(<Hedgehog/>)).toContain('Not financial advice. Odds from Kalshi.');
});
