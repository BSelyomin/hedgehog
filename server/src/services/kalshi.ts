export const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';
export interface KalshiMarket {
    ticker: string;
    event_ticker: string;
    title: string;
    subtitle?: string;
    yes_sub_title?: string;
    close_time: string;
    // When the underlying event happened; absent for many markets.
    occurrence_datetime?: string;
    status: string;
    result?: string;
    yes_bid_dollars?: string;
    yes_ask_dollars?: string;
    volume_24h_fp?: string;
    open_interest_fp?: string;
    strike_type?: string;
}
export interface KalshiEvent {
    event_ticker: string;
    series_ticker: string;
    title: string;
    sub_title?: string;
    category: string;
    mutually_exclusive: boolean;
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
export function quote(bid: unknown, ask: unknown) {
    const b = numberField(bid), a = numberField(ask);
    if (b === null || a === null || b < 0 || a > 1 || b > a)
        return null;
    return { bid: b, ask: a, mid: (a + b) / 2 };
}
