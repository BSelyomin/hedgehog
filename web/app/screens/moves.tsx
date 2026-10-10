'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DriverChange, DriverMove, ExposureResponse, HoldingMove, MoveLink, MoveRange, MovedEvent, MovesResponse, SettledEvent, SettledMarket } from '../../../shared/types';
import { money, percent, number, href, dateText, useData, assetLabel, Card, Fresh, Status, Empty, LinkChip, ReloadButton, Pager, SectionNav } from '../common';
import { Info } from '../explain';
import { describeLeadMove, driverName, driverPhrase } from './sensitivity';
import { CategoryFilter } from './category-controls';
import { activeSelection, selectedSymbols, selectionMove, useCategorySelection } from './category-filter';
import { RANGES, describeChange, driverEvents, eventLines, scopeDrivers, scopeEvents, scopeRows, sharedReasons, signed, type Scoped } from './move-scope';

// A session date (YYYY-MM-DD) as a day, whatever the reader's time zone.
const session = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const tone = (value: number | null) => value !== null && value < 0 ? 'orange' : 'blue';
const points = (value: number) => `${value > 0 ? '+' : ''}${number(value)} pts`;
const PAGE = 5, LIST = 6;
type Behind = { moved: Scoped<MovedEvent>[]; settled: Scoped<SettledEvent>[] };

