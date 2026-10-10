'use client';
import { useState } from 'react';
import type { MovesResponse } from '../../../shared/types';
import { money, percent, number, href, useData, assetLabel, Card, Fresh, Status, Empty, LinkChip } from '../common';
import { describeLeadMove, driverName } from './sensitivity';

export function Moves() {
    const [search, setSearch] = useState('');
    // No date asks the server for the latest completed session, so the page never opens on a day whose close is not in yet.
    const [date, setDate] = useState('');
    const { data, error } = useData<MovesResponse>(date ? `/moves?date=${date}` : '/moves');
    const term = search.trim().toLowerCase();
    const rows = data?.holdings.filter(h => h.symbol.toLowerCase().includes(term)) ?? [];
    return <>
        <div className="row"><div><h1>What moved your portfolio</h1><p>Whole market, your individual stocks, and events that moved the same day</p></div><label>Price date<input type="date" value={date || data?.date || ''} onChange={e => setDate(e.target.value)}/></label></div>
        <Status error={error} loading={!data && !error}/><Fresh asOf={data?.asOf ?? null}/>
        {data && <>
            <div className="stats">
                <Card><span className="muted">Portfolio dollar move</span><strong className={`number ${data.total !== null && data.total < 0 ? 'orange' : 'blue'}`}>{money(data.total)}</strong></Card>
                <Card><span className="muted">Estimated market component</span><strong className="number">{money(data.fromMarket)}</strong></Card>
                <Card><span className="muted">Beyond the market</span><strong className="number">{money(data.beyondMarket)}</strong></Card>
                <Card><span className="muted">SPY daily return</span><strong className="number">{percent(data.spyReturn)}</strong></Card>
            </div>
            <LeadDrivers data={data}/>
            <Card><h2>By holding</h2>
                <label className="move-search">Search holdings<input type="search" placeholder="Ticker, e.g. AAPL" value={search} onChange={e => setSearch(e.target.value)}/></label>
                <p className="note">Search filters the rows below. Totals above cover {data.unpricedValue > 0 ? `your listed securities; ${money(data.unpricedValue)} in cash, bonds held directly and property has no daily price and is left out` : 'your full portfolio'}.</p>
                <div className="scroll"><table><thead><tr>{['Holding', 'Measured beta', 'Dollar move', 'From market', 'Beyond market', 'Biggest measured driver'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>
                    {rows.map(h => h.assetType && h.assetType !== 'security' ? <tr key={h.symbol}><td>{h.symbol}<span className="note"> · {assetLabel[h.assetType]}</span></td><td colSpan={5} className="note">No daily price, so no daily move. Worth {money(h.valueUsd)} as entered.</td></tr> : <tr key={h.symbol}><td>{h.symbol}</td><td className="amount">{number(h.beta, 3)}</td><td className="amount">{money(h.actual)}</td><td className="amount">{money(h.fromMarket)}</td><td className="amount">{money(h.beyondMarket)}</td>
                        <td className={h.drivers[0] && h.drivers[0].driver !== 'SPY' ? 'driver-cell lead' : 'driver-cell'}>{h.drivers[0] ? <>{driverName(h.drivers[0].driver)} <span className="mono">{money(h.drivers[0].contribution)}</span></> : 'Unavailable'}</td></tr>)}
                    {!rows.length && <tr><td colSpan={6}><Empty>No holdings match your search.</Empty></td></tr>}
                </tbody></table></div>
                <p className="note">From market = measured beta × SPY return × entered holding value. Beyond market = actual move − market component. Price sources: Yahoo daily closes. Missing history leaves the result unavailable.</p>
                <p className="note">Biggest measured driver compares each driver’s estimated part of the move: its measured sensitivity × that day’s change × the holding’s value. It is highlighted when something other than the stock market mattered most.</p>
            </Card>
            <h2>Kalshi markets that moved the same day</h2>
            <p>Moving together is not proof of cause. Historical associations appear only for Related links, which are backed by price measurements.</p>
            {data.oddsMoves.length ? data.oddsMoves.map(m => <Card key={m.ticker}>
                <div className="row"><a className="event-title" href={href('event', m.ticker)}>{m.title}</a><strong className="mono blue">{number(m.changePoints)} pts</strong></div>
                {m.links.map(l => <p key={l.symbol}><LinkChip type={l.type}/> {l.symbol} · {l.type === 'Measured' ? l.evidence : 'This event moved the same day; no connection to the holding’s move is inferred.'}</p>)}
            </Card>) : <Card><Empty>No linked markets with a supported move of at least 3 points in this window.</Empty></Card>}
        </>}
    </>;
}

// Which driver accounted for the most on the day, across the whole portfolio.
export function LeadDrivers({ data }: { data: MovesResponse }) {
    const lead = describeLeadMove(data.drivers, money);
    return <Card className="lead-drivers"><h2>What mattered most</h2>
        {lead ? <>
            <p className="driver-lead">{lead}</p>
            <div className="driver-bars">{data.drivers.map((move, index) => <div key={move.driver} className={index === 0 ? 'driver-bar lead' : 'driver-bar'}>
                <span>{driverName(move.driver)}</span><strong className={`mono ${move.contribution < 0 ? 'orange' : 'blue'}`}>{money(move.contribution)}</strong>
            </div>)}</div>
        </> : <Empty>No measured driver could be compared for this date.</Empty>}
        {data.missingDrivers.length > 0 && <p className="note">Not compared, because this date’s change is not published yet: {data.missingDrivers.map(driverName).join(', ')}.</p>}
        <p className="note">Each figure is a holding’s measured sensitivity × the driver’s change that day × the holding’s value, summed over holdings. The market figure is measured on its own and the others with the market held fixed, so they are compared here, not added up.</p>
    </Card>;
}
