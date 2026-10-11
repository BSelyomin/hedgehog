'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { EventForecastResponse, ForecastDriver, ForecastExclusion, ForecastMarket, ForecastMarketsResponse,
    ForecastsResponse, ScenarioForecast, RankedForecastsResponse, RankedForecastEvent, ForecastResultResponse, ForecastAssessmentResponse, ForecastResultSummary, ForecastAssessmentsResponse, ForecastGroupPrediction, ForecastResultAssessmentResponse } from '../../../shared/types';
import { api, Card, dateText, Empty, Fresh, href, money, percent, ReloadButton, Status, useData } from '../common';
import { driverName } from './sensitivity';
import { ForecastColumnHeading } from './forecast-column-heading';
import { useOwner } from '../auth';
import { getCachedResponse, getCacheOwner, getCacheRevision, invalidateCachedResponses } from '../../lib/api-client';
import { loadForecastResultAssessment } from '../../lib/forecast-result-loader';

const FORECAST_PAGE_SIZE = 10;
const FORECAST_COLUMNS = [
    ['Event family', 'Related Kalshi events grouped by their underlying topic, across dates, times and price targets. The rank compares measured portfolio exposure.'],
    ['Market closes', 'The earliest and latest contract close times in this family. Contracts may describe different horizons; close time is not necessarily when the real-world event happens.'],
    ['Daily sensitivity', 'The sum of linked holding values multiplied by their typical historical driver effects. This ranks exposure; it does not predict the portfolio change if an event happens.'],
    ['Portfolio linked', 'The share of your total portfolio value linked to this family. It shows reach, not the size or probability of a gain or loss.'],
    ['Selected result odds', 'The selected contract’s Kalshi bid–ask midpoint. These are odds for that specific result, not for the whole family or the AI portfolio forecast.'],
    ['Portfolio forecast', 'An estimated dollar change computed from reliable historical sensitivities. AI driver assumptions and self-rated confidence are labeled separately. Open the dropdown for calculation evidence and sources.'],
    ['Details', 'Expand the family to compare its dated contracts, individual odds, stock effects, measured evidence and optional manual assumptions.']
] as const;

function useCalculation<T>(path: string, revision: string) {
    const [result, setResult] = useState<T | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const pending = useRef<AbortController | null>(null);
    useEffect(() => {
        pending.current?.abort(); setResult(null); setError(''); setBusy(false);
        return () => pending.current?.abort();
    }, [revision, path]);
    async function calculate(body: unknown) {
        pending.current?.abort();
        const controller = new AbortController(); pending.current = controller;
        setBusy(true); setError(''); setResult(null);
        try {
            const value = await api<T>(path, { method: 'POST', body: JSON.stringify(body), signal: controller.signal }, 30000);
            if (!controller.signal.aborted) { setResult(value); return value; }
        } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Calculation unavailable'); }
        finally { if (!controller.signal.aborted) setBusy(false); }
    }
    return { result, error, busy, calculate };
}

export function Forecasts() {
    const events = useData<RankedForecastsResponse>('/forecasts/ranked-events');
    const [expanded, setExpanded] = useState<string[]>([]), [showTools, setShowTools] = useState(false), [revision, setRevision] = useState(0);
    const [page, setPage] = useState(1);
    const owner = useOwner();
    const listHeading = useRef<HTMLHeadingElement>(null);
    const pageCount = Math.max(1, Math.ceil((events.data?.events.length ?? 0) / FORECAST_PAGE_SIZE));
    useEffect(() => { setPage(current => Math.min(current, pageCount)); }, [pageCount]);
    const [ai, setAI] = useState<AutomaticAIState>(() => ({ data: getCachedResponse<ForecastAssessmentsResponse>('/forecasts/assessments'), error: '', stopped: false }));
    async function reload() {
        invalidateCachedResponses('/forecasts');
        if (!await events.reload()) return;
        setAI({ data: null, error: '', stopped: false }); setRevision(v => v + 1);
    }
    async function retryEstimate(ticker: string) {
        await api<ForecastAssessmentResponse>(`/forecasts/assessment/${encodeURIComponent(ticker)}`, { method: 'POST', body: '{}' });
        setAI({ data: null, error: '', stopped: false }); setRevision(v => v + 1);
    }
    function toggle(key: string) { setExpanded(rows => rows.includes(key) ? rows.filter(row => row !== key) : [...rows, key]); }
    function changePage(next: number) {
        setPage(Math.max(1, Math.min(next, pageCount)));
        listHeading.current?.focus({ preventScroll: true });
        listHeading.current?.scrollIntoView({ block: 'start' });
    }
    return <div className="forecast-page">
        <div className="row"><div><h1>Forecasts</h1><p>Which event results could move {owner.their} portfolio—and which stocks could rise or fall.</p></div><ReloadButton onReload={reload}/></div>
        <Status error={events.error} loading={!events.data && !events.error}/><Fresh asOf={events.data?.asOf ?? null}/>
        {events.data && <>
            <p className="note">Portfolio value: <strong className="mono">{money(events.data.totalValue)}</strong>. Showing {events.data.events.length} of {events.data.groupedEvents ?? events.data.candidateEvents} forecast groups from {events.data.candidateEvents} linked events, ranked by measured daily dollar sensitivity.</p>
            <details className="forecast-help"><summary>How to read these forecasts</summary>{events.data.notes.map(note => <p className="note" key={note}>{note}</p>)}</details>
            {!events.data.events.length ? <Empty>No linked events are available yet. <a href={href('holdings')}>Add holdings</a> and wait for reviewed market tags and measurements to load.</Empty> :
                <Card className="forecast-table-card"><h2 ref={listHeading} tabIndex={-1}>Portfolio event forecasts</h2><p className="note">One row per event family across times and price targets. Snowflake evaluates the full family together for a combined forecast. Expand a row to compare the individual contracts and stock effects.</p>
                    <p className="note">{events.data.events.filter(event => event.outcomes.some(outcome => outcome.result.changeUsd !== null)).length} of {events.data.events.length} displayed groups have a verified result estimate. Snowflake makes best-effort driver assumptions for other measured groups. AI confidence is self-rated and uncalibrated; Kalshi odds remain separate.</p>
                    {events.data.events.some(event => event.outcomes.length >= 2 || event.outcomes.some(outcome => outcome.result.changeUsd === null)) && <AutomaticAssessments key={revision} onUpdate={setAI}/>}
                    <ForecastTable events={events.data.events} expanded={expanded} onToggle={toggle} onRetry={retryEstimate} revision={revision} assessments={ai.data} aiError={ai.error} aiStopped={ai.stopped} page={page} onPageChange={changePage}/></Card>}
        </>}
        <button className="forecast-tools-toggle" aria-expanded={showTools} aria-controls="forecast-tools" onClick={() => setShowTools(value => !value)}>
            {showTools ? 'Hide additional forecast tools' : 'Additional forecast tools'}
        </button>
        {showTools && <div id="forecast-tools"><ForecastTools key={revision}/></div>}
    </div>;
}