// The columns of the holdings table, each with what it means for the "i" beside its name.
const COLUMNS = [
    { name: 'Holding', about: 'A holding from your portfolio. Pick its ticker to look at it alone: its change, what mattered most for it, and the Kalshi events linked to it.' },
    { name: 'Measured beta', about: 'How far this holding has moved with the stock market: on a day the S&P 500 (SPY) moved 1%, it moved this many percent on average. Measured from its past daily returns, and shown only when the measurement is reliable.' },
    { name: 'At the first close', about: 'What the holding was worth at the close the window opens on. It is the value you entered, scaled by the price then against the latest close, as if you had held the same amount throughout.' },
    { name: 'At the last close', about: 'What the holding was worth at the close the window ends on. When the window ends on the latest session, this is the value you entered.' },
    { name: 'Change', about: 'The value at the last close minus the value at the first, in dollars and as a percentage of the value at the first close.' },
    { name: 'From market', about: 'An estimate of the part of the change that came with the stock market: measured beta × the S&P 500’s return over the window × the value at the first close.' },
    { name: 'Beyond market', about: 'The change minus the market estimate: what the stock market’s move does not account for. The two always add up to the change.' },
    { name: 'Biggest measured driver', about: 'Of the things this holding has reliably moved with (the stock market, oil, Treasury yields), the one with the largest estimate for this window: its measured sensitivity × the driver’s own change × the value at the first close. Under it is the linked Kalshi event whose odds moved most, and the rest open in the row. A driver is a price or a yield, not an event, and the estimate is a past association with it, not an effect of that event.' },
];
// The "i" stays on the line of the name's last word.
function ColumnName({ name, about }: { name: string; about: string }) {
    const words = name.split(' '), last = words.pop();
    return <>{words.length > 0 && `${words.join(' ')} `}<span className="th-end">{last}<Info title={name}>{about}</Info></span></>;
}

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
        <div className="row" id="moves-top"><div><h1>What moved your portfolio</h1><p>Your holdings at two closes, beside the Kalshi events of the same window</p></div><label>Window ends<input type="date" value={date || data?.date || ''} onChange={e => setDate(e.target.value)}/></label></div>
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
    // The holding whose driver's events are open in its row.
    const [open, setOpen] = useState('');
    const inCategory = scopeRows(data.holdings, chosen, ''), rows = scopeRows(data.holdings, chosen, focus);
    const listed = inCategory.filter(holding => holding.symbol.toLowerCase().includes(search.trim().toLowerCase()));
    const whole = !focus && !chosen, part = selectionMove(rows);
    // The whole portfolio's figures are the server's, which also checks that every move covers the same sessions.
    const totals = whole ? { ...part, startValue: data.startValue, endValue: data.endValue, actual: data.total, fromMarket: data.fromMarket, beyondMarket: data.beyondMarket } : part;
    const subject = focus || (chosen ? 'The chosen holdings' : data.unpricedValue > 0 ? 'Your listed securities' : 'Your portfolio');
    const symbols = focus ? new Set([focus]) : chosen;
    const settled = scopeEvents(data.settledEvents, symbols, theme, topics), moved = scopeEvents(data.movedEvents, symbols, theme, topics);
    const through = (key: string): Behind => ({ moved: scopeEvents(data.movedEvents, symbols, theme, false, key), settled: scopeEvents(data.settledEvents, symbols, theme, false, key) });
    // What is missing for every holding is said once, above the table, and not in each row.
    const shared = sharedReasons(inCategory);
    const topicOnly = scopeEvents(data.settledEvents, symbols, theme, true).length + scopeEvents(data.movedEvents, symbols, theme, true).length
        - scopeEvents(data.settledEvents, symbols, theme, false).length - scopeEvents(data.movedEvents, symbols, theme, false).length;
    const market = data.driverChanges.find(change => change.driver === 'SPY');
    const priced = totals.securities > 0;
    return <>
        <SectionNav sections={[{ id: 'moves-top', label: 'Top' }, { id: 'moves-view', label: 'Looking at' }, { id: 'moves-change', label: 'Change' }, ...(priced ? [{ id: 'moves-drivers', label: 'What mattered most' }] : []),
            { id: 'moves-holdings', label: 'By holding' }, { id: 'moves-settled', label: `Settled · ${settled.length}` }, { id: 'moves-odds', label: `Odds that moved · ${moved.length}` }]}/>
        {data.notes.map(note => <p className="note" key={note}>{note}</p>)}
        <p className="note window-note">{data.startDate
            ? <>From the close on <time dateTime={data.startDate}>{session(data.startDate)}</time> to the close on <time dateTime={data.date}>{session(data.date)}</time>. </>
            : <>Ending at the close on <time dateTime={data.date}>{session(data.date)}</time>; no earlier close is stored to open the window. </>}
            This compares the holdings you have now at both closes, as if you had held the same amount throughout: each value you entered is read as its worth at the latest close and scaled by the price. Purchases and sales inside the window are not known.</p>
        <Card className="move-scope" id="moves-view"><h2>Looking at</h2>
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
        {!priced ? <Card id="moves-change"><Empty>{focus ? `${focus} has no daily price, so it has no move over a window. It is worth ${money(rows[0]?.valueUsd ?? null)} as entered.` : 'None of the holdings in view has a daily price, so they have no move over a window.'} Events linked to {focus ? 'it' : 'them'} are still listed below.</Empty></Card> : <>
            <div className="stats" id="moves-change">
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
            <div id="moves-drivers" className="jump-target"><LeadDrivers drivers={whole ? data.drivers : scopeDrivers(rows)} changes={data.driverChanges} missing={data.missingDrivers} subject={focus || undefined} events={through}/></div>
        </>}
        <Card id="moves-holdings"><h2>By holding</h2>
            <p className="note">Pick a holding to look at it alone: its change, what mattered most for it, and the Kalshi events linked to it.</p>
            <label className="move-search">Search holdings<input type="search" placeholder="Ticker, e.g. AAPL" value={search} onChange={e => setSearch(e.target.value)}/></label>
            <p className="note">Search filters the rows below. Totals above cover {data.unpricedValue > 0 ? `listed securities; ${money(data.unpricedValue)} in cash, bonds held directly and property has no daily price and is left out` : 'your full portfolio'}.</p>
            {shared.length > 0 && <p className="note shared-reasons">For every holding below: {shared.join(' ')}</p>}
            <div className="scroll"><table className="move-table"><thead><tr>{COLUMNS.map(column => <th key={column.name} scope="col"><ColumnName {...column}/></th>)}</tr></thead><tbody>
                {listed.map(h => {
                    const pick = <button className="holding-pick" aria-pressed={h.symbol === focus} onClick={() => setFocus(h.symbol === focus ? '' : h.symbol)}>{h.symbol}</button>;
                    if (h.assetType && h.assetType !== 'security')
                        return <tr key={h.symbol} className={h.symbol === focus ? 'picked' : ''}><td>{pick}<span className="note"> · {assetLabel[h.assetType]}</span></td><td colSpan={7} className="note">No daily price, so no move over a window. Worth {money(h.valueUsd)} as entered.</td></tr>;
                    const top = h.drivers[0], behind = top ? driverEvents(data, h.symbol, top.driver) : null, opened = open === h.symbol && behind !== null;
                    // A row speaks up only when it differs: a figure it lacks, or closes other than the window's.
                    const own = h.unavailableReasons.filter(reason => !shared.includes(reason)), otherCloses = h.actual !== null && (h.previousDate !== data.startDate || h.sourceDate !== data.date);
                    return <Fragment key={h.symbol}>
                        <tr className={h.symbol === focus ? 'picked' : ''}><td>{pick}</td><td className="amount">{number(h.beta, 3)}</td><td className="amount">{money(h.startValue)}</td><td className="amount">{money(h.endValue)}</td>
                            <td className={`amount ${h.actual === null ? '' : tone(h.actual)}`}>{h.actual === null ? 'Unavailable' : <>{signed(h.actual, money)}{h.startValue ? <span className="note"> {signed(h.actual / h.startValue * 100, value => `${value.toFixed(2)}%`)}</span> : null}</>}</td>
                            <td className="amount">{money(h.fromMarket)}</td><td className="amount">{money(h.beyondMarket)}</td>
                            <DriverCell holding={h} behind={behind} open={opened} onToggle={() => setOpen(opened ? '' : h.symbol)}/></tr>
                        {(own.length > 0 || otherCloses) && <tr className="row-note"><td colSpan={8} className="note">{h.symbol}: {otherCloses && `read from the closes on ${h.previousDate} and ${h.sourceDate}. `}{own.join(' ')}</td></tr>}
                        {opened && top && <tr className="row-events"><td colSpan={8}><DriverEventList moved={behind.moved} settled={behind.settled}
                            intro={`${eventLines([{ symbol: h.symbol, type: 'Measured', driver: top.driver, themes: [] }], data.holdings, data.driverChanges, money)[0].text} That is a past association with the driver, not an effect of these events.`}/></td></tr>}
                    </Fragment>;
                })}
                {!listed.length && <tr><td colSpan={8}><Empty>No holdings match your search{chosen ? ' in this category' : ''}.</Empty></td></tr>}
            </tbody></table></div>
            <p className="note">From market = measured beta × SPY’s return over the window × the holding’s value at the first close. Beyond market = change − market estimate. Price sources: Yahoo daily closes. Every row is read from the window’s two closes; a row says so underneath when a figure is missing.</p>
            {data.total === null && data.holdings.some(h => !h.assetType || h.assetType === 'security') && <p className="note">The listed-security total needs supported price moves over the same dates for every listed holding. Available individual moves are shown above.</p>}
            <p className="note">Biggest measured driver compares each driver’s estimated part of the move: its measured sensitivity × the driver’s change over the window × the holding’s value at the first close. It is highlighted when something other than the stock market mattered most.</p>
        </Card>
        <h2>Kalshi events over this window{focus ? `, linked to ${focus}` : ''}</h2>
        <p className="note">{data.oddsWindow ? <>Kalshi is read over the same window as the prices: from <time dateTime={data.oddsWindow.from}>{dateText(data.oddsWindow.from)}</time> to <time dateTime={data.oddsWindow.to}>{dateText(data.oddsWindow.to)}</time>, the two closes. </> : 'No window could be set, so no events are listed. '}
            Sharing a window is not proof of cause. Only a Related link is set beside a holding’s move, and then through its driver: the estimate is the holding’s past association with that driver, not an effect of the event.</p>
        {topicOnly > 0 && <label className="topic-toggle"><input type="checkbox" checked={topics} onChange={event => setTopics(event.target.checked)}/> Also show {topicOnly} linked only by a shared topic, with no measured connection</label>}
        <EventSection key={`settled|${focus}|${theme}|${topics}`} id="moves-settled" title="Settled in this window" count={settled.length} unit="event"
            about="Markets that closed inside the window and have a result, with the odds Kalshi gave 24 hours before each closed. Each event leads with the result furthest from those odds."
            empty={`No linked event settled in this window${focus || chosen || theme ? ' for what is in view' : ''}.`}>
            {(from, to) => settled.slice(from, to).map(event => <SettledCard key={event.ticker} event={event} rows={data.holdings} changes={data.driverChanges}/>)}
        </EventSection>
        <EventSection key={`moved|${focus}|${theme}|${topics}`} id="moves-odds" title="Odds that moved" count={moved.length} unit="event"
            about="Markets still open at the last close whose bid–ask midpoint moved 3 points or more between the two closes, biggest first. Only quotes no wider than 10 cents at both ends are compared: a wider quote’s midpoint jumps when one side of the book steps back."
            empty={`No linked market with a narrow quote at both closes moved 3 points or more${focus || chosen || theme ? ' for what is in view' : ''}.`}>
            {(from, to) => moved.slice(from, to).map(event => <MovedCard key={event.ticker} event={event} rows={data.holdings} changes={data.driverChanges}/>)}
        </EventSection>
    </>;
}

