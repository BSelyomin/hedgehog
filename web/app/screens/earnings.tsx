'use client';
import { useRef, useState } from 'react';
import type { EarningsListResponse, EarningsResponse } from '../../../shared/types';
import { money, percent, dateText, href, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, EventDate } from '../common';
import { EarningsControls } from './earnings-controls';
import { defaultEarningsFilters, earningsRows, filterEarningsRows, type EarningsFilters, type EarningsRow } from './earnings-filters';
import { CallTopics, ExpectationCard, MetricsTable, MovesChart, UpcomingReports } from './earnings-preview';
import { countdown, describeTypicalMove, sessionText } from './earnings-text';

export function Earnings() {
    const { data, error } = useData<EarningsListResponse>('/earnings');
    const [symbol, setSymbol] = useState('');
    const [companySearch, setCompanySearch] = useState('');
    const term = companySearch.trim().toLowerCase();
    const companies = data?.companies.filter(company => !term || company.symbol.toLowerCase().includes(term) || (company.name ?? '').toLowerCase().includes(term)) ?? [];
    const selected = companies.find(company => company.symbol === symbol) ?? companies[0];
    return <div className="earnings-layout">
        <aside className="earnings-side">
            <h2>Your upcoming reports</h2>
            {data && <>
                <label>Search companies<input type="search" placeholder="Ticker or company name…" value={companySearch} onChange={event => setCompanySearch(event.target.value)}/></label>
                {companySearch && <button className="reset-filters" onClick={() => setCompanySearch('')}>Clear company search</button>}
                <UpcomingReports companies={companies} selected={selected?.symbol} onSelect={setSymbol}/>
                <p className="note" role="status">{data.companies.length} of {data.holdings} holdings have an earnings call dated by Kalshi{term ? `; ${companies.length} ${companies.length === 1 ? 'matches' : 'match'} your search` : ''}. Holdings without one are not shown here.</p>
            </>}
        </aside>
        <div className="earnings-main">
            <span className="eyebrow">{selected ? `${selected.symbol}${selected.name ? ` · ${selected.name}` : ''}` : 'Company results'}</span>
            <h1>Earnings preview</h1>
            <Status error={error} loading={!data && !error}/>
            {data && (selected ? <EarningsDetail key={selected.symbol} symbol={selected.symbol}/>
                : <Card><Empty>{data.companies.length ? 'No company matches this search. Try a ticker or clear the search.' : 'None of your holdings has an earnings call dated by Kalshi right now. Company markets still appear on the overview and calendar.'}</Empty><Fresh asOf={data.asOf}/></Card>)}
        </div>
    </div>;
}

export function EarningsDetail({ symbol }: { symbol: string }) {
    const { data, error } = useData<EarningsResponse>(`/earnings/${encodeURIComponent(symbol)}`);
    return <><Status error={error} loading={!data && !error}/>{data && <EarningsMarkets key={symbol} data={data}/>}</>;
}

export function EarningsMarkets({ data }: { data: EarningsResponse }) {
    const [filters, setFilters] = useState<EarningsFilters>(defaultEarningsFilters);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const heading = useRef<HTMLHeadingElement>(null);
    const rows = earningsRows(data);
    const matching = filterEarningsRows(rows, filters);
    const pages = Math.max(1, Math.ceil(matching.length / pageSize));
    const current = Math.min(page, pages);
    const start = (current - 1) * pageSize;
    const shown = matching.slice(start, start + pageSize);
    const categories = [...new Set(data.events.map(event => event.category))].sort();
    const otherMetrics = data.metrics.filter(metric => metric.eventTicker !== data.featured?.eventTicker);
    function update<K extends keyof EarningsFilters>(key: K, value: EarningsFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); }
    function changePage(next: number) { setPage(Math.max(1, Math.min(next, pages))); heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); }
    return <>
        <p className="earnings-subline">
            {data.call ? <>Earnings call {countdown(data.call.time)}, {sessionText(data.call.session)} (<time dateTime={data.call.time}>{dateText(data.call.time, true)}</time>)</> : 'No earnings call dated by Kalshi'}
            {data.position && <> · Your position <span className="mono">{money(data.position.valueUsd)}</span> · <span className="mono">{percent(data.position.share)}</span> of portfolio</>}
        </p>
        <Fresh asOf={data.asOf}/>
        {data.featured && <ExpectationCard metric={data.featured}/>}
        {otherMetrics.length > 0 && <MetricsTable metrics={otherMetrics}/>}
        <div className="earnings-pair">
            {data.call && <CallTopics call={data.call}/>}
            <EarningsHistory data={data}/>
        </div>
        <h2 className="earnings-all-heading">Every results market for {data.symbol}</h2>
        <EarningsControls filters={filters} categories={categories} onChange={update} onReset={() => { setFilters(defaultEarningsFilters); setPage(1); }}/>
        <Card className="earnings-markets"><h2 ref={heading} tabIndex={-1}>Outcomes for {data.symbol}</h2>
            <div className="earnings-page-settings"><p className="note" role="status">{matching.length ? `Outcomes ${start + 1}–${start + shown.length} of ${matching.length}` : '0 matching outcomes'} · {rows.length} total across {data.events.length} {data.events.length === 1 ? 'event' : 'events'}</p>
                <label>Outcomes per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
            </div>
            {pages > 1 && <EarningsPagination page={current} pages={pages} onChange={changePage} position="top"/>}
            {shown.length ? shown.map(row => <EarningsOutcome key={row.market.ticker} row={row}/>) : <Empty>{rows.length ? 'No outcomes match these filters. Try resetting the filters or widening the date range.' : 'No active results markets are available for this holding.'}</Empty>}
            {pages > 1 && <EarningsPagination page={current} pages={pages} onChange={changePage} position="bottom"/>}
            <details className="earnings-help"><summary>How to read these outcomes</summary><p className="note">This screen shows markets about reported results: the earnings call and numeric metrics for a reporting period. Other company markets are on the overview and calendar. Ordinary odds are Kalshi bid–ask midpoints. Eligible mutually exclusive bracket outcomes also show a share scaled across the full ladder. Search, filters and page changes never rescale those shares. Probability sorting uses raw midpoints for every outcome. Event dates are Kalshi’s own event time where it gives one, otherwise the market close; each outcome says which. Past report dates come from SEC filings. Quote availability does not imply that a quote is recent; check its timestamp.</p></details>
        </Card>
    </>;
}

