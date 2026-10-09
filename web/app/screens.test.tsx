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
import {SignInForm} from './screens/account';
it('renders every screen without fabricated market data',()=>{
 for(const screen of [<AddHoldings/>,<Overview/>,<Calendar/>,<EventPage ticker="unconfigured"/>,<Moves/>,<Earnings/>,<TrackRecord/>]){
  const html=renderToStaticMarkup(screen);
  expect(html).toContain('<h1>');
  expect(html).not.toContain('Sample data');
 }
 expect(renderToStaticMarkup(<Hedgehog/>)).toContain('Not financial advice. Odds from Kalshi.');
});
it('renders accessible account forms and explains guest portfolio ownership',()=>{
 const signup=renderToStaticMarkup(<SignInForm signup onSuccess={()=>{}}/>);
 expect(signup).toContain('Create an account');
 expect(signup).toContain('autoComplete="new-password"');
 expect(signup).toContain('Save my guest portfolio');
 expect(signup).toContain('minLength="15"');
 const signin=renderToStaticMarkup(<SignInForm signup={false} onSuccess={()=>{}}/>);
 expect(signin).toContain('autoComplete="current-password"');
 expect(signin).not.toContain('Confirm password');
 const holdings=renderToStaticMarkup(<AddHoldings user={{id:'test',email:'alex@example.com',name:'Alex',createdAt:'2026-01-01T00:00:00Z'}}/>);
 expect(holdings).toContain('alex@example.com');
 expect(holdings).toContain('from your account on every device');
});