// A holding's biggest driver for the window, with the Kalshi events that sit behind it: the
// linked event whose odds moved most, and a button that opens them all in the row.
function DriverCell({ holding, behind, open, onToggle }: { holding: HoldingMove; behind: Behind | null; open: boolean; onToggle: () => void }) {
    const top = holding.drivers[0];
    if (!top || !behind)
        return <td className="driver-cell">Unavailable</td>;
    const count = behind.moved.length + behind.settled.length, lead = behind.moved[0], closed = behind.settled[0];
    return <td className={top.driver !== 'SPY' ? 'driver-cell lead' : 'driver-cell'}>{driverName(top.driver)} <span className="mono">{money(top.contribution)}</span>
        <span className="driver-event">{lead ? <>Biggest odds move among its Kalshi events: <a href={href('event', lead.markets[0].ticker)}>{lead.title}</a> <span className="mono">{points(lead.markets[0].changePoints)}</span></>
            : closed ? <>A Kalshi event linked through it settled: {closed.title ?? closed.markets[0].title} Resolved {closed.markets[0].outcome ? 'Yes' : 'No'}.</>
            : 'No Kalshi event linked through it moved or settled in this window.'}</span>
        {count > 0 && <button className="reset-filters" aria-expanded={open} onClick={onToggle}>{open ? 'Hide' : 'See'} {count === 1 ? 'the event' : `all ${count} events`}</button>}
    </td>;
}

