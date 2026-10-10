'use client';
import { useState } from 'react';
import type { MovesResponse } from '../../../shared/types';
import { money, percent, number, href, useData, Card, Fresh, Status, Empty, ReloadButton } from '../common';

export function Moves() {
    const [search, setSearch] = useState('');
    const [date, setDate] = useState('');
    const { data, error, reload } = useData<MovesResponse>(date ? `/moves?date=${date}` : '/moves');
    const visibleHoldings = data?.holdings.filter(h => h.symbol.toLowerCase().includes(search.trim().toLowerCase())) ?? [];
    return <>
        <div className="row">
            <div><h1>What moved your portfolio</h1><p>Whole market, your individual stocks, and events that moved the same day</p></div>
            <label>Price date<input type="date" value={date || data?.date || ''} onChange={e => setDate(e.target.value)}/></label>
        </div>
        <div className="actions"><ReloadButton onReload={() => reload()}/>
            <button disabled={!date} onClick={() => setDate('')}>Latest trading session</button>
        </div>
        <Status error={error} loading={!data && !error}/><Fresh asOf={data?.asOf ?? null}/>
        {data && <>
            {data.notes.map(note => <p className="note" key={note}>{note}</p>)}
            <p className="note">Price session: <time dateTime={data.date}>{data.date}</time>. An explicitly selected date uses only that session.</p>
            <div className="stats">
                <Card><span className="muted">Portfolio dollar move</span><strong className={`number ${data.total !== null && data.total < 0 ? 'orange' : 'blue'}`}>{money(data.total)}</strong></Card>
                <Card><span className="muted">Estimated market component</span><strong className="number">{money(data.fromMarket)}</strong></Card>
                <Card><span className="muted">Beyond the market</span><strong className="number">{money(data.beyondMarket)}</strong></Card>
                <Card><span className="muted">SPY daily return</span><strong className="number">{percent(data.spyReturn)}</strong></Card>
            </div>
            <Card><h2>By holding</h2>
                <label className="move-search">Search holdings<input type="search" placeholder="Ticker, e.g. AAPL" value={search} onChange={e => setSearch(e.target.value)}/></label>
                <p className="note">Search filters the rows below. Totals above cover your full portfolio.</p>
                {!data.holdings.length ? <Empty>Add holdings to see their daily moves.</Empty> : <div className="scroll"><table>
                    <thead><tr>{['Holding', 'Measured beta', 'Dollar move', 'From market', 'Beyond market', 'Data availability'].map(t => <th key={t}>{t}</th>)}</tr></thead>
                    <tbody>{visibleHoldings.map(h => <tr key={h.symbol}>
                        <td>{h.symbol}</td><td className="amount">{number(h.beta, 3)}</td><td className="amount">{money(h.actual)}</td>
                        <td className="amount">{money(h.fromMarket)}</td><td className="amount">{money(h.beyondMarket)}</td>
                        <td>{h.actual !== null && h.previousDate && <p className="note">Source closes: {h.previousDate} → {h.sourceDate}.</p>}{h.unavailableReasons.length ? h.unavailableReasons.join(' ') : 'Closing prices and measured beta available.'}</td>
                    </tr>)}{!visibleHoldings.length && <tr><td colSpan={6}><Empty>No holdings match your search.</Empty></td></tr>}</tbody>
                </table></div>}
                <p className="note">From market = measured beta × SPY return × entered holding value. Beyond market = actual move − market component. Price sources: Yahoo daily closes. Beta uses up to five years of aligned daily returns. Missing history leaves only the unsupported results unavailable.</p>
                {data.holdings.length > 0 && data.total === null && <p className="note">The portfolio total needs supported price moves over the same dates for every holding. Available individual moves are shown above.</p>}
            </Card>
            <h2>Kalshi markets that moved the same day</h2><p>Moving together is not proof of cause. Historical associations appear only for Measured links.</p>
            {data.oddsMoves.length ? data.oddsMoves.map(m => <Card key={m.ticker}>
                <div className="row"><a className="event-title" href={href('event', m.ticker)}>{m.title}</a><strong className="mono blue">{number(m.changePoints)} pts</strong></div>
                {m.links.map(l => <p key={l.symbol}><span className={`chip ${l.type}`}>{l.type}</span> {l.symbol} · {l.type === 'Measured' ? l.evidence : 'This event moved the same day; no connection to the holding’s move is inferred.'}</p>)}
            </Card>) : <Card><Empty>No linked markets with a supported move of at least 3 points in this window.</Empty></Card>}
        </>}
    </>;
}
