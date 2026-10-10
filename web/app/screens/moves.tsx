'use client';
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { DriverChange, DriverMove, ExposureResponse, HoldingMove, MoveLink, MoveRange, MovedEvent, MovesResponse, SettledEvent, SettledMarket } from '../../../shared/types';
import { money, percent, number, href, dateText, useData, assetLabel, Card, Fresh, Status, Empty, LinkChip, ReloadButton } from '../common';
import { describeLeadMove, driverName } from './sensitivity';
import { CategoryFilter } from './category-controls';
import { activeSelection, selectedSymbols, selectionMove, useCategorySelection } from './category-filter';
import { RANGES, describeChange, eventLines, scopeDrivers, scopeEvents, scopeRows, signed, type Scoped } from './move-scope';

// A session date (YYYY-MM-DD) as a day, whatever the reader's time zone.
const session = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const tone = (value: number | null) => value !== null && value < 0 ? 'orange' : 'blue';
const points = (value: number) => `${value > 0 ? '+' : ''}${number(value)} pts`;
const PAGE = 5;

export function Moves() {
    const [range, setRange] = useState<MoveRange>('day');
    // No date asks the server for the latest completed session, so the page never opens on a day whose close is not in yet.
    const [date, setDate] = useState('');
    // One holding to look at on its own; empty means the chosen category, or the whole portfolio.
    const [focus, setFocus] = useState('');
    const { data, error, reload } = useData<MovesResponse>(`/moves?range=${range}${date ? `&date=${date}` : ''}`);
    // The category chosen on any screen narrows what is in view. Categories come with the exposure
    // data, which loads in the background so that the moves themselves are never kept waiting for it.
    const selection = useCategorySelection();
    const exposure = useData<ExposureResponse>('/exposure').data;
    return <>
        <div className="row"><div><h1>What moved your portfolio</h1><p>Your holdings at two closes, beside the Kalshi events of the same window</p></div><label>Window ends<input type="date" value={date || data?.date || ''} onChange={e => setDate(e.target.value)}/></label></div>
        <div className="actions move-controls">
            <div className="toggle" role="group" aria-label="Length of the window">{RANGES.map(option => <button key={option.key} aria-pressed={option.key === range} className={option.key === range ? 'active' : ''} onClick={() => setRange(option.key)}>{option.label}</button>)}</div>
            <ReloadButton onReload={() => reload()}/><button disabled={!date} onClick={() => setDate('')}>Latest trading session</button>
        </div>
        <Status error={error} loading={!data && !error}/><Fresh asOf={data?.asOf ?? null}/>
        {data && <MoveView data={data} exposure={exposure} chosen={exposure ? selectedSymbols(exposure.categories, selection) : null}
            theme={exposure ? activeSelection(exposure.categories, selection).theme : ''} focus={data.holdings.some(holding => holding.symbol === focus) ? focus : ''} setFocus={setFocus}/>}
    </>;
}