// The Kalshi events behind a driver, opened where the driver is named: those whose odds moved,
// biggest first, then those that settled, each list a page at a time.
export function DriverEventList({ intro, moved, settled }: { intro: string; moved: Scoped<MovedEvent>[]; settled: Scoped<SettledEvent>[] }) {
    const [movedPage, setMovedPage] = useState(1), [settledPage, setSettledPage] = useState(1);
    const page = <T,>(list: T[], current: number) => list.slice((current - 1) * LIST, current * LIST);
    return <div className="driver-events">
        <p className="note">{intro}</p>
        {moved.length > 0 && <><h4>Odds that moved <span className="note">· {moved.length}</span></h4>
            <ul className="event-markets">{page(moved, movedPage).map(event => {
                const lead = event.markets[0];
                return <li key={event.ticker}><span><a href={href('event', lead.ticker)}>{event.title}</a> <span className="note">{lead.title}{event.moved > 1 ? `, and ${event.moved - 1} more of its markets` : ''}</span></span>
                    <span className="outcome"><span className="mono">{percent(lead.from)} → {percent(lead.to)}</span> <strong className={`mono ${tone(lead.changePoints)}`}>{points(lead.changePoints)}</strong></span></li>;
            })}</ul>
            <Pager page={movedPage} pages={Math.ceil(moved.length / LIST)} onPage={setMovedPage} label="Pages of odds that moved"/></>}
        {settled.length > 0 && <><h4>Settled <span className="note">· {settled.length}</span></h4>
            <ul className="event-markets">{page(settled, settledPage).map(event => {
                const lead = event.markets[0];
                return <li key={event.ticker}><span>{event.title ?? lead.title} <span className="note">{event.title ? `${lead.title} · ` : ''}closed <time dateTime={event.closeTime}>{dateText(event.closeTime)}</time>{event.settled > 1 ? ` · ${event.yes} of ${event.settled} markets resolved Yes` : ''}</span></span>
                    <Outcome market={lead}/></li>;
            })}</ul>
            <Pager page={settledPage} pages={Math.ceil(settled.length / LIST)} onPage={setSettledPage} label="Pages of settled events"/></>}
    </div>;
}

