import type { DriverChange, DriverMove, HoldingMove, LinkType, MoveLink, MoveRange, MovedEvent, SettledEvent } from '../../../shared/types';
import { driverPhrase } from './sensitivity';

// The windows the Moves screen offers, each ending on the chosen close.
export const RANGES: { key: MoveRange; label: string }[] = [
    { key: 'day', label: '1 day' }, { key: 'week', label: '1 week' }, { key: 'month', label: '1 month' }, { key: 'quarter', label: '3 months' },
];

// What the screen is looking at: one holding when one is picked, otherwise the chosen category,
// otherwise everything.
export function scopeRows(holdings: HoldingMove[], chosen: Set<string> | null, focus: string): HoldingMove[] {
    return holdings.filter(holding => focus ? holding.symbol === focus : !chosen || chosen.has(holding.symbol));
}

// Each driver's estimates added up over the rows in view, in whole cents, largest first whatever
// its direction. As for the whole portfolio, they overlap and are compared, never summed.
export function scopeDrivers(rows: HoldingMove[]): DriverMove[] {
    const cents = new Map<string, number>();
    for (const move of rows.flatMap(row => row.drivers))
        cents.set(move.driver, (cents.get(move.driver) ?? 0) + Math.round(move.contribution * 100));
    return [...cents].map(([driver, total]) => ({ driver, contribution: total / 100 }))
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.driver.localeCompare(b.driver));
}

// An event with the links that fall inside the view.
export type Scoped<T> = T & { shown: MoveLink[] };
// The events linked to the holdings in view, through the chosen theme. An event tied to them
// only by an unmeasured topic is kept when `topics` asks for it, as on the Calendar. With a
// `driver`, only the measured links that run through that driver count.
export function scopeEvents<T extends { links: MoveLink[] }>(events: T[], symbols: Set<string> | null, theme: string, topics: boolean, driver = ''): Scoped<T>[] {
    return events.flatMap(event => {
        const shown = event.links.filter(link => (!symbols || symbols.has(link.symbol)) && (!theme || link.themes.includes(theme)) && (topics || link.type !== 'Related')
            && (!driver || (link.type === 'Measured' && link.driver === driver)));
        return shown.length ? [{ ...event, shown }] : [];
    });
}

// A driver is a price or a yield, not an event: many Kalshi events sit behind each one. These
// are the ones linked to a holding through a driver, in the order the lists show them, so the
// first whose odds moved is the one that moved most.
export function driverEvents(data: { movedEvents: MovedEvent[]; settledEvents: SettledEvent[] }, symbol: string, driver: string) {
    const only = new Set([symbol]);
    return { moved: scopeEvents(data.movedEvents, only, '', false, driver), settled: scopeEvents(data.settledEvents, only, '', false, driver) };
}

export const signed = (value: number, money: (value: number) => string) => `${value > 0 ? '+' : ''}${money(value)}`;

// How far a driver moved over the window, in words. A price is given as a percentage, a yield
// in percentage points.
export function describeChange(change: DriverChange): string {
    const size = Math.abs(change.kind === 'return' ? change.change * 100 : change.change);
    const text = change.kind === 'return' ? `${size.toFixed(size < 1 ? 2 : 1)}%` : `${size.toFixed(2)} percentage points`;
    return Number(size.toFixed(2)) === 0 ? 'was unchanged' : `${change.change > 0 ? 'rose' : 'fell'} ${text}`;
}

const list = (symbols: string[]) => symbols.length < 3 ? symbols.join(' and ') : `${symbols.slice(0, -1).join(', ')} and ${symbols.at(-1)}`;

export interface EventLine {
    type: LinkType;
    symbols: string[];
    text: string;
}
// What an event has to do with the moves in view, one line per kind of link. Only a measured
// link is tied to a holding's move, and then through its driver: the driver's own change over
// the window and the estimate the holding's measured sensitivity gives. Nothing here says the
// event caused anything.
export function eventLines(links: MoveLink[], rows: HoldingMove[], changes: DriverChange[], money: (value: number) => string): EventLine[] {
    const row = (symbol: string) => rows.find(holding => holding.symbol === symbol);
    const lines: EventLine[] = [];
    for (const link of links.filter(candidate => candidate.type === 'Direct')) {
        const holding = row(link.symbol);
        lines.push({ type: 'Direct', symbols: [link.symbol], text: holding && holding.actual !== null && holding.startValue !== null && holding.endValue !== null
            ? `About ${link.symbol} itself, which went from ${money(holding.startValue)} to ${money(holding.endValue)} over this window (${signed(holding.actual, money)}). Nothing measured ties this event to that move.`
            : `About ${link.symbol} itself. Its move over this window is unavailable.` });
    }
    const measured = links.filter(link => link.type === 'Measured' && link.driver);
    for (const driver of [...new Set(measured.map(link => link.driver!))]) {
        const symbols = measured.filter(link => link.driver === driver).map(link => link.symbol), change = changes.find(candidate => candidate.driver === driver);
        const estimate = (symbol: string) => row(symbol)?.drivers.find(move => move.driver === driver)?.contribution;
        const estimated = symbols.filter(symbol => estimate(symbol) !== undefined), rest = symbols.filter(symbol => estimate(symbol) === undefined);
        const through = `Related through ${driverPhrase(driver)}`;
        let text: string;
        if (!change || !estimated.length)
            text = `${through}: ${list(symbols)}. ${change ? `It ${describeChange(change)} over this window, but` : 'Its change over this window is not available, so'} there is no estimate to set beside this event.`;
        else {
            const total = estimated.reduce((sum, symbol) => sum + Math.round(estimate(symbol)! * 100), 0) / 100, only = estimated.length === 1 ? row(estimated[0]) : undefined;
            text = `${through}, which ${describeChange(change)} over this window. `
                + (only ? `${only.symbol}’s measured link to it puts about ${signed(total, money)} of its ${signed(only.actual!, money)} move there.`
                    : `Their measured links to it put about ${signed(total, money)} of the moves in ${list(estimated)} there.`)
                + (rest.length ? ` No estimate for ${list(rest)}.` : '');
        }
        lines.push({ type: 'Measured', symbols, text });
    }
    const calculated = links.filter(link => link.type === 'Calculated').map(link => link.symbol);
    if (calculated.length)
        lines.push({ type: 'Calculated', symbols: calculated, text: `Calculated link to ${list(calculated)}, which ${calculated.length === 1 ? 'has' : 'have'} no daily price and so no move to set beside this event.` });
    const topic = links.filter(link => link.type === 'Related').map(link => link.symbol);
    if (topic.length)
        lines.push({ type: 'Related', symbols: topic, text: `Shares a topic with ${list(topic)}. No measured connection.` });
    return lines;
}
