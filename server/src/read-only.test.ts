import { describe, expect, it, vi } from 'vitest';
import { errorResponse } from './app.ts';
import { LINKABLE_TOPICS, preparePollPage } from './jobs/poll-storage.ts';
import type { KalshiEvent } from './services/kalshi.ts';

describe('a read-only database', () => {
    it('tells the user that changes cannot be saved instead of a generic failure', () => {
        const refused = Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' });
        expect(errorResponse(refused)).toEqual({ status: 503, error: 'The database is read-only right now, so changes cannot be saved. Viewing still works' });
        expect(errorResponse(new Error('connection refused'))).toEqual({ status: 503, error: 'Data unavailable; check backend configuration' });
        expect(errorResponse(new SyntaxError('Unexpected token'))).toEqual({ status: 400, error: 'Invalid JSON' });
        expect(errorResponse(null).status).toBe(503);
    });
});

describe('which markets keep odds history', () => {
    const market = { ticker: 'M', event_ticker: 'E', title: 'Outcome', close_time: '2026-11-01T00:00:00Z', status: 'active', yes_bid_dollars: '0.34', yes_ask_dollars: '0.40', volume_24h_fp: '10', open_interest_fp: '50' };
    const event = (series: string, ticker: string) => ({ event_ticker: `E-${ticker}`, series_ticker: series, title: 'Event', category: 'Economics', markets: [{ ...market, ticker }] }) as KalshiEvent;
    it('stores a quote only for linkable series while keeping every market and event', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = preparePollPage([event('KXFED', 'RATE'), event('KXSOCCER', 'GOAL')], new Date(), new Set(['KXFED']));
        expect(page.events).toHaveLength(2);
        expect(page.markets.map(m => m.ticker)).toEqual(['RATE', 'GOAL']);
        expect(page.quotes.map(q => q.ticker)).toEqual(['RATE']);
        // Without a filter every quoted market is stored, as before.
        expect(preparePollPage([event('KXFED', 'RATE'), event('KXSOCCER', 'GOAL')], new Date()).quotes).toHaveLength(2);
        expect(preparePollPage([event('KXSOCCER', 'GOAL')], new Date(), new Set()).quotes).toEqual([]);
    });
    it('treats every measured driver and asset-type topic as linkable', () => {
        for (const tag of ['oil', 'fed-rates', 'inflation', 'sp500', 'treasury-yields', 'mortgage-rates', 'housing', 'hurricanes', 'credit-defaults'])
            expect(LINKABLE_TOPICS).toContain(tag);
        expect(new Set(LINKABLE_TOPICS).size).toBe(LINKABLE_TOPICS.length);
    });
});