interface AutomaticAIState { data: ForecastAssessmentsResponse | null; error: string; stopped: boolean }
function AutomaticAssessments({ onUpdate }: { onUpdate: (state: AutomaticAIState) => void }) {
    const { data, error, reload } = useData<ForecastAssessmentsResponse>('/forecasts/assessments');
    const started = useRef(Date.now()), [stopped, setStopped] = useState(false);
    const owner = useOwner();
    useEffect(() => { onUpdate({ data, error, stopped }); }, [data, error, stopped, onUpdate]);
    useEffect(() => {
        if (stopped || error || !data?.assessments.some(item => item.assessment.status === 'pending')) return;
        if (Date.now() - started.current >= 720000) { setStopped(true); return; }
        const timer = setTimeout(() => { void reload(undefined, false).catch(() => {}); }, 5000);
        return () => clearTimeout(timer);
    }, [data, error, stopped, reload]);
    async function retry() { started.current = Date.now(); setStopped(false); await reload(); }
    return <div className="row"><p className="note" role="status">{error || (stopped ? 'AI estimates are taking longer than expected. Reload to check again.'
        : !data || data.assessments.some(item => item.assessment.status === 'pending') ? 'Snowflake is evaluating related contracts together in the background. Completed forecasts appear below.' : `AI estimates checked against ${owner.their} current holdings.`)}</p>
        <ReloadButton label="Reload AI estimates" onReload={retry}/></div>;
}

export function assessedEvent(event: RankedForecastEvent, assessment?: ForecastAssessmentResponse): RankedForecastEvent {
    const predictions = assessment?.status === 'ready' ? assessment.predictions ?? [] : [];
    return { ...event, preferredMarketTicker: event.outcomes.find(m => m.ticker === event.preferredMarketTicker)?.result.changeUsd === null
        ? assessment?.selectedMarketTicker ?? event.preferredMarketTicker : event.preferredMarketTicker,
        outcomes: event.outcomes.map(m => {
            const predicted = predictions.find(p => p.market.ticker === m.ticker);
            return predicted && m.result.changeUsd === null ? { ...m, ...predicted.market, result: predicted.result } : m;
        }) };
}

