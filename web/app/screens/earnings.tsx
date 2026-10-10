'use client';
import { useRef, useState } from 'react';
import type { ExposureResponse, EarningsResponse } from '../../../shared/types';
import { money, percent, dateText, href, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, EventDate } from '../common';
import { EarningsControls } from './earnings-controls';
import { defaultEarningsFilters, earningsCompanies, earningsRows, filterEarningsRows, type EarningsFilters, type EarningsRow } from './earnings-filters';

export function Earnings() {
    const { data, error } = useData<ExposureResponse>('/exposure');
    const [symbol, setSymbol] = useState('');
    const [companySearch, setCompanySearch] = useState('');
    const covered = data ? earningsCompanies(data) : [];
    const companies = data ? earningsCompanies(data, companySearch) : [];
    const uncovered = data?.holdings.filter(holding => !covered.some(company => company.symbol === holding.symbol)).map(holding => holding.symbol) ?? [];
    const selected = companies.some(company => company.symbol === symbol) ? symbol : companies[0]?.symbol;
    return <><h1>Earnings preview</h1><p>Company markets linked directly to your holdings. These include earnings-call topics, business metrics and company-specific events.</p>
        <Status error={error} loading={!data && !error}/>
        {data && <>
            <Card className="earnings-companies">
                <div className="earnings-company-controls"><label>Search companies<input type="search" placeholder="Holding ticker or company event…" value={companySearch} onChange={event => setCompanySearch(event.target.value)}/></label>
                    <label>Company<select value={selected ?? ''} disabled={!companies.length} onChange={event => setSymbol(event.target.value)}>{!companies.length && <option value="">No matching companies</option>}{companies.map(company => <option key={company.symbol} value={company.symbol}>{`${company.symbol} · ${company.marketCount} ${company.marketCount === 1 ? 'outcome' : 'outcomes'}`}</option>)}</select></label>
                </div>
                <p className="note" role="status">{covered.length} of {data.holdings.length} holdings have active, reviewed company markets. {companySearch.trim() && `${companies.length} ${companies.length === 1 ? 'company matches' : 'companies match'} your search.`}</p>
                {companySearch && <button className="reset-filters" onClick={() => setCompanySearch('')}>Clear company search</button>}
                {uncovered.length > 0 && <details className="earnings-help"><summary>Holdings without company markets ({uncovered.length})</summary><p className="note">No active reviewed company links for: {uncovered.join(', ')}.</p></details>}
            </Card>
            {selected ? <EarningsDetail key={selected} symbol={selected}/> : <Card><Empty>{covered.length ? 'No companies match this search. Try a holding ticker or clear the search.' : 'No reviewed Kalshi company markets are linked to your holdings yet.'}</Empty><Fresh asOf={data.asOf}/></Card>}
        </>}
    </>;
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
    function update<K extends keyof EarningsFilters>(key: K, value: EarningsFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); setPage(1); }
    function changePage(next: number) { setPage(Math.max(1, Math.min(next, pages))); heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); }
    return <>
        <span className="eyebrow">{data.symbol} · company markets</span><Fresh asOf={data.asOf}/>
        <EarningsControls filters={filters} categories={categories} onChange={update} onReset={() => { setFilters(defaultEarningsFilters); setPage(1); }}/>
        <Card className="earnings-markets"><h2 ref={heading} tabIndex={-1}>Outcomes for {data.symbol}</h2>
            <div className="earnings-page-settings"><p className="note" role="status">{matching.length ? `Outcomes ${start + 1}–${start + shown.length} of ${matching.length}` : '0 matching outcomes'} · {rows.length} total across {data.events.length} {data.events.length === 1 ? 'event' : 'events'}</p>
                <label>Outcomes per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></label>
            </div>
            {pages > 1 && <EarningsPagination page={current} pages={pages} onChange={changePage} position="top"/>}
            {shown.length ? shown.map(row => <EarningsOutcome key={row.market.ticker} row={row}/>) : <Empty>{rows.length ? 'No outcomes match these filters. Try resetting the filters or widening the date range.' : 'No active company outcomes are available for this holding.'}</Empty>}
            {pages > 1 && <EarningsPagination page={current} pages={pages} onChange={changePage} position="bottom"/>}
            <details className="earnings-help"><summary>How to read these outcomes</summary><p className="note">Ordinary odds are Kalshi bid–ask midpoints. Eligible mutually exclusive bracket outcomes also show a share scaled across the full ladder. Search, filters and page changes never rescale those shares. Probability sorting uses raw midpoints for every outcome. Event dates are Kalshi’s own event time where it gives one, otherwise the market close; each outcome says which. Past report dates in the table below come from SEC filings. Quote availability does not imply that a quote is recent; check its timestamp.</p></details>
        </Card>
        <EarningsHistory data={data}/>
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

export function EarningsHistory({ data }: { data: EarningsResponse }) {
    return <Card className="earnings-history"><h2>Past earnings-report moves</h2>
        {data.history && <div className="scroll"><table><thead><tr><th>Results filed with the SEC</th><th>Close before</th><th>Close after</th><th>Move</th></tr></thead><tbody>
            {data.history.map(report => <tr key={report.sourceUrl}>
                <td><a href={report.sourceUrl} target="_blank" rel="noreferrer">{dayText(report.filingDate)}</a></td>
                <td className="amount">{money(report.closeBefore)}<span className="note"> · {dayText(report.beforeDate)}</span></td>
                <td className="amount">{money(report.closeAfter)}<span className="note"> · {dayText(report.afterDate)}</span></td>
                <td className={`amount ${report.move !== null && report.move < 0 ? 'orange' : 'blue'}`}>{report.move !== null && report.move > 0 ? '+' : ''}{percent(report.move)}</td>
            </tr>)}
        </tbody></table></div>}
        <p className="note">{data.historyNote}</p>
    </Card>;
}

function EarningsPagination({ page, pages, onChange, position }: { page: number; pages: number; onChange: (page: number) => void; position: 'top' | 'bottom' }) {
    return <nav className="earnings-pagination" aria-label={`Earnings pages (${position})`}><button disabled={page === 1} onClick={() => onChange(page - 1)}>Previous</button>
        <label>Page<select aria-label={`Earnings page (${position})`} value={page} onChange={event => onChange(Number(event.target.value))}>{Array.from({ length: pages }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select><span>of {pages}</span></label>
        <button disabled={page === pages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>;
}
