'use client';
import { useState, useEffect } from 'react';
import { AddHoldings } from './screens/holdings';
import { Overview } from './screens/overview';
import { Calendar } from './screens/calendar';
import { EventPage } from './screens/event';
import { Moves } from './screens/moves';
import { Earnings } from './screens/earnings';
import { TrackRecord } from './screens/track-record';
import { AccountProvider, useAccount } from './auth';
import { AccountScreen } from './screens/account';
import { Brokerages } from './screens/brokerages';
import { useData } from './common';
import { LoadingSkeleton } from './loading-skeleton';
import type { HealthResponse } from '../../shared/types';

export default function Hedgehog() {
    return <AccountProvider><Shell/></AccountProvider>;
}

function Shell() {
    const { session, checking, error, notice, refresh } = useAccount();
    const health = useData<HealthResponse>('/health');
    const [route, setRoute] = useState('holdings'), [id, setId] = useState('');
    useEffect(() => {
        function change() {
            const [screen, ticker] = window.location.hash.slice(1).split('/');
            setRoute(screen || 'holdings');
            try { setId(decodeURIComponent(ticker ?? '')); }
            catch { setId(''); }
            window.scrollTo(0, 0);
        }
        change();
        window.addEventListener('hashchange', change);
        return () => window.removeEventListener('hashchange', change);
    }, []);

    const tabs = [['brokerages', 'Brokerages'], ['overview', 'Overview'], ['calendar', 'Calendar'], ['earnings', 'Earnings'], ['moves', 'Moves'], ['track-record', 'Track record']];
    let screen;
    switch (route) {
        case 'signup': case 'signin': case 'account': screen = <AccountScreen signup={route === 'signup'}/>; break;
        case 'brokerages': screen = <Brokerages/>; break;
        case 'overview': screen = <Overview/>; break;
        case 'calendar': screen = <Calendar/>; break;
        case 'event': screen = <EventPage ticker={id}/>; break;
        case 'moves': screen = <Moves/>; break;
        case 'earnings': screen = <Earnings/>; break;
        case 'track-record': screen = <TrackRecord initialView={id}/>; break;
        default: screen = <AddHoldings user={session?.user}/>;
    }
    return <>
        <header>
            <a className="brand" href="#holdings">
                <svg width="32" height="28" viewBox="0 0 32 28" aria-hidden="true"><path d="M4 23a12 12 0 0124 0H4M9 10L6 4m10 4V1m7 9l4-6M20 18h1" fill="none" stroke="#5AA2FF" strokeWidth="2.5" strokeLinecap="round"/></svg>
                Hedgehog
            </a>
            <nav aria-label="Main navigation">{tabs.map(([key, label]) =>
                <button key={key} className={route === key ? 'active' : ''} aria-current={route === key ? 'page' : undefined} onClick={() => { window.location.hash = key; }}>{label}</button>
            )}</nav>
            <div className="account-nav">{session?.user ?
                <a className="account-link" href="#account">{session.user.name} · Account</a> :
                <><a className="account-link" href="#signin">Sign in</a><a className="account-link" href="#signup">Create account</a></>
            }</div>
        </header>
        <main>
            {health.data?.readOnly && <p className="account-notice" role="status">The database is read-only right now. You are seeing saved data: odds are not updating and changes cannot be saved.</p>}
            {notice && <p className="account-notice" role="status">{notice}</p>}
            {checking ? <LoadingSkeleton layout="summary" label="Loading your session"/> : error ?
                <div><p role="alert" className="error">{error}</p><button onClick={() => void refresh()}>Retry connection</button></div> :
                <div key={session?.sessionKey}>{screen}</div>
            }
        </main>
        <footer>Not financial advice. Odds from Kalshi. Price history from Yahoo Finance and FRED.</footer>
    </>;
}