export function ForecastTable({ events, expanded, onToggle, onRetry, revision = 0, assessments = null, aiError = '', aiStopped = false, page = 1, onPageChange }: {
    events: RankedForecastEvent[]; expanded: string[]; onToggle: (key: string) => void; revision?: number;
    assessments?: ForecastAssessmentsResponse | null; aiError?: string; aiStopped?: boolean;
    onRetry?: (ticker: string) => Promise<unknown>;
    page?: number; onPageChange?: (page: number) => void;
}) {
    const [assumptions, setAssumptions] = useState<Record<string, { source: RankedForecastEvent; revision: number; value: ForecastResultResponse }>>({});
    const panels = useRef(new Map<string, HTMLDivElement>());
    const resultButtons = useRef(new Map<string, HTMLButtonElement>());
    const revealKey = useRef<string | null>(null);
    function reveal(key: string) {
        const panel = panels.current.get(key);
        if (!panel) return;
        panel.focus({ preventScroll: true });
        panel.scrollIntoView({ block: 'start', inline: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
        revealKey.current = null;
    }
    function showResults(key: string) {
        if (expanded.includes(key)) reveal(key);
        else { revealKey.current = key; onToggle(key); }
    }
    function hideResults(key: string) {
        resultButtons.current.get(key)?.focus();
        onToggle(key);
    }
    useEffect(() => { if (revealKey.current) reveal(revealKey.current); }, [expanded, page]);
    useEffect(() => { setAssumptions({}); }, [events, revision]);
    const pageCount = Math.max(1, Math.ceil(events.length / FORECAST_PAGE_SIZE));
    const currentPage = Math.max(1, Math.min(page, pageCount));
    const firstIndex = (currentPage - 1) * FORECAST_PAGE_SIZE;
    const pageEvents = events.slice(firstIndex, firstIndex + FORECAST_PAGE_SIZE);
    return <><div className="scroll"><table className="forecast-table"><caption className="sr-only">Events ranked by measured portfolio sensitivity</caption>
        <thead><tr>{FORECAST_COLUMNS.map(([label, description]) => <th scope="col" key={label}><ForecastColumnHeading label={label} description={description}/></th>)}</tr></thead>
        <tbody>{pageEvents.map((event, index) => {
        const key = event.groupKey ?? event.ticker, open = expanded.includes(key), id = `forecast-group-${encodeURIComponent(key)}`;
        const assessment = assessments?.assessments.find(item => item.eventTicker === event.ticker)?.assessment;
        const assessed = assessedEvent(event, assessment);
        const assumed = assumptions[key]?.source === event && assumptions[key].revision === revision ? assumptions[key].value : null;
        const joint = assessment?.status === 'ready' ? assessment.jointPrediction : undefined;
        const outcome = assessed.outcomes.find(m => m.ticker === (assumed?.market.ticker ?? assessed.preferredMarketTicker)), preview = assumed?.result ?? joint?.result ?? outcome?.result;
        const marketSource = event.sourceEvents?.find(source => source.ticker === outcome?.eventTicker) ?? event.sourceEvents?.[0];
        const exampleStocks = assumed?.stocks ?? joint?.stocks ?? assessment?.predictions?.find(p => p.market.ticker === outcome?.ticker)?.stocks;
        const awaitingAI = preview?.changeUsd === null && (preview.unavailableReason !== 'no-measurement' || assessment) && (!assessments || assessment?.status === 'pending' || assessment?.status === 'unavailable' || aiError || aiStopped);
        const aiUnavailable = Boolean(aiError || aiStopped || assessment?.status === 'unavailable');
        return <Fragment key={key}><tr className={open ? 'forecast-row-open' : ''}>
            <th scope="row"><span className="forecast-event-rank mono">{firstIndex + index + 1}. </span>{event.title}<span className="note">{event.sourceEvents?.length ?? 1} related events · {event.outcomes.length} results</span>
                <span className="note">{(exampleStocks?.map(stock => stock.symbol) ?? event.measuredSymbols).join(', ') || 'No measured stocks'}</span></th>
            <td><time dateTime={event.timeRange?.from ?? event.closeTime}>{dateText(event.timeRange?.from ?? event.closeTime, true)}</time>
                {event.timeRange && event.timeRange.to !== event.timeRange.from && <><span className="note">through</span><time dateTime={event.timeRange.to}>{dateText(event.timeRange.to, true)}</time></>}</td>
            <td className="amount">{money(event.dailySensitivityUsd)}<span className="note">{event.driverLabel ?? 'No measured driver'}</span></td>
            <td className="amount">{percent(event.share)}</td>
            <td className="amount">{percent(outcome?.probability ?? null)}{outcome && <span className="note">{outcome.title}<br/><time dateTime={outcome.closeTime}>{dateText(outcome.closeTime)}</time></span>}</td>
            <td><details className="forecast-disclosure"><summary>
                {preview && preview.changeUsd !== null ? <span className={`amount ${preview.changeUsd < 0 ? 'orange' : 'blue'}`}>{money(preview.changeUsd)}</span>
                    : <strong>{awaitingAI ? aiUnavailable ? 'AI estimate unavailable' : 'Snowflake estimating…'
                        : preview?.unavailableReason === 'no-measurement' ? 'No reliable measurement' : preview ? 'Forecast unavailable' : 'No open result'}</strong>}
                <span className="forecast-dropdown-label">{preview && preview.changeUsd !== null && <>{preview.basis === 'ai-assumption' ? 'AI estimate' : preview.basis === 'user-assumption' ? 'Your assumption' : 'Measured scenario'} · </>}Forecast details<span className="sr-only"> for {event.title}</span></span>
            </summary><div className="forecast-disclosure-content">{awaitingAI
                ? <><strong>{aiError || aiStopped || assessment?.status === 'unavailable' ? 'AI estimate unavailable' : 'Snowflake estimating…'}</strong>
                    {(aiError || aiStopped || assessment?.reason) && <span className="note">{aiError || assessment?.reason || 'Reload AI estimates to check again.'}</span>}</>
                : <ResultChange result={preview}/>}
                {assessment?.status === 'unavailable' && onRetry && <ReloadButton label="Retry estimate" onReload={() => onRetry(event.ticker)}/>}
                {assessment?.status === 'ready' && assessment.reason && <span className="note">{assessment.reason}</span>}
                {preview && preview.changeUsd !== null && marketSource && <span className="note"><a href={marketSource.url} target="_blank" rel="noreferrer">Market source</a> · <a href={`#${id}`} onClick={event => { event.preventDefault(); showResults(key); }}>View measured stock evidence</a></span>}
                {joint && !assumed ? <span className="note">{joint.contextContracts} contracts across {joint.contextTimes} times · one-session estimate around <time dateTime={joint.horizon.closeTime}>{dateText(joint.horizon.closeTime, true)}</time>. Selected contract odds are separate.</span>
                    : !assumed && preview && preview.changeUsd !== null && <span className="note">{preview.basis === 'ai-assumption' ? 'AI driver estimate with measured stock effects.' : 'Measured effect at the stated market level.'}{assessment?.status === 'pending' ? ' Combined forecast pending.' : ''}</span>}</div></details></td>
            <td><button className="forecast-results-toggle" type="button" aria-expanded={open} aria-controls={id} ref={node => { if (node) resultButtons.current.set(key, node); else resultButtons.current.delete(key); }} onClick={() => open ? hideResults(key) : showResults(key)}><span aria-hidden="true">{open ? '↓' : '›'}</span> {open ? 'Hide results' : 'View results'}</button>{open && <span className="forecast-open-hint">Results open below ↓</span>}</td>
        </tr>{open && <tr className="forecast-expanded-row"><td colSpan={7}><div id={id} role="region" aria-labelledby={`${id}-heading`} tabIndex={-1} className="forecast-results-panel" ref={node => { if (node) panels.current.set(key, node); else panels.current.delete(key); }}>
            <div className="row forecast-results-heading"><h3 id={`${id}-heading`}>Results for {event.title}</h3><button type="button" aria-label={`Close results for ${event.title}`} onClick={() => hideResults(key)}>Close results ↑</button></div>
            <EventResults key={`${event.ticker}|${revision}`} event={assessed} assessment={assessment} onAssumption={value => setAssumptions(values => {
            const next = { ...values }; if (value) next[key] = { source: event, revision, value }; else delete next[key]; return next;
        })}/></div></td></tr>}</Fragment>;
    })}</tbody></table></div>
        {events.length > 0 && <nav className="forecast-pagination" aria-label="Forecast pages">
            <button type="button" disabled={currentPage === 1} onClick={() => onPageChange?.(currentPage - 1)}>Previous</button>
            <div><p className="note" role="status">Showing {firstIndex + 1}–{firstIndex + pageEvents.length} of {events.length} forecast groups</p>
                <label>Page <select aria-label="Forecast page" value={currentPage} onChange={event => onPageChange?.(Number(event.target.value))}>
                    {Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                </select> of {pageCount}</label></div>
            <button type="button" disabled={currentPage === pageCount} onClick={() => onPageChange?.(currentPage + 1)}>Next</button>
        </nav>}
    </>;
}

export function ResultChange({ result, compact = false }: { result?: ForecastResultSummary; compact?: boolean }) {
    if (!result) return <span className="note">No open result. Reload events.</span>;
    const calculation = <><span className="note">{result.label}</span>
        {result.evidence && <span className="note">Calculation: holding value × measured sensitivity × {result.evidence.driver} change of {result.evidence.change.toFixed(3)}{result.evidence.unit === 'percent' ? '%' : ' percentage points'}. At least {result.evidence.observations} aligned observations; measured {dateText(result.evidence.measuredAt)}.
            {result.evidence.referenceUrl && <> <a href={result.evidence.referenceUrl} target="_blank" rel="noreferrer">Reference price source</a>.</>}</span>}</>;
    if (result.changeUsd !== null) return <><span className={`amount ${result.changeUsd < 0 ? 'orange' : 'blue'}`}>{money(result.changeUsd)}</span>
        <span className="note">{result.basis === 'user-assumption' ? 'Your assumption' : result.basis === 'ai-assumption' ? 'AI assumption' : 'Measured scenario'}</span>
        {result.basis === 'ai-assumption' && typeof result.confidence === 'number' && <span className="note">AI confidence: {result.confidence}% · self-rated, uncalibrated</span>}
        {compact ? <details className="forecast-calculation"><summary>Calculation details</summary>{calculation}</details> : calculation}</>;
    const labels = { 'outcome-mapping': 'Needs a driver assumption', 'missing-strike': 'No numeric result level',
        'missing-reference': 'Missing reference price', 'scenario-range': 'Outside model range', 'no-measurement': 'No reliable measurement' };
    const reason = <span className="note">{result.reason ?? 'No supported result estimate.'}</span>;
    return <><strong>{result.unavailableReason ? labels[result.unavailableReason] : 'Effect unmeasured'}</strong>{compact ? <details className="forecast-calculation"><summary>Why unavailable</summary>{reason}</details> : reason}</>;
}

function EventResults({ event, onAssumption, assessment }: { event: RankedForecastEvent; onAssumption: (value: ForecastResultResponse | null) => void; assessment?: ForecastAssessmentResponse }) {
    const [ticker, setTicker] = useState(event.preferredMarketTicker ?? '');
    const [requestToken, setRequestToken] = useState(0);
    const [stockEffectsOpen, setStockEffectsOpen] = useState(true);
    const selectedPanel = useRef<HTMLDetailsElement>(null);
    const [individual, setIndividual] = useState<Record<string, ForecastResultAssessmentResponse>>(() => Object.fromEntries(event.outcomes.flatMap(m => {
        const cached = getCachedResponse<ForecastResultAssessmentResponse>(`/forecasts/result/${encodeURIComponent(m.ticker)}/assessment`);
        return cached ? [[m.ticker, cached]] : [];
    })));
    const onIndividual = useCallback((value: ForecastResultAssessmentResponse) => {
        setIndividual(previous => previous[value.marketTicker] === value ? previous : { ...previous, [value.marketTicker]: value });
    }, []);
    const targets = JSON.stringify(event.outcomes.filter(m => m.result.changeUsd === null && m.result.unavailableReason !== 'no-measurement')
        .map(m => m.ticker).sort((a, b) => Number(b === event.preferredMarketTicker) - Number(a === event.preferredMarketTicker)));
    useEffect(() => {
        let mounted = true;
        const owner = getCacheOwner(), revision = getCacheRevision();
        const update = (value: ForecastResultAssessmentResponse) => { if (mounted && owner === getCacheOwner() && revision === getCacheRevision()) onIndividual(value); };
        for (const marketTicker of JSON.parse(targets) as string[]) {
            const cached = getCachedResponse<ForecastResultAssessmentResponse>(`/forecasts/result/${encodeURIComponent(marketTicker)}/assessment`);
            const pending: ForecastResultAssessmentResponse = { marketTicker, status: 'pending', selectedMarketTicker: null,
                summary: null, generatedAt: null, asOf: null, reason: 'Queued for a stock-effects estimate…' };
            update(cached?.status === 'ready' || cached?.status === 'unavailable' ? cached : pending);
            void loadForecastResultAssessment(marketTicker, () => update({ ...pending, reason: null })).then(update).catch(() => {});
        }
        // Closing results does not abort shared work: completed estimates populate
        // the private cache and are immediately available when results reopen.
        return () => { mounted = false; };
    }, [targets, onIndividual]);
    function selectResult(value: string) { setTicker(value); setStockEffectsOpen(true); setRequestToken(token => token + 1); }
    useEffect(() => { if (requestToken) selectedPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [ticker, requestToken]);
    const selected = event.outcomes.find(m => m.ticker === ticker) ?? event.outcomes[0];
    const prediction = individual[selected?.ticker]?.status === 'ready'
        ? individual[selected.ticker].predictions?.find(p => p.market.ticker === selected.ticker)
        : assessment?.predictions?.find(p => p.market.ticker === selected?.ticker);
    const measuredSymbols = prediction?.stocks.map(stock => stock.symbol) ?? event.measuredSymbols;
    const unmeasuredSymbols = [...event.measuredSymbols, ...event.unmeasuredSymbols].filter(symbol => !measuredSymbols.includes(symbol));
    return <div className="forecast-results-content">
        <Card><div className="row"><span className="eyebrow">{event.category} · Dated result forecasts</span><a href={href('event', event.ticker)}>View event evidence →</a></div>
            {event.sourceEvents && event.sourceEvents.length > 1 && <p className="note">Combined {event.sourceEvents.length} related events into one forecast. Each outcome retains its own odds; overlapping contracts are never counted twice.</p>}
            <p className="note">Results across dates and times share this entry; each keeps its own market close and odds. Measured stocks for the selected result: {measuredSymbols.join(', ') || 'None yet'}.</p>
            {unmeasuredSymbols.length > 0 && <p className="note">Not modeled for the selected result: {unmeasuredSymbols.join(', ')}. Their actual future moves are unknown.</p>}
            {!!event.prices?.length && <div className="forecast-outcomes">{event.prices.map(price => <p className="note" key={price.symbol}><strong className="mono">{price.symbol}: {price.value.toFixed(3)}</strong> · {price.date} · <a href={price.url} target="_blank" rel="noreferrer">Price source</a></p>)}</div>}
            {!!event.sourceEvents?.length && <details><summary>Combined market sources</summary><ul>{event.sourceEvents.map(source => <li key={source.ticker}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> <span className="mono">{source.ticker}</span></li>)}</ul></details>}
            <p className="note">Stock directions load when results open. Cached estimates appear immediately; missing estimates load in a queue. View stock effects opens the selected result’s calculation.</p>
            <OutcomeTable event={event} selected={selected?.ticker ?? ''} onSelect={selectResult} individual={individual}/>
            {!event.outcomes.length && <Empty>The last open market closed while loading. Reload to see current events.</Empty>}
        </Card>
        {selected && <details ref={selectedPanel} className="forecast-selected-effects forecast-stock-effects" open={stockEffectsOpen}
            onToggle={event => setStockEffectsOpen(event.currentTarget.open)}>
        <summary><span>Selected result stock effects</span><span className="forecast-stock-effects-action">{stockEffectsOpen ? 'Minimize ↑' : 'Expand ↓'}</span></summary>
        {selected && selected.result.changeUsd === null && selected.result.unavailableReason !== 'no-measurement' &&
            <IndividualResultAssessment key={selected.ticker} ticker={selected.ticker} assessment={individual[selected.ticker]} onUpdate={onIndividual}/>}
        {selected && <ResultDetails key={selected.ticker} ticker={selected.ticker} onAssumption={onAssumption} aiPrediction={prediction}/>}
        </details>}
        <details className="forecast-extra-details"><summary>Combined assessment and sources{assessment?.status === 'pending' ? ' · In progress' : ''}</summary>
            {assessment ? <AssessmentContent data={assessment} event={event} onSelect={selectResult}/> : <ForecastAssessment event={event} onSelect={selectResult}/>}
        </details>
    </div>;
}

export function OutcomeTable({ event, selected, onSelect, individual = {} }: { event: RankedForecastEvent; selected: string; onSelect: (ticker: string) => void;
    individual?: Record<string, ForecastResultAssessmentResponse> }) {
    return <div className="scroll forecast-outcome-scroll"><table className="forecast-outcome-table"><caption className="sr-only">Dated results with individual probabilities and measured scenario changes</caption>
        <thead><tr><th scope="col">Market close</th><th scope="col">Specific result</th><th scope="col">Yes odds</th><th scope="col">Portfolio change</th><th scope="col">Stocks up / down</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{event.outcomes.map(source => {
            const state = individual[source.ticker];
            const prediction = state?.status === 'ready' ? state.predictions?.find(p => p.market.ticker === source.ticker) : undefined;
            const outcome = source.result.changeUsd === null && prediction ? { ...source, result: prediction.result } : source;
            return <tr key={outcome.ticker} className={selected === outcome.ticker ? 'forecast-row-open' : ''}>
            <td><time dateTime={outcome.closeTime}>{dateText(outcome.closeTime, true)}</time></td>
            <th scope="row">{outcome.title}</th>
            <td className="amount">{percent(outcome.probability)}<span className="note">bid–ask midpoint</span></td>
            <td><OutcomeEstimateStatus result={outcome.result} assessment={state}/></td>
            <td>{outcome.result.changeUsd === null ? <span className="note" role={state?.status === 'pending' || !state ? 'status' : undefined}>
                {outcome.result.unavailableReason === 'no-measurement' ? 'No reliable price-history measurement'
                    : state?.status === 'pending' ? state.reason ?? 'Estimating stock directions…'
                        : state ? 'Stock directions unavailable'
                            : 'Loading stock directions…'}</span> : <><span className="blue">↑ {outcome.result.gainingStocks.join(', ') || 'None'}</span><br/><span className="orange">↓ {outcome.result.losingStocks.join(', ') || 'None'}</span></>}</td>
            <td><button type="button" aria-pressed={selected === outcome.ticker} onClick={() => onSelect(outcome.ticker)}>View stock effects</button></td>
        </tr>; })}</tbody></table></div>;
}

export function OutcomeEstimateStatus({ result, assessment }: { result: ForecastResultSummary; assessment?: ForecastResultAssessmentResponse }) {
    if (result.changeUsd !== null || result.unavailableReason === 'no-measurement') return <ResultChange result={result} compact/>;
    if (assessment?.status === 'pending') return <span role="status">{assessment.reason ?? 'Snowflake estimating this result…'}</span>;
    if (assessment?.status === 'unavailable') return <><strong>AI result unavailable</strong><span className="note">{assessment.reason}</span></>;
    if (assessment?.status === 'ready') return <><strong>Result estimate unavailable</strong><span className="note">{assessment.reason ?? 'The saved estimate has no supported stock-effects calculation.'}</span></>;
    if (assessment?.status === 'not-requested') return <><strong>Estimate waiting</strong><span className="note">{assessment.reason}</span></>;
    return <span role="status">Loading result estimate…</span>;
}

function IndividualResultAssessment({ ticker, assessment: data, onUpdate }: { ticker: string; assessment?: ForecastResultAssessmentResponse; onUpdate: (value: ForecastResultAssessmentResponse) => void }) {
    const path = `/forecasts/result/${encodeURIComponent(ticker)}/assessment`;
    const [busy, setBusy] = useState(false);
    const generation = useRef(0);
    const run = useCallback(async (retry = false) => {
        const current = ++generation.current;
        setBusy(true);
        onUpdate({ marketTicker: ticker, status: 'pending', selectedMarketTicker: null, summary: null, generatedAt: null, reason: null, asOf: null });
        try {
            const value = await loadForecastResultAssessment(ticker, () => {}, retry);
            if (value && generation.current === current) onUpdate(value);
        } catch (error) {
            if (generation.current === current) onUpdate({ marketTicker: ticker, status: 'unavailable', selectedMarketTicker: null,
                summary: null, generatedAt: null, reason: error instanceof Error ? error.message : 'Result request failed.', asOf: null });
        } finally { if (generation.current === current) setBusy(false); }
    }, [ticker, onUpdate]);
    useEffect(() => () => { generation.current++; }, []);
    return <div className="forecast-individual-status" aria-live="polite">
        {busy || data?.status === 'pending' ? <p className="note" role="status">{data?.reason ?? 'Snowflake is estimating this selected result. Stock effects will use reliable measured sensitivities.'}</p>
            : data?.status === 'ready' ? <p className="note">Individual estimate cached{data.generatedAt ? ` · ${new Date(data.generatedAt).toLocaleString()}` : ''}. AI confidence is self-rated; event odds remain separate.</p>
            : <p className="note">{data?.reason ?? 'Checking for a cached individual estimate…'}</p>}
        {!busy && data?.status === 'not-requested' && <button type="button" onClick={() => void run()}>Estimate this result</button>}
        {!busy && data?.status === 'unavailable' && <button type="button" onClick={() => void run(true)}>Retry result estimate</button>}
        {!busy && data?.status === 'pending' && <ReloadButton label="Check result status" onReload={async () => {
            const value = await api<ForecastResultAssessmentResponse>(path, { cache: 'no-store' }); onUpdate(value);
        }}/>}
    </div>;
}

function ForecastAssessment({ event, onSelect }: { event: RankedForecastEvent; onSelect: (ticker: string) => void }) {
    const { data, error, reload } = useData<ForecastAssessmentResponse>(`/forecasts/assessment/${encodeURIComponent(event.ticker)}`);
    const started = useRef(Date.now()), [stopped, setStopped] = useState(false);
    useEffect(() => {
        if (data?.status !== 'pending' || stopped || error) return;
        if (Date.now() - started.current >= 90000) { setStopped(true); return; }
        const timer = setTimeout(() => { void reload(undefined, false).catch(() => {}); }, 3000);
        return () => clearTimeout(timer);
    }, [data, stopped, error, reload]);
    async function retry() { started.current = Date.now(); setStopped(false); await reload(); }
    return <Card><div className="row"><h2>Combined Snowflake assessment</h2><ReloadButton label="Reload assessment" onReload={retry}/></div>
        {error ? <p className="error" role="alert">{error}</p> : stopped ? <p className="note">The assessment is taking longer than expected. Reload assessment to check again.</p>
            : !data || data.status === 'pending' ? <p className="note" role="status">Snowflake is assessing the combined data. Sourced results below remain available.</p>
                : <AssessmentContent data={data} event={event} onSelect={onSelect}/>}
        {data?.status === 'unavailable' && <ReloadButton label="Retry estimate" onReload={() => reload(`/forecasts/assessment/${encodeURIComponent(event.ticker)}`)}/>}
    </Card>;
}

export function AssessmentContent({ data, event, onSelect }: { data: ForecastAssessmentResponse; event: RankedForecastEvent; onSelect: (ticker: string) => void }) {
    const outcome = assessedEvent(event, data).outcomes.find(m => m.ticker === data.selectedMarketTicker);
    if (data.status !== 'ready' || !outcome) return <p className="note">{data.reason ?? 'No validated assessment is available.'}</p>;
    return <>{data.jointPrediction && <GroupPrediction data={data.jointPrediction}/>}
        {data.summary ? <p>{data.summary.text}</p> : <p className="note">{data.reason ?? 'AI explanation hidden because it failed source or number checks. Measured calculation evidence is shown below.'}</p>}<p className="note">Assessed result: <strong>{outcome.title}</strong> · market closes <time dateTime={outcome.closeTime}>{dateText(outcome.closeTime, true)}</time>.</p>
        <div className="stats forecast-stats"><div><span className="muted">Current odds of this result</span><strong className="number">{percent(outcome.probability)}</strong><p className="note">Kalshi bid–ask midpoint for this contract.</p></div>
            <div><span className="muted">Measured scenario change</span><div><ResultChange result={outcome.result}/></div></div></div>
        <button onClick={() => onSelect(outcome.ticker)}>View assessed result</button>
        <p className="note">Cached assessment from {data.generatedAt ? new Date(data.generatedAt).toLocaleString() : 'an unknown time'}. Live odds and scenario values above update separately; quoted numbers in cached prose refer to its original snapshot. Snowflake supplies best-effort driver assumptions and self-rated confidence. Code computes stock effects from measured sensitivities. Event odds come from Kalshi.</p>
        <ul>{(data.summary?.sources ?? event.sourceEvents ?? []).map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul>
    </>;
}

export function GroupPrediction({ data }: { data: ForecastGroupPrediction }) {
    return <section aria-label="Combined family forecast"><h3>Combined family forecast</h3>
        <p className="note">Context: {data.contextContracts} contracts across {data.contextTimes} market close times. One-session estimate around <time dateTime={data.horizon.closeTime}>{dateText(data.horizon.closeTime, true)}</time>.</p>
        <div className="stats forecast-stats"><div><span className="muted">Estimated portfolio change</span><div><ResultChange result={data.result}/></div></div>
            <div><span className="muted">Estimated portfolio value</span><strong className="number">{money(data.result.portfolioValueAssumingOthersFlat)}</strong><p className="note">Other holdings stay at their current values.</p></div></div>
        <div className="scroll"><table><thead><tr><th>Stock</th><th>Direction</th><th>Estimated change</th><th>Estimated value</th></tr></thead>
            <tbody>{data.stocks.map(stock => <tr key={stock.symbol}><th className="mono">{stock.symbol}</th><td className={stock.direction === 'down' ? 'orange' : 'blue'}>{stock.direction === 'up' ? '↑ Up' : stock.direction === 'down' ? '↓ Down' : 'Unchanged'}</td>
                <td className="amount">{money(stock.changeUsd)}</td><td className="amount">{money(stock.predictedValue)}</td></tr>)}</tbody></table></div>
        {data.notes.map(note => <p className="note" key={note}>{note}</p>)}
        {data.scenario && <><p className="note">Modeled holdings: {money(data.scenario.coveredValue)}.</p>
            {data.scenario.notes.map(note => <p className="note" key={note}>{note}</p>)}
            <Exclusions rows={data.scenario.excluded} note="These holdings keep their current values in this estimate; their actual future moves are unknown."/></>}
    </section>;
}

function ResultDetails({ ticker, onAssumption, aiPrediction }: { ticker: string; onAssumption: (value: ForecastResultResponse | null) => void; aiPrediction?: ForecastResultResponse }) {
    const { data, error, reload } = useData<ForecastResultResponse>(`/forecasts/result/${encodeURIComponent(ticker)}`);
    const [revision, setRevision] = useState(0);
    async function refresh() { onAssumption(null); setRevision(value => value + 1); await reload(); }
    return <><div className="row forecast-selected-result"><ReloadButton onReload={refresh} label="Reload result"/></div><Status error={error} loading={!data && !aiPrediction && !error}/>
        {(aiPrediction || data) && <><ResultEstimate data={data ?? aiPrediction!} aiPrediction={aiPrediction}/><details className="forecast-extra-details"><summary>Calculate with your own driver assumption</summary><ResultAssumption key={`${ticker}|${(aiPrediction ?? data)!.asOf}|${revision}`} data={aiPrediction ?? data!} onResult={onAssumption}/></details></>}</>;
}

export function ResultEstimate({ data, aiPrediction }: { data: ForecastResultResponse; aiPrediction?: ForecastResultResponse }) {
    if (!aiPrediction && data.result.changeUsd === null && data.scenarioDrivers?.length) return null;
    return <PortfolioResult result={aiPrediction ?? data}/>;
}

export function ResultAssumption({ data, onResult }: { data: ForecastResultResponse; onResult: (value: ForecastResultResponse) => void }) {
    const drivers = data.scenarioDrivers ?? [];
    const [key, setKey] = useState(data.result.driver ?? drivers[0]?.key ?? ''), [change, setChange] = useState('');
    const driver = drivers.find(d => d.key === key) ?? drivers[0];
    const calculation = useCalculation<ForecastResultResponse>(`/forecasts/result/${encodeURIComponent(data.market.ticker)}`, `${driver?.key}|${change}|${data.asOf}`);
    if (!driver) return <p className="note">No measured scenario is available for these linked stocks. Load price history and run the measurement job; noisy or insufficient measurements remain without numbers.</p>;
    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!change.trim() || !Number.isFinite(Number(change))) return;
        const result = await calculation.calculate({ driver: driver!.key, change: Number(change) });
        if (result) onResult(result);
    }
    return <Card><h2>Calculate this result with your assumption</h2>
        <p>For “{data.market.title}”, enter the remaining change you expect in a measured driver. The app calculates dollar effects for reviewed event-linked stocks only.</p>
        <form className="forecast-form" onSubmit={submit}>
            <label>Measured driver<select value={driver.key} onChange={event => { setKey(event.target.value); setChange(''); }}>{drivers.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}</select></label>
            <label>Assumed driver change ({driver.unit === 'percent' ? '%' : 'percentage points'})<input type="number" step="any" required value={change} onChange={event => setChange(event.target.value)} placeholder="Enter your assumption"/></label>
            <button className="primary" disabled={calculation.busy || !change.trim()} aria-busy={calculation.busy}>{calculation.busy ? 'Calculating…' : 'Calculate assumed result'}</button>
        </form>
        <p className="note">Measured holdings: {money(driver.coveredValue)}. This input is your assumption, not a Snowflake prediction. Yield inputs use percentage points: −0.25 means a fall of 25 basis points. Other holdings stay at current values. Reload clears the table’s assumed result.</p>
        {calculation.error && <p className="error" role="alert">{calculation.error}</p>}
        {calculation.result && <div aria-live="polite"><PortfolioResult result={calculation.result}/></div>}
    </Card>;
}

export function PortfolioResult({ result }: { result: ForecastResultResponse }) {
    const prediction = result.result;
    return <Card><span className="chip plain">{prediction.basis === 'user-assumption' ? 'Conditional on your assumption' : prediction.basis === 'ai-assumption' ? 'Conditional on Snowflake’s assumption' : 'Conditional measured estimate'}</span><h2>{prediction.label}</h2>
        {prediction.basis === 'ai-assumption' && typeof prediction.confidence === 'number' && <p>AI confidence: <strong className="mono">{prediction.confidence}%</strong> <span className="note">Self-rated and uncalibrated; separate from event odds.</span></p>}
        {prediction.reference && <p className="note">Published {prediction.reference.label ?? driverName(prediction.driver!)}: <strong className="mono">{prediction.reference.value.toFixed(3)}{prediction.reference.unit === 'points' ? ' points' : '%'}</strong> on {prediction.reference.date}.
            {' '}<a href={prediction.reference.url} target="_blank" rel="noreferrer">{prediction.reference.unit === 'points' ? 'Index price source' : 'FRED source'}</a></p>}
        {prediction.reason && <Empty>{prediction.reason}</Empty>}
        {prediction.changeUsd !== null && <>
            <div className="stats forecast-stats">
                <div><span className="muted">Portfolio value now</span><strong className="number">{money(result.totalValue)}</strong></div>
                <div><span className="muted">Portfolio scenario value</span><strong className="number blue">{money(prediction.portfolioValueAssumingOthersFlat)}</strong><p className="note">Other holdings stay at their current values.</p></div>
                <div><span className="muted">Modeled result contribution</span><strong className={`number ${prediction.changeUsd < 0 ? 'orange' : 'blue'}`}>{money(prediction.changeUsd)}</strong></div>
            </div>
            <div className="forecast-outcomes"><div className="forecast-direction-group"><h3 className="blue">Stocks estimated to rise</h3><p className="mono">{prediction.gainingStocks.join(', ') || 'None in this model'}</p></div>
                <div className="forecast-direction-group"><h3 className="orange">Stocks estimated to fall</h3><p className="mono">{prediction.losingStocks.join(', ') || 'None in this model'}</p></div></div>
            <div className="scroll"><table className="forecast-stock-table"><thead><tr><th>Stock</th><th>Direction</th><th>Return estimate</th><th>Dollar change</th><th>Result value</th><th>Evidence</th></tr></thead>
                <tbody>{result.stocks.map(stock => <tr key={stock.symbol}><th className="mono">{stock.symbol}</th><td className={stock.direction === 'down' ? 'orange' : 'blue'}>{stock.direction === 'up' ? '↑ Up' : stock.direction === 'down' ? '↓ Down' : 'Unchanged'}</td>
                    <td className="amount">{percent(stock.returnEstimate)}</td><td className="amount">{money(stock.changeUsd)}</td><td className="amount">{money(stock.predictedValue)}</td>
                    <td><span className="note">{stock.sensitivity.days} observations · measured {stock.sensitivity.computedAt.slice(0, 10)}.
                        {stock.lead && <> Strongest driver: {driverName(stock.lead.driver)}.</>}</span></td></tr>)}</tbody></table></div>
        </>}
        <p className="note">Yes probability for “{result.market.title}”: <span className="mono">{percent(result.market.probability)}</span>. {result.market.probabilityNote}</p>
        {result.notes.map(note => <p className="note" key={note}>{note}</p>)}
        {result.scenario && <><p className="note">Modeled holdings value: <span className="mono">{money(result.scenario.coveredValue)}</span>.</p>
            {result.scenario.sensitivityBounds && <p className="note">Modeled value coefficient bounds: {money(result.scenario.sensitivityBounds.low)} – {money(result.scenario.sensitivityBounds.high)}. These are not prediction intervals.</p>}
            {result.scenario.notes.map(note => <p className="note" key={note}>{note}</p>)}<Exclusions rows={result.scenario.excluded} note="These holdings have no modeled contribution. The full portfolio scenario keeps their current values; their actual future moves are unknown."/></>}
        <Fresh asOf={result.asOf}/>
    </Card>;
}

function ForecastTools() {
    const forecast = useData<ForecastsResponse>('/forecasts');
    const events = useData<ForecastMarketsResponse>('/forecasts/events');
    const [revision, setRevision] = useState(0);
    async function reload() {
        setRevision(v => v + 1);
        const results = await Promise.allSettled([forecast.reload(), events.reload()]);
        const failed = results.find(r => r.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }
    return <>
        <div className="row"><div><h2>Additional forecast tools</h2><p>Explore custom driver assumptions or the next-session baseline.</p></div><ReloadButton onReload={reload}/></div>
        <p className="note">Reload updates source data and clears scenario results. Calculate again to use the latest holdings and quotes.</p>
        <Status error={forecast.error} loading={!forecast.data && !forecast.error}/>
        <Fresh asOf={forecast.data?.asOf ?? null}/>
        {forecast.data && <ForecastsContent key={revision} data={forecast.data} markets={events.data?.markets ?? []}
            marketsError={events.error} marketsLoading={!events.data && !events.error}/>}
    </>;
}

export function ForecastsContent({ data, markets, marketsError = '', marketsLoading = false }: {
    data: ForecastsResponse; markets: ForecastMarket[]; marketsError?: string; marketsLoading?: boolean;
}) {
    const baseline = data.baseline, owner = useOwner();
    if (data.totalValue === 0) return <Empty><a href={href('holdings')}>Add holdings</a> or connect a brokerage to forecast {owner.their} portfolio.</Empty>;
    return <>
        <Card className="forecast-baseline"><div className="row"><h2>Next trading-day value forecast</h2><span className="chip plain">Measured from price history</span></div>
            <div className="stats forecast-stats">
                <div><span className="muted">Covered holdings now</span><strong className="number">{money(baseline.coveredValue)}</strong></div>
                <div><span className="muted">Predicted covered value</span><strong className="number blue">{money(baseline.predictedValue)}</strong></div>
                <div><span className="muted">Predicted change</span><strong className={`number ${baseline.changeUsd !== null && baseline.changeUsd < 0 ? 'orange' : ''}`}>{money(baseline.changeUsd)}</strong></div>
            </div>
            {baseline.estimated80Range && <p className="forecast-range">Estimated 80% value range: <strong className="mono">{money(baseline.estimated80Range.low)} – {money(baseline.estimated80Range.high)}</strong></p>}
            <p className="note">Portfolio entered/imported value: <span className="mono">{money(data.totalValue)}</span>. Source price session: {baseline.priceDate ?? 'Unavailable'}.
                {' '}{baseline.observations} aligned daily returns. Method: {baseline.method === 'rolling-mean' ? 'Rolling historical mean' : baseline.method === 'no-change' ? 'No change' : 'Insufficient data'}.</p>
            {baseline.validation && <p className="note">Independent validation: {baseline.validation.days} sessions. Typical forecast error (RMSE): <span className="mono">{money(baseline.validation.rmseUsd)}</span>;
                {' '}no-change benchmark: <span className="mono">{money(baseline.validation.noChangeRmseUsd)}</span>. Lower is better.</p>}
            {baseline.notes.map(note => <p className="note" key={note}>{note}</p>)}
            <Exclusions rows={baseline.excluded}/>
        </Card>
        <div className="forecast-layout">
            <ScenarioCalculator data={data}/>
            <EventForecaster data={data} markets={markets} error={marketsError} loading={marketsLoading}/>
        </div>
    </>;
}

function Exclusions({ rows, note = 'These holdings are excluded from the displayed values; their future moves are unknown.' }: { rows: ForecastExclusion[]; note?: string }) {
    return rows.length ? <details className="forecast-details"><summary>Excluded holdings ({rows.length})</summary>
        <p className="note">{note}</p>
        <ul>{rows.map(row => <li key={row.symbol}><span className="mono">{row.symbol} · {money(row.valueUsd)}</span> — {row.reason}</li>)}</ul>
    </details> : null;
}

function DriverSelect({ drivers, value, onChange, id }: { drivers: ForecastDriver[]; value: string; onChange: (value: string) => void; id: string }) {
    return <label htmlFor={id}>Driver<select id={id} value={value} onChange={event => onChange(event.target.value)}>
        {drivers.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
    </select></label>;
}
function ShockInput({ driver, value, onChange, label, id }: { driver: ForecastDriver; value: string; onChange: (value: string) => void; label: string; id: string }) {
    return <label htmlFor={id}>{label} ({driver.unit === 'percent' ? '%' : 'percentage points'})
        <input id={id} type="number" step="any" required min={driver.unit === 'percent' ? -99.999 : -10}
            max={driver.unit === 'percent' ? 100 : 10} value={value} onChange={event => onChange(event.target.value)}/>
    </label>;
}

function ScenarioCalculator({ data }: { data: ForecastsResponse }) {
    const [key, setKey] = useState('SPY'), [change, setChange] = useState('');
    const driver = data.drivers.find(d => d.key === key) ?? data.drivers[0];
    const calculation = useCalculation<ScenarioForecast>('/forecasts/scenario', `${key}|${change}|${data.asOf}`);
    function submit(event: FormEvent) { event.preventDefault(); if (change.trim() && driver) void calculation.calculate({ driver: driver.key, change: Number(change) }); }
    return <Card><h2>Scenario calculator</h2><p>Choose one driver and enter its change over a single trading session.</p>
        {driver && <>
            <form className="forecast-form" onSubmit={submit}>
                <DriverSelect drivers={data.drivers} value={key} onChange={value => { setKey(value); setChange(''); }} id="scenario-driver"/>
                <ShockInput driver={driver} value={change} onChange={setChange} label="Assumed change" id="scenario-change"/>
                <button className="primary" disabled={calculation.busy || !change.trim()} aria-busy={calculation.busy}>{calculation.busy ? 'Calculating…' : 'Calculate scenario'}</button>
            </form>
            <p className="note">Measured coverage: <span className="mono">{money(driver.coveredValue)}</span>.
                {driver.historicalChangeRange && <> Recent observed daily changes: {driver.historicalChangeRange.low.toFixed(3)} to {driver.historicalChangeRange.high.toFixed(3)} {driver.unit === 'percent' ? '%' : 'percentage points'}.</>}</p>
            <p className="note">Yield inputs are changes in Treasury yields. For example, −0.25 means a fall of 0.25 percentage points. Separate drivers overlap; calculate each separately.</p>
        </>}
        {calculation.error && <p className="error" role="alert">{calculation.error}</p>}
        {calculation.result && <ScenarioResult result={calculation.result}/>}
        <details className="forecast-details"><summary>Measured relationships and coverage</summary>
            {driver?.holdings.map(h => <p className="note" key={h.symbol}><strong className="mono">{h.symbol}</strong>: {h.sensitivity.days} observations;
                {' '}coefficient {h.sensitivity.b.toFixed(4)}. Measured {h.sensitivity.computedAt.slice(0, 10)}.
                {h.lead && <> Most important daily driver: {driverName(h.lead.driver)} (typical return effect {percent(h.lead.typicalEffect)}).</>}</p>)}
            {driver && <Exclusions rows={driver.excluded}/>}
        </details>
    </Card>;
}

export function ScenarioResult({ result }: { result: ScenarioForecast }) {
    return <div className="forecast-result" aria-live="polite">
        <span className="chip plain">Conditional measured estimate</span>
        <p>Covered holdings: <strong className="mono">{money(result.coveredValue)}</strong></p>
        <span className="muted">Scenario value of covered holdings</span><strong className="number blue">{money(result.predictedValue)}</strong>
        <p>Driver contribution: <strong className="mono">{money(result.changeUsd)}</strong></p>
        {result.sensitivityBounds && <p className="note">Sensitivity bounds: <span className="mono">{money(result.sensitivityBounds.low)} – {money(result.sensitivityBounds.high)}</span>. These are coefficient bounds, not a prediction interval.</p>}
        {result.holdings.length > 0 && <div className="scroll"><table><thead><tr><th>Holding</th><th>Contribution</th><th>Scenario value</th></tr></thead>
            <tbody>{result.holdings.map(h => <tr key={h.symbol}><td className="mono">{h.symbol}</td><td className="amount">{money(h.changeUsd)}</td><td className="amount">{money(h.predictedValue)}</td></tr>)}</tbody></table></div>}
        {result.notes.map(note => <p className="note" key={note}>{note}</p>)}<Exclusions rows={result.excluded}/>
        <Fresh asOf={result.asOf}/>
    </div>;
}

function EventForecaster({ data, markets, error, loading }: { data: ForecastsResponse; markets: ForecastMarket[]; error: string; loading: boolean }) {
    const [ticker, setTicker] = useState(''), [key, setKey] = useState('');
    const [yes, setYes] = useState(''), [no, setNo] = useState('');
    const market = markets.find(m => m.ticker === ticker) ?? markets[0];
    const driver = data.drivers.find(d => d.key === (key || market?.drivers[0] || 'SPY')) ?? data.drivers[0];
    const calculation = useCalculation<EventForecastResponse>('/forecasts/event', `${market?.ticker}|${driver?.key}|${yes}|${no}|${data.asOf}|${market?.asOf}`);
    function submit(event: FormEvent) {
        event.preventDefault();
        if (market && driver && yes.trim() && no.trim()) void calculation.calculate({ marketTicker: market.ticker, driver: driver.key, yesChange: Number(yes), noChange: Number(no) });
    }
    return <Card><h2>Event forecasts</h2><p>Combine a linked market’s odds with your assumed remaining driver change under each outcome.</p>
        <Status error={error} loading={loading}/>
        {!loading && !error && !markets.length && <Empty>No linked open markets have loaded. Reviewed company or topic tags are needed.</Empty>}
        {market && driver && <>
            <form className="forecast-form" onSubmit={submit}>
                <label htmlFor="forecast-market">Event outcome<select id="forecast-market" value={market.ticker} onChange={event => {
                    const next = markets.find(m => m.ticker === event.target.value); setTicker(event.target.value);
                    setKey(next?.drivers[0] ?? 'SPY'); setYes(''); setNo('');
                }}>{markets.map(m => <option key={m.ticker} value={m.ticker}>{m.eventTitle} · {m.title}</option>)}</select></label>
                <DriverSelect drivers={data.drivers} value={driver.key} onChange={value => { setKey(value); setYes(''); setNo(''); }} id="event-driver"/>
                <div className="forecast-outcomes">
                    <ShockInput driver={driver} value={yes} onChange={setYes} label="Change if yes" id="event-yes"/>
                    <ShockInput driver={driver} value={no} onChange={setNo} label="Change if no" id="event-no"/>
                </div>
                <button className="primary" disabled={calculation.busy || !yes.trim() || !no.trim() || market.probability === null} aria-busy={calculation.busy}>{calculation.busy ? 'Calculating…' : 'Calculate event forecast'}</button>
            </form>
            <p>Yes probability: <strong className="mono">{percent(market.probability)}</strong> · spread {percent(market.spread)}.</p>
            <p className="note">{market.probabilityNote} Market closes {new Date(market.closeTime).toLocaleDateString()}. <a href={href('event', market.eventTicker)}>View event and evidence</a></p>
            <Fresh asOf={market.asOf}/>
            <p className="note">Both inputs are assumptions about a single session around the event, after accounting for expectations already priced in. The app has no measured event-outcome-to-stock model. A shared topic or company link alone supplies no price effect.</p>
        </>}
        {calculation.error && <p className="error" role="alert">{calculation.error}</p>}
        {calculation.result && <EventForecastResult result={calculation.result}/>}
    </Card>;
}

export function EventForecastResult({ result }: { result: EventForecastResponse }) {
    return <div className="forecast-result" aria-live="polite">
        <span className="chip plain">Conditional on your assumptions</span>
        <p>Covered holdings: <strong className="mono">{money(result.yes.coveredValue)}</strong></p>
        <span className="muted">Probability-weighted covered value</span><strong className="number blue">{money(result.expectedValue)}</strong>
        <p>Expected scenario change: <strong className="mono">{money(result.expectedChangeUsd)}</strong></p>
        <div className="forecast-outcomes"><div><span className="muted">If yes</span><strong className="number">{money(result.yes.predictedValue)}</strong></div>
            <div><span className="muted">If no</span><strong className="number">{money(result.no.predictedValue)}</strong></div></div>
        {result.notes.map(note => <p className="note" key={note}>{note}</p>)}
        <details className="forecast-details"><summary>Outcome calculations and excluded holdings</summary><h3>Yes scenario</h3><ScenarioResult result={result.yes}/><h3>No scenario</h3><ScenarioResult result={result.no}/></details>
        <Fresh asOf={result.asOf}/>
    </div>;
}
