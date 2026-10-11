'use client';
import { useId, useState } from 'react';
import type { EventResponse, HoldingLink, Market } from '../../../shared/types';
import { money, percent, number, dateText, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, LinkChip, EventDate, ReloadButton } from '../common';
import { OddsChart } from './odds-chart';
import { describeCalculation, describeImportance, describeSensitivity } from './sensitivity';

export function EventPage({ ticker }: {
    ticker: string;
}) {
    const { data, error, reload } = useData<EventResponse>(`/event/${encodeURIComponent(ticker)}`);
    return <>
        {!data && <h1>Event details</h1>}
        <div className="row"><a href="#calendar">Calendar</a><ReloadButton onReload={() => reload()}/></div>
        <Status error={error} loading={!data && !error} layout="detail"/>
        {data && <EventDetail key={ticker} data={data} requestedTicker={ticker} onReloadReporting={() => reload(`/event/${encodeURIComponent(ticker)}/reload`)}/>}
    </>;
}

const OUTCOMES_PER_PAGE = 5;

export function EventDetail({ data, requestedTicker, onReloadReporting }: { data: EventResponse; requestedTicker: string; onReloadReporting: () => Promise<unknown> }) {
    const historyId = useId();
    const markets = data.event.markets;
    const initialIndex = Math.max(0, markets.findIndex(m => m.ticker === requestedTicker));
    const [selection, setSelection] = useState(markets[initialIndex]?.ticker ?? '');
    const [page, setPage] = useState(Math.floor(initialIndex / OUTCOMES_PER_PAGE) + 1);
    const [expanded, setExpanded] = useState(() => new Set(markets.some(m => m.ticker === requestedTicker) ? [requestedTicker] : []));
    const pages = Math.max(1, Math.ceil(markets.length / OUTCOMES_PER_PAGE));
    const currentPage = Math.min(page, pages), start = (currentPage - 1) * OUTCOMES_PER_PAGE;
    const shown = markets.slice(start, start + OUTCOMES_PER_PAGE);
    const market = markets.find(m => m.ticker === selection) ?? markets[0];
    function toggleOutcome(ticker: string) {
        if (!expanded.has(ticker)) setSelection(ticker);
        setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(ticker)) next.delete(ticker);
            else next.add(ticker);
            return next;
        });
    }
    return <>
            <h1>{data.event.title}</h1>
            <p><EventDate event={data.event} showYear/></p>
            <Fresh asOf={data.asOf}/>
            <div className="split event-layout">
                <div>
                    <Card>
                        <h2>What the market expects</h2>
                        {markets.length ? <p className="note" role="status">Outcomes {start + 1}–{start + shown.length} of {markets.length}</p> : <Empty>No outcomes are available for this event.</Empty>}
                        {markets.length > 0 && <p className="note">Open outcomes to compare their history. You can keep several open at once.</p>}
                        {shown.map(m => <div className="event-row event-outcome" key={m.ticker}>
                            <button className="outcome-toggle" onClick={() => toggleOutcome(m.ticker)} aria-expanded={expanded.has(m.ticker)} aria-controls={`${historyId}-${m.ticker}`}>
                                <span>{m.subtitle || m.title}</span><span className="mono">{percent(m.probability)}</span><span aria-hidden="true">{expanded.has(m.ticker) ? '−' : '+'}</span>
                            </button>
                            {m.probability !== null && <Progress value={m.probability}/>}
                            <span className="note">Kalshi bid–ask midpoint</span> <TrustBadge market={m}/>
                            {expanded.has(m.ticker) && <div id={`${historyId}-${m.ticker}`} role="region" aria-label={`History for ${m.subtitle || m.title}`}>
                                <OddsChart ticker={m.ticker} name={m.subtitle || m.title}/>
                            </div>}
                        </div>)}
                        {pages > 1 && <nav className="event-pagination" aria-label="Outcome pages">
                            <button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
                            <span className="note">Page {currentPage} of {pages}</span>
                            <button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button>
                        </nav>}
                        <p className="note">Each outcome shows its own midpoint. These quotes are not normalized.</p>
                    </Card>
                    <Card>
                        <div className="row"><h2>Your holdings linked to this event</h2><span className="mono">{money(data.event.linkedValue)} · {percent(data.event.share)}</span></div>
                        {data.event.links.map(l => <LinkedHolding key={l.symbol} link={l}/>)}
                        <p className="note">Related links are measured against the underlying driver (oil, the 2-year Treasury yield or the S&P 500), not against the probability of this event. They describe past daily moves, not a forecast. Calculated links are exact arithmetic on the terms you entered for cash, bonds or a mortgage.</p>
                    </Card>
                </div>
                <div>
                    <Card><div className="row"><h2>Reporting context</h2><ReloadButton label="Reload reporting" onReload={onReloadReporting}/></div><p className="note">Saved reporting is separate from current odds. Unchanged sources reuse the cached summary.</p></Card>
                    <Card><h2>Why this trust score</h2>{market && <><p className="note">{market.subtitle || market.title}</p><TrustBreakdown market={market}/></>}</Card>
                    {data.summary && <Card>
                        <h2>Why the odds moved</h2><span className="chip plain">AI summary</span>
                        <p>{data.summary.text}</p>{data.summary.generatedAt && <p className="note">AI snapshot saved <time dateTime={data.summary.generatedAt}>{dateText(data.summary.generatedAt, true)}</time>. Current odds may differ.</p>}
                        {data.summary.sources.map(s => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></p>)}
                        <p className="note">Generated from linked reporting. Check the sources.</p>
                    </Card>}
                </div>
            </div>
    </>;
}

export function LinkedHolding({ link }: { link: HoldingLink }) {
    const sentence = link.sensitivity && describeSensitivity(link.symbol, link.sensitivity);
    const importance = describeImportance(link);
    const calculation = describeCalculation(link, money);
    return <div className="event-row">
        <div className="row"><strong>{link.symbol} · <span className="mono">{money(link.valueUsd)}</span></strong><LinkChip type={link.type}/></div>
        {calculation && <p className="sensitivity-text">{calculation}</p>}
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
        <a href="#track-record">How trust is scored →</a><p><a href="#track-record/holdings">Compare with past events linked to your holdings →</a></p>
    </>;
}