export function EarningsOutcome({ row: { event, market, ladder, scaledProbability } }: { row: EarningsRow }) {
    const probability = scaledProbability ?? market.probability;
    return <article className="earnings-outcome" data-ticker={market.ticker}>
        <div className="earnings-outcome-main"><p className="note earnings-event-title">{event.title}</p><h3><a href={href('event', market.ticker)}>{market.subtitle || market.title}</a></h3>
            <p className="note"><span className="chip plain">{market.kind === 'mention' ? 'Call mention' : market.kind === 'bracket' ? 'Bracket / range' : 'Company market'}</span> · {event.category}<br/><EventDate event={event} showYear/></p>
            {ladder && scaledProbability !== null && <p className="note">Full ladder: {ladder.outcomes.length} outcomes · raw midpoint sum {percent(ladder.rawSum)}. Shares are scaled to 100% across that full ladder.</p>}
        </div>
        <div className="earnings-odds"><strong className="mono">{percent(probability)}</strong><p className="note">{scaledProbability !== null ? 'Scaled bracket share' : 'Yes · Kalshi midpoint'}</p>{probability !== null && <Progress value={probability}/>}{scaledProbability !== null && <p className="note">Raw midpoint: {percent(market.probability)}</p>}</div>
        <div className="earnings-trust"><TrustBadge market={market}/><p className="note">{market.asOf ? <>Quote updated <time dateTime={market.asOf}>{dateText(market.asOf, true)}</time></> : 'No quote timestamp available'}</p></div>
    </article>;
}

const dayText = (date: string | null) => date ? new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'Unavailable';

// How the stock moved across past results filings: the chart, the typical move, and the dates
// and closes behind every bar.
export function EarningsHistory({ data }: { data: EarningsResponse }) {
    const typical = describeTypicalMove(data, money);
    return <Card className="earnings-history"><h2>How {data.symbol} moved after past reports</h2>
        {data.history && <>
            <MovesChart symbol={data.symbol} history={data.history}/>
            <div className="row note moves-ends"><span>Oldest</span><span>Latest</span></div>
            {typical && <div className="row typical-move"><strong>Typical move</strong><span className="mono">{typical}</span></div>}
            <p className="note">{data.typicalMove ? `The typical move is the average size of the last ${data.typicalMove.reports} moves, whichever direction.` : 'Too few past reports to state a typical move.'} Past moves, not a forecast.</p>
            <details className="earnings-help"><summary>Report dates and closes</summary><div className="scroll"><table><thead><tr><th>Results filed with the SEC</th><th>Close before</th><th>Close after</th><th>Move</th></tr></thead><tbody>
                {data.history.map(report => <tr key={report.sourceUrl}>
                    <td><a href={report.sourceUrl} target="_blank" rel="noreferrer">{dayText(report.filingDate)}</a></td>
                    <td className="amount">{money(report.closeBefore)}<span className="note"> · {dayText(report.beforeDate)}</span></td>
                    <td className="amount">{money(report.closeAfter)}<span className="note"> · {dayText(report.afterDate)}</span></td>
                    <td className={`amount ${report.move !== null && report.move < 0 ? 'orange' : 'blue'}`}>{report.move !== null && report.move > 0 ? '+' : ''}{percent(report.move)}</td>
                </tr>)}
            </tbody></table></div></details>
        </>}
        <p className="note">{data.historyNote}</p>
    </Card>;
}

function EarningsPagination({ page, pages, onChange, position }: { page: number; pages: number; onChange: (page: number) => void; position: 'top' | 'bottom' }) {
    return <nav className="earnings-pagination" aria-label={`Earnings pages (${position})`}><button disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
        <label>Page<select aria-label={`Earnings page (${position})`} value={page} onChange={event => onChange(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select><span>of {pages}</span></label>
        <button disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>;
}
