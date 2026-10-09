'use client';
import { useState, useEffect } from 'react';
import { AddHoldings } from './screens/holdings';
import { Overview } from './screens/overview';
import { Calendar } from './screens/calendar';
import { EventPage } from './screens/event';
import { Moves } from './screens/moves';
import { Earnings } from './screens/earnings';
import { TrackRecord } from './screens/track-record';

export default function Hedgehog() { const [route, setRoute] = useState('holdings'), [id, setId] = useState(''); useEffect(() => { function change() { const [screen, ticker] = window.location.hash.slice(1).split('/'); setRoute(screen || 'holdings'); try {
    setId(decodeURIComponent(ticker ?? ''));
}
catch {
    setId('');
} window.scrollTo(0, 0); } change(); window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []); const tabs = [['overview', 'Overview'], ['calendar', 'Calendar'], ['earnings', 'Earnings'], ['moves', 'Moves'], ['track-record', 'Track record']]; return <><header><a className="brand" href="#holdings"><svg width="32" height="28" viewBox="0 0 32 28" aria-hidden="true"><path d="M4 23a12 12 0 0124 0H4M9 10L6 4m10 4V1m7 9l4-6M20 18h1" fill="none" stroke="#5AA2FF" strokeWidth="2.5" strokeLinecap="round"/></svg>Hedgehog</a><nav aria-label="Main navigation">{tabs.map(([key, label]) => <button key={key} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined} onClick={() => { window.location.hash = key; }}>{label}</button>)}</nav><span className="chip Related">Read-only market insights</span></header><main>{route === 'holdings' ? <AddHoldings /> : route === 'overview' ? <Overview /> : route === 'calendar' ? <Calendar /> : route === 'event' ? <EventPage ticker={id}/> : route === 'moves' ? <Moves /> : route === 'earnings' ? <Earnings /> : route === 'track-record' ? <TrackRecord /> : <AddHoldings />}</main><footer>Not financial advice. Odds from Kalshi. Price history from Yahoo Finance and FRED.</footer></>; }
