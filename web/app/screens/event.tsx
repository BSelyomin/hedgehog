'use client';
import { useState } from 'react';
import type { EventResponse, HoldingLink, Market, OddsPoint } from '../../../shared/types';
import { money, percent, number, dateText, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, LinkChip, EventDate } from '../common';
import { describeImportance, describeSensitivity } from './sensitivity';

export function EventPage({ ticker }: {
    ticker: string;
}) {
    const { data, error } = useData<EventResponse>(`/event/${encodeURIComponent(ticker)}`);
    const [selection, setSelection] = useState('');
    const market = data?.event.markets.find(m => m.ticker === selection) ?? data?.event.markets[0];
    return <>
        {!data && <h1>Event details</h1>}
        <a href="#calendar">Calendar</a>
        <Status error={error} loading={!data && !error}/>
        {data && <>
            <h1>{data.event.title}</h1>
            <p><EventDate event={data.event} showYear/></p>
            <Fresh asOf={data.asOf}/>
            <div className="split">
                <div>
                    <Card>
                        <h2>What the market expects</h2>
                        {data.event.markets.map(m => <div className="event-row" key={m.ticker}>
                            <div className="row"><button onClick={() => setSelection(m.ticker)} aria-pressed={market?.ticker === m.ticker}>{m.subtitle || m.title}</button><span className="mono">{percent(m.probability)}</span></div>
                            {m.probability !== null && <Progress value={m.probability}/>}
                            <span className="note">Kalshi bid–ask midpoint</span> <TrustBadge market={m}/>
                        </div>)}
                        <p className="note">Each outcome shows its own midpoint. These quotes are not normalized.</p>
                        <h3>Past week · {market?.subtitle || market?.title}</h3>
                        <OddsChart points={data.history.filter(p => p.ticker === market?.ticker)}/>
                    </Card>
                    <Card>
                        <div className="row"><h2>Your holdings linked to this event</h2><span className="mono">{money(data.event.linkedValue)} · {percent(data.event.share)}</span></div>
                        {data.event.links.map(l => <LinkedHolding key={l.symbol} link={l}/>)}
                        <p className="note">Related links are measured against the underlying driver (oil, the 2-year Treasury yield or the S&P 500), not against the probability of this event. They describe past daily moves, not a forecast.</p>
                    </Card>
                </div>
                <div>
                    <Card><h2>Why this trust score</h2>{market && <TrustBreakdown market={market}/>}</Card>
                    {data.summary && <Card>
                        <h2>Why the odds moved</h2><span className="chip plain">AI summary</span>
                        <p>{data.summary.text}</p>
                        {data.summary.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}
                        <p className="note">Generated from linked reporting. Check the sources.</p>
                    </Card>}
                </div>
            </div>
        </>}
    </>;
}

export function LinkedHolding({ link }: { link: HoldingLink }) {
    const sentence = link.sensitivity && describeSensitivity(link.symbol, link.sensitivity);
    const importance = describeImportance(link);
    return <div className="event-row">
        <div className="row"><strong>{link.symbol} · <span className="mono">{money(link.valueUsd)}</span></strong><LinkChip type={link.type}/></div>
        {sentence && <p className="sensitivity-text">{sentence}</p>}
        {importance && <p className={importance.lead ? 'driver-lead' : 'driver-minor'}><span className="chip lead">{importance.lead ? 'Main driver' : 'Something else matters more'}</span> {importance.text}</p>}
        <p>{link.evidence}</p>
        {link.sensitivity && <p className="note mono">b {number(link.sensitivity.b, 4)} · 95% range [{number(link.sensitivity.low, 4)}, {number(link.sensitivity.high, 4)}] · {link.sensitivity.days} aligned days · driver {link.sensitivity.driver}<br/>Measured {dateText(link.sensitivity.computedAt)}</p>}
    </div>;
}

function TrustBreakdown({ market }: { market: Market }) {
    const parts = [['Spread', market.trust.spread, 30], ['Activity', market.trust.activity, 25], ['Depth', market.trust.depth, 20], ['Track record', market.trust.trackRecord, 25]] as const;
    return <>
        <TrustBadge market={market}/>
        {parts.map(([label, value, max]) => <div className="event-row" key={label}>
            <div className="row"><strong>{label}</strong><span className="mono">{value === null ? 'Unavailable' : `${number(value)} / ${max}`}</span></div>
            {value !== null && <Progress value={value / max}/>}
        </div>)}
        <p className="note">Spread: {number(market.trust.spreadCents)} cents. {market.trust.trackRecord === null ? 'No track record yet; available quote components are rescaled.' : `${market.trust.categoryCount} settled markets in this category.`}</p>
        <a href="#track-record">How trust is scored →</a>
    </>;
}

export function OddsChart({ points }: {
    points: OddsPoint[];
}) { if (points.length < 2)
    return <Empty>Not enough odds history for a chart.</Empty>; const start = Date.parse(points[0].ts), end = Date.parse(points.at(-1)!.ts); const coords = points.map(p => `${45 + (Date.parse(p.ts) - start) / Math.max(1, end - start) * 650},${255 - p.probability * 220}`).join(' '); return <><svg className="chart" viewBox="0 0 720 290" role="img" aria-label="One-week bid–ask midpoint history">{[0, .5, 1].map(p => <g key={p}><line x1="45" y1={255 - p * 220} x2="695" y2={255 - p * 220} stroke="#2A313C"/><text x="0" y={260 - p * 220} fill="#A3ADBA" fontSize="12">{percent(p)}</text></g>)}<polyline points={coords} fill="none" stroke="#5AA2FF" strokeWidth="3"/></svg><div className="row note"><span>{dateText(points[0].ts)}</span><span>{dateText(points.at(-1)!.ts)}</span></div></>; }
