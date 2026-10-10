export const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';
export interface KalshiMarket {
    ticker: string;
    event_ticker: string;
    title: string;
    subtitle?: string;
    yes_sub_title?: string;
    close_time: string;
    occurrence_datetime?: string;
    expected_expiration_time?: string;
    status: string;
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
export type EventTimeSource = 'occurrence' | 'strike' | 'expected' | 'close';
// When the underlying event happens, from Kalshi's own fields, most specific first: the market's
// occurrence_datetime, the event's strike_date, then expected_expiration_time. A time that has
// already passed is skipped, because the next date that matters is then the market close.
export function eventTime(now: number, closeTime: Date, occurrence: Date | null, strike: Date | null, expected: Date | null): { time: Date; source: EventTimeSource } {
    const candidates: [EventTimeSource, Date | null][] = [['occurrence', occurrence], ['strike', strike], ['expected', expected]];
    for (const [source, time] of candidates)
        if (time && Number.isFinite(time.getTime()) && time.getTime() > now)
            return { time, source };
    return { time: closeTime, source: 'close' };
}
export function quote(bid: unknown, ask: unknown) {
    const b = numberField(bid), a = numberField(ask);
    if (b === null || a === null || b < 0 || a > 1 || b > a)
        return null;
    return { bid: b, ask: a, mid: (a + b) / 2 };
}