export function MoveView({ data, exposure, chosen, theme, focus, setFocus }: { data: MovesResponse; exposure: ExposureResponse | null; chosen: Set<string> | null; theme: string; focus: string; setFocus: (symbol: string) => void }) {
    const [search, setSearch] = useState('');
    const [topics, setTopics] = useState(false);
    const inCategory = scopeRows(data.holdings, chosen, ''), rows = scopeRows(data.holdings, chosen, focus);
    const listed = inCategory.filter(holding => holding.symbol.toLowerCase().includes(search.trim().toLowerCase()));
    const whole = !focus && !chosen, part = selectionMove(rows);
    // The whole portfolio's figures are the server's, which also checks that every move covers the same sessions.
    const totals = whole ? { ...part, startValue: data.startValue, endValue: data.endValue, actual: data.total, fromMarket: data.fromMarket, beyondMarket: data.beyondMarket } : part;
    const subject = focus || (chosen ? 'The chosen holdings' : data.unpricedValue > 0 ? 'Your listed securities' : 'Your portfolio');
    const symbols = focus ? new Set([focus]) : chosen;
    const settled = scopeEvents(data.settledEvents, symbols, theme, topics), moved = scopeEvents(data.movedEvents, symbols, theme, topics);
    const topicOnly = scopeEvents(data.settledEvents, symbols, theme, true).length + scopeEvents(data.movedEvents, symbols, theme, true).length
        - scopeEvents(data.settledEvents, symbols, theme, false).length - scopeEvents(data.movedEvents, symbols, theme, false).length;
    const market = data.driverChanges.find(change => change.driver === 'SPY');
    return <>
        {data.notes.map(note => <p className="note" key={note}>{note}</p>)}
        <p className="note window-note">{data.startDate
            ? <>From the close on <time dateTime={data.startDate}>{session(data.startDate)}</time> to the close on <time dateTime={data.date}>{session(data.date)}</time>. </>
            : <>Ending at the close on <time dateTime={data.date}>{session(data.date)}</time>; no earlier close is stored to open the window. </>}
            This compares the holdings you have now at both closes, as if you had held the same amount throughout: each value you entered is read as its worth at the latest close and scaled by the price. Purchases and sales inside the window are not known.</p>
        <Card className="move-scope"><h2>Looking at</h2>
            <div className="scope-row">
                <div className="category-filter">
                    <label>Holding<select aria-label="Holding" value={focus} onChange={event => setFocus(event.target.value)}>
                        <option value="">{chosen ? 'All chosen holdings' : 'Whole portfolio'}</option>
                        {data.holdings.map(holding => <option key={holding.symbol} value={holding.symbol}>{holding.symbol}</option>)}
                    </select></label>
                    {focus && <button className="reset-filters" onClick={() => setFocus('')}>Back to {chosen ? 'the chosen holdings' : 'the whole portfolio'}</button>}
                </div>
                {exposure && <CategoryFilter categories={exposure.categories}/>}
            </div>
            {focus && chosen && <p className="note">With one holding picked, the asset class applies only to the table below. The event theme still narrows the events.</p>}
        </Card>
        {totals.securities === 0 ? <Card><Empty>{focus ? `${focus} has no daily price, so it has no move over a window. It is worth ${money(rows[0]?.valueUsd ?? null)} as entered.` : 'None of the holdings in view has a daily price, so they have no move over a window.'} Events linked to {focus ? 'it' : 'them'} are still listed below.</Empty></Card> : <>
            <div className="stats">
                <Card><span className="muted">{subject}: worth at the two closes</span>
                    <p className="closes"><span className="note">{data.startDate ? session(data.startDate) : 'First close'}</span><strong className="mono">{money(totals.startValue)}</strong></p>
                    <p className="closes"><span className="note">{session(data.date)}</span><strong className="mono">{money(totals.endValue)}</strong></p></Card>
                <Card><span className="muted">Change over the window</span><strong className={`number ${tone(totals.actual)}`}>{totals.actual === null ? 'Unavailable' : signed(totals.actual, money)}</strong>
                    {totals.actual !== null && totals.startValue ? <span className="note mono">{signed(totals.actual / totals.startValue * 100, value => `${value.toFixed(2)}%`)}</span> : null}</Card>
                <Card><span className="muted">Estimated from the stock market</span><strong className="number">{totals.fromMarket === null ? 'Unavailable' : signed(totals.fromMarket, money)}</strong>
                    <span className="note">{market ? `S&P 500 (SPY) ${describeChange(market)}` : 'SPY’s change over this window is unavailable'}</span></Card>
                <Card><span className="muted">Beyond the market</span><strong className="number">{totals.beyondMarket === null ? 'Unavailable' : signed(totals.beyondMarket, money)}</strong>
                    <span className="note">The change less the market estimate</span></Card>
            </div>
            <LeadDrivers drivers={whole ? data.drivers : scopeDrivers(rows)} changes={data.driverChanges} missing={data.missingDrivers} subject={focus || undefined}/>
        </>}
        <Card><h2>By holding</h2>
            <p className="note">Pick a holding to look at it alone: its change, what mattered most for it, and the Kalshi events linked to it.</p>
            <label className="move-search">Search holdings<input type="search" placeholder="Ticker, e.g. AAPL" value={search} onChange={e => setSearch(e.target.value)}/></label>
            <p className="note">Search filters the rows below. Totals above cover {data.unpricedValue > 0 ? `listed securities; ${money(data.unpricedValue)} in cash, bonds held directly and property has no daily price and is left out` : 'your full portfolio'}.</p>
            <div className="scroll"><table className="move-table"><thead><tr>{['Holding', 'Measured beta', 'At the first close', 'At the last close', 'Change', 'From market', 'Beyond market', 'Biggest measured driver', 'Data availability'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>
                {listed.map(h => {
                    const pick = <button className="holding-pick" aria-pressed={h.symbol === focus} onClick={() => setFocus(h.symbol === focus ? '' : h.symbol)}>{h.symbol}</button>;
                    return h.assetType && h.assetType !== 'security' ? <tr key={h.symbol} className={h.symbol === focus ? 'picked' : ''}><td>{pick}<span className="note"> · {assetLabel[h.assetType]}</span></td><td colSpan={8} className="note">No daily price, so no move over a window. Worth {money(h.valueUsd)} as entered.</td></tr>
                        : <tr key={h.symbol} className={h.symbol === focus ? 'picked' : ''}><td>{pick}</td><td className="amount">{number(h.beta, 3)}</td><td className="amount">{money(h.startValue)}</td><td className="amount">{money(h.endValue)}</td>
                            <td className={`amount ${h.actual === null ? '' : tone(h.actual)}`}>{h.actual === null ? 'Unavailable' : <>{signed(h.actual, money)}{h.startValue ? <span className="note"> {signed(h.actual / h.startValue * 100, value => `${value.toFixed(2)}%`)}</span> : null}</>}</td>
                            <td className="amount">{money(h.fromMarket)}</td><td className="amount">{money(h.beyondMarket)}</td>
                            <td className={h.drivers[0] && h.drivers[0].driver !== 'SPY' ? 'driver-cell lead' : 'driver-cell'}>{h.drivers[0] ? <>{driverName(h.drivers[0].driver)} <span className="mono">{money(h.drivers[0].contribution)}</span></> : 'Unavailable'}</td>
                            <td>{h.actual !== null && h.previousDate && <p className="note">Source closes: {h.previousDate} → {h.sourceDate}.</p>}{h.unavailableReasons.length ? h.unavailableReasons.join(' ') : 'Closing prices and measured beta available.'}</td></tr>;
                })}
                {!listed.length && <tr><td colSpan={9}><Empty>No holdings match your search{chosen ? ' in this category' : ''}.</Empty></td></tr>}
            </tbody></table></div>
            <p className="note">From market = measured beta × SPY’s return over the window × the holding’s value at the first close. Beyond market = change − market estimate. Price sources: Yahoo daily closes. Missing history leaves the result unavailable.</p>
            {data.total === null && data.holdings.some(h => !h.assetType || h.assetType === 'security') && <p className="note">The listed-security total needs supported price moves over the same dates for every listed holding. Available individual moves are shown above.</p>}
            <p className="note">Biggest measured driver compares each driver’s estimated part of the move: its measured sensitivity × the driver’s change over the window × the holding’s value at the first close. It is highlighted when something other than the stock market mattered most.</p>
        </Card>
        <h2>Kalshi events over this window{focus ? `, linked to ${focus}` : ''}</h2>
        <p className="note">{data.oddsWindow ? <>Kalshi is read over the same window as the prices: from <time dateTime={data.oddsWindow.from}>{dateText(data.oddsWindow.from)}</time> to <time dateTime={data.oddsWindow.to}>{dateText(data.oddsWindow.to)}</time>, the two closes. </> : 'No window could be set, so no events are listed. '}
            Sharing a window is not proof of cause. Only a Related link is set beside a holding’s move, and then through its driver: the estimate is the holding’s past association with that driver, not an effect of the event.</p>
        {topicOnly > 0 && <label className="topic-toggle"><input type="checkbox" checked={topics} onChange={event => setTopics(event.target.checked)}/> Also show {topicOnly} linked only by a shared topic, with no measured connection</label>}
        <EventSection key={`settled|${focus}|${theme}|${topics}`} title="Settled in this window" count={settled.length} unit="event"
            about="Markets that closed inside the window and have a result, with the odds Kalshi gave 24 hours before each closed. Each event leads with the result furthest from those odds."
            empty={`No linked event settled in this window${focus || chosen || theme ? ' for what is in view' : ''}.`}>
            {shown => settled.slice(0, shown).map(event => <SettledCard key={event.ticker} event={event} rows={data.holdings} changes={data.driverChanges}/>)}
        </EventSection>
        <EventSection key={`moved|${focus}|${theme}|${topics}`} title="Odds that moved" count={moved.length} unit="event"
            about="Markets still open at the last close whose bid–ask midpoint moved 3 points or more between the two closes, biggest first. Only quotes no wider than 10 cents at both ends are compared: a wider quote’s midpoint jumps when one side of the book steps back."
            empty={`No linked market with a narrow quote at both closes moved 3 points or more${focus || chosen || theme ? ' for what is in view' : ''}.`}>
            {shown => moved.slice(0, shown).map(event => <MovedCard key={event.ticker} event={event} rows={data.holdings} changes={data.driverChanges}/>)}
        </EventSection>
    </>;
}

// Which driver accounted for the most over the window, across the holdings in view.
export function LeadDrivers({ drivers, changes, missing, subject }: { drivers: DriverMove[]; changes: DriverChange[]; missing: string[]; subject?: string }) {
    const lead = describeLeadMove(drivers, money);
    return <Card className="lead-drivers"><h2>What mattered most{subject ? ` for ${subject}` : ''}</h2>
        {lead ? <>
            <p className="driver-lead">{subject ? lead.replace('of your move', `of ${subject}’s move`) : lead}</p>
            <div className="driver-bars">{drivers.map((move, index) => {
                const change = changes.find(candidate => candidate.driver === move.driver);
                return <div key={move.driver} className={index === 0 ? 'driver-bar lead' : 'driver-bar'}>
                    <span>{driverName(move.driver)}</span>{change && <span className="note driver-change">{describeChange(change)}</span>}<strong className={`mono ${tone(move.contribution)}`}>{money(move.contribution)}</strong>
                </div>;
            })}</div>
        </> : <Empty>No measured driver could be compared for this window.</Empty>}
        {missing.length > 0 && <p className="note">Not compared, because a reading for one end of this window is not published yet: {missing.map(driverName).join(', ')}.</p>}
        <p className="note">Each figure is a holding’s measured sensitivity × the driver’s change over the window × the holding’s value at the first close, summed over holdings. A sensitivity under a tenth of the holding’s biggest gives no estimate. The market figure is measured on its own and the others with the market held fixed, so they are compared here, not added up.</p>
    </Card>;
}

// A list of events, a few at a time.
function EventSection({ title, count, unit, about, empty, children }: { title: string; count: number; unit: string; about: string; empty: string; children: (shown: number) => ReactNode }) {
    const [shown, setShown] = useState(PAGE);
    return <Card className="move-events"><h3>{title} <span className="note">· {count} {unit}{count === 1 ? '' : 's'}</span></h3>
        <p className="note">{about}</p>
        {count ? children(shown) : <Empty>{empty}</Empty>}
        {count > shown && <button onClick={() => setShown(shown + PAGE * 2)}>Show more · {count - shown} left</button>}
    </Card>;
}

// What each link in view has to do with the moves, one line per kind of link.
function Lines({ links, rows, changes }: { links: MoveLink[]; rows: HoldingMove[]; changes: DriverChange[] }) {
    return <ul className="event-lines">{eventLines(links, rows, changes, money).map(line => <li key={`${line.type}|${line.symbols.join()}`}><LinkChip type={line.type}/> <span>{line.text}</span></li>)}</ul>;
}

function Outcome({ market }: { market: SettledMarket }) {
    return <span className="outcome"><strong>Resolved {market.outcome ? 'Yes' : 'No'}</strong> <span className="note">Kalshi had <span className="mono">{percent(market.probabilityBefore)}</span> a day before</span></span>;
}

export function SettledCard({ event, rows, changes }: { event: Scoped<SettledEvent>; rows: HoldingMove[]; changes: DriverChange[] }) {
    // Without Kalshi's own event title, the leading market's question names the event.
    const [lead, ...rest] = event.markets, listed = event.title ? event.markets : rest;
    return <div className="event-row">
        <p className="note">Closed <time dateTime={event.closeTime}>{dateText(event.closeTime)}</time> · {event.settled === 1 ? 'one market' : `${event.yes} of ${event.settled} markets resolved Yes`}</p>
        <div className="row"><span className="event-title">{event.title ?? lead.title}</span>{!event.title && <Outcome market={lead}/>}</div>
        {listed.length > 0 && <ul className="event-markets">{listed.map(market => <li key={market.ticker}><span>{market.title}</span><Outcome market={market}/></li>)}</ul>}
        {event.settled > event.markets.length && <p className="note">and {event.settled - event.markets.length} more in this event; shown are the {event.markets.length} whose result was furthest from Kalshi’s odds.</p>}
        <Lines links={event.shown} rows={rows} changes={changes}/>
    </div>;
}

export function MovedCard({ event, rows, changes }: { event: Scoped<MovedEvent>; rows: HoldingMove[]; changes: DriverChange[] }) {
    const lead = event.markets[0];
    return <div className="event-row">
        <div className="row"><a className="event-title" href={href('event', lead.ticker)}>{event.title}</a><strong className={`mono ${tone(lead.changePoints)}`}>{points(lead.changePoints)}</strong></div>
        <ul className="event-markets">{event.markets.map(market => <li key={market.ticker}><a href={href('event', market.ticker)}>{market.title}</a>
            <span className="outcome"><strong className="mono">{percent(market.from)} → {percent(market.to)}</strong> <span className="note">read <time dateTime={market.fromTime}>{dateText(market.fromTime)}</time> and <time dateTime={market.toTime}>{dateText(market.toTime)}</time></span></span></li>)}</ul>
        {event.moved > event.markets.length && <p className="note">and {event.moved - event.markets.length} more of this event’s markets moved 3 points or more.</p>}
        <Lines links={event.shown} rows={rows} changes={changes}/>
    </div>;
}