// Which driver accounted for the most over the window, across the holdings in view. `events`
// gives the Kalshi events linked through a driver, which open under its bar.
export function LeadDrivers({ drivers, changes, missing, subject, events }: { drivers: DriverMove[]; changes: DriverChange[]; missing: string[]; subject?: string; events?: (driver: string) => Behind }) {
    const [open, setOpen] = useState('');
    const lead = describeLeadMove(drivers, money);
    return <Card className="lead-drivers"><h2>What mattered most{subject ? ` for ${subject}` : ''}</h2>
        {lead ? <>
            <p className="driver-lead">{subject ? lead.replace('of your move', `of ${subject}’s move`) : lead}</p>
            <div className="driver-bars">{drivers.map((move, index) => {
                const change = changes.find(candidate => candidate.driver === move.driver);
                const behind = events?.(move.driver), count = behind ? behind.moved.length + behind.settled.length : 0, opened = open === move.driver;
                return <Fragment key={move.driver}><div className={index === 0 ? 'driver-bar lead' : 'driver-bar'}>
                    <span>{driverName(move.driver)}</span>{change && <span className="note driver-change">{describeChange(change)}</span>}<strong className={`mono ${tone(move.contribution)}`}>{money(move.contribution)}</strong>
                    {count > 0 && <button className="reset-filters" aria-expanded={opened} onClick={() => setOpen(opened ? '' : move.driver)}>{opened ? 'Hide the ' : ''}{count} Kalshi event{count === 1 ? '' : 's'}</button>}
                </div>
                {opened && behind && <DriverEventList moved={behind.moved} settled={behind.settled}
                    intro={`Kalshi events linked to ${subject ?? 'the holdings in view'} through ${driverPhrase(move.driver)}${change ? `, which ${describeChange(change)} over this window` : ''}. The estimate above is a past association with the driver, not an effect of these events.`}/>}
                </Fragment>;
            })}</div>
        </> : <Empty>No measured driver could be compared for this window.</Empty>}
        {missing.length > 0 && <p className="note">Not compared, because a reading for one end of this window is not published yet: {missing.map(driverName).join(', ')}.</p>}
        <p className="note">Each figure is a holding’s measured sensitivity × the driver’s change over the window × the holding’s value at the first close, summed over holdings. A sensitivity under a tenth of the holding’s biggest gives no estimate. The market figure is measured on its own and the others with the market held fixed, so they are compared here, not added up.</p>
    </Card>;
}

// A list of events, a page at a time. Turning the page goes back to the top of the list.
function EventSection({ id, title, count, unit, about, empty, children }: { id: string; title: string; count: number; unit: string; about: string; empty: string; children: (from: number, to: number) => ReactNode }) {
    const [page, setPage] = useState(1);
    const top = useRef<HTMLElement>(null), turned = useRef(false);
    // Once the new page is drawn, not before: the cards differ in height from page to page.
    useEffect(() => { if (turned.current) { turned.current = false; top.current?.scrollIntoView({ block: 'start' }); } }, [page]);
    const pages = Math.max(1, Math.ceil(count / PAGE)), current = Math.min(page, pages), from = (current - 1) * PAGE, to = Math.min(count, current * PAGE);
    return <section className="card move-events" id={id} ref={top}><h3>{title} <span className="note">· {count} {unit}{count === 1 ? '' : 's'}</span></h3>
        <p className="note">{about}</p>
        {count ? children(from, to) : <Empty>{empty}</Empty>}
        {pages > 1 && <p className="note pager-range">Showing {from + 1} to {to} of {count}</p>}
        <Pager page={current} pages={pages} onPage={next => { turned.current = true; setPage(next); }} label={`Pages of ${title.toLowerCase()}`}/>
    </section>;
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
