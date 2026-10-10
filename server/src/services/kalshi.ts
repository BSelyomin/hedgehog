export const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';
export interface KalshiMarket {
    ticker: string;
    event_ticker: string;
    title: string;
    subtitle?: string;
    yes_sub_title?: string;
    close_time: string;
    open_time?: string;
    occurrence_datetime?: string;
    expected_expiration_time?: string;
    status: string;
    settlement_ts?: string;
    is_provisional?: boolean;
    market_type?: string;
    mve_collection_ticker?: string;
    mve_selected_legs?: unknown[];
    result?: string;
    yes_bid_dollars?: string;
    yes_ask_dollars?: string;
    volume_24h_fp?: string;
    open_interest_fp?: string;
    strike_type?: string;
    floor_strike?: number;
    cap_strike?: number;
}
export interface KalshiEvent {
    event_ticker: string;
    series_ticker: string;
    title: string;
    sub_title?: string;
    category: string;
    mutually_exclusive: boolean;
    strike_date?: string;
    markets?: KalshiMarket[];
}
export interface Candle {
    end_period_ts: number;
    yes_bid: {
        close_dollars: string | null;
    };
    yes_ask: {
        close_dollars: string | null;
    };
}
// The archive uses dollar strings named `close`, unlike live `close_dollars`.
export interface HistoricalCandle {
    end_period_ts: number;
    yes_bid: { close: string | null };
    yes_ask: { close: string | null };
}
export const numberField = (value: unknown): number | null => { if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'string' && value.trim() === ''))
    return null; const n = Number(value); return Number.isFinite(n) ? n : null; };
export async function kalshi<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${KALSHI_BASE}${path}`);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 0; attempt < 5; attempt++) {
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (response.ok)
            return await response.json() as T;
        if (response.status !== 429 && response.status < 500)
            throw new Error(`Kalshi HTTP ${response.status}`);
        if (attempt === 4)
            throw new Error('Kalshi retry limit');
        const retry = Number(response.headers.get('retry-after'));
        await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(1000 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0))));
    }
    throw new Error('Kalshi request failed');
}
// Strike types observed in stored Kalshi markets. A range ladder is an exclusive event of
// 'between' buckets plus optional open-ended end caps ("86° or below", "95° or above").
const rangeStrikes = ['between', 'less', 'less_or_equal', 'greater', 'greater_or_equal'];
export function isRangeLadder(mutuallyExclusive: boolean, strikeTypes: (string | null)[]) {
    return mutuallyExclusive && strikeTypes.includes('between') && strikeTypes.every(type => type !== null && rangeStrikes.includes(type));
}
// Kalshi files earnings-call word markets under its 'Mentions' category; their titles do not say "mention".
export function marketKind(strikeType: string | null, category: string, title: string, inRangeLadder: boolean): 'bracket' | 'kpi' | 'mention' {
    if (strikeType === 'between' || inRangeLadder)
        return 'bracket';
    return category === 'Mentions' || /mention/i.test(title) ? 'mention' : 'kpi';
}
export type EventTimeSource = 'occurrence' | 'stated' | 'strike' | 'expected' | 'close';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Kalshi states the date of some events in the subtitle, for example "On Oct 29, 2026" on an
// earnings call. Returns it as YYYY-MM-DD, or null when the subtitle is not such a date.
export function statedDate(description: string | null | undefined): string | null {
    const match = /^On ([A-Za-z]{3})[a-z]* (\d{1,2}), (\d{4})\b/.exec(description ?? '');
    const month = match ? MONTHS.indexOf(match[1].toLowerCase()) : -1;
    if (!match || month < 0)
        return null;
    const date = `${match[3]}-${String(month + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
    const parsed = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}
export const newYorkDate = (time: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);
// Noon in New York on a calendar date, as an instant: a neutral time for an event dated by day only.
export function newYorkNoon(date: string): Date {
    const summer = new Date(`${date}T16:00:00Z`);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' }).format(summer) === '12' ? summer : new Date(`${date}T17:00:00Z`);
}
// When the underlying event happens, from Kalshi's own fields, most specific first: the market's
// occurrence_datetime, the event's strike_date, then expected_expiration_time. A time that has
// already passed is skipped, because the next date that matters is then the market close.
//
// When Kalshi states the event's date in its subtitle, that day wins. For about a third of
// earnings-call markets the occurrence time holds a later administrative date instead (Netflix's
// call "On Oct 20" carried an occurrence time of Nov 4), so a precise time is kept only when it
// falls on the stated day; otherwise the event is dated by day alone.
export function eventTime(now: number, closeTime: Date, occurrence: Date | null, strike: Date | null, expected: Date | null, stated: string | null = null): { time: Date; source: EventTimeSource } {
    const upcoming = (time: Date | null): time is Date => time !== null && Number.isFinite(time.getTime()) && time.getTime() > now;
    if (stated) {
        const exact: [EventTimeSource, Date | null][] = [['occurrence', occurrence], ['strike', strike]];
        const onDay = exact.filter(([, time]) => time !== null && Number.isFinite(time.getTime()) && newYorkDate(time) === stated);
        for (const [source, time] of onDay)
            if (upcoming(time))
                return { time, source };
        const noon = newYorkNoon(stated);
        if (!onDay.length && noon.getTime() + 12 * 3600000 > now)
            return { time: noon, source: 'stated' };
        // The stated day has passed: what is still ahead is the market's own end.
        return upcoming(expected) ? { time: expected, source: 'expected' } : { time: closeTime, source: 'close' };
    }
    const candidates: [EventTimeSource, Date | null][] = [['occurrence', occurrence], ['strike', strike], ['expected', expected]];
    for (const [source, time] of candidates)
        if (time && Number.isFinite(time.getTime()) && time.getTime() > now)
            return { time, source };
    return { time: closeTime, source: 'close' };
}
// A book with no bid and no offer is not a quote: 0 and 1 would average to a 50% that nobody
// posted. The poller still stores such a reading, so that readers know the book is empty now
// and do not fall back on an older quote; every reader then treats it as no probability.
export const emptyBook = (bid: number | null | undefined, ask: number | null | undefined) => bid != null && ask != null && bid <= 0 && ask >= 1;
// The same test in SQL, for queries over odds_snapshots.
export const QUOTED = 'NOT (yes_bid<=0 AND yes_ask>=1)';
// The bid-ask spread of a stored reading, or null when it holds no usable quote.
export const quotedSpread = (bid: number | null | undefined, ask: number | null | undefined) => bid == null || ask == null || emptyBook(bid, ask) ? null : ask - bid;
export function quote(bid: unknown, ask: unknown) {
    const b = numberField(bid), a = numberField(ask);
    if (b === null || a === null || b < 0 || a > 1 || b > a)
        return null;
    return { bid: b, ask: a, mid: (a + b) / 2 };
}
