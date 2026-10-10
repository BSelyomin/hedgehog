import { afterEach, expect, it, vi } from 'vitest';
import { preparePollPage } from './poll-storage.ts';
import { oddsBeforeClose, normalizeHistoricalCandles } from './backfill.ts';
import { eventTime, isRangeLadder, marketKind } from '../services/kalshi.ts';
import type { KalshiEvent } from '../services/kalshi.ts';
import { trustScore } from '../config/trust.ts';
import { matchHolding } from '../services/matching.ts';

afterEach(() => vi.restoreAllMocks());
it('keeps valid markets when one market is invalid and retains fractional activity', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const market = { ticker: 'M', event_ticker: 'E', title: 'Outcome', close_time: '2026-11-01T00:00:00Z', status: 'active', yes_bid_dollars: '0.34', yes_ask_dollars: '0.40', volume_24h_fp: '0.01', open_interest_fp: '505.48' };
    const event = { event_ticker: 'E', series_ticker: 'S', title: 'Event', category: 'Economics', markets: [market, { ...market, ticker: 'BAD', close_time: 'invalid' }] } as KalshiEvent;
    const page = preparePollPage([event, event], new Date());
    expect(page.events).toHaveLength(1);
    expect(page.markets).toHaveLength(1);
    expect(page.quotes[0]).toMatchObject({ mid: .37, volume_24h: .01, open_interest: 505.48 });
    // Kalshi's timing fields are optional; a malformed one is stored as missing, not guessed.
    expect(page.events[0].strike_date).toBeNull();
    expect(page.markets[0]).toMatchObject({ occurrence_time: null, expected_expiration_time: null });
    const timed = preparePollPage([{ ...event, strike_date: '2026-12-31T21:00:00Z', markets: [{ ...market, occurrence_datetime: '2026-10-29T21:00:00Z', expected_expiration_time: 'soon' }] }], new Date());
    expect(timed.events[0].strike_date).toBe('2026-12-31T21:00:00Z');
    expect(timed.markets[0]).toMatchObject({ occurrence_time: '2026-10-29T21:00:00Z', expected_expiration_time: null });
    const crossed = preparePollPage([{ ...event, markets: [{ ...market, yes_bid_dollars: '.80' }] }], new Date());
    expect(crossed.markets).toHaveLength(1);
    expect(crossed.quotes).toHaveLength(0);
});
it('reads archive dollar prices without confusing them with live cent fields', () => {
    const close = '2026-10-09T12:00:00Z', ts = Date.parse(close) / 1000 - 86400;
    const candles = normalizeHistoricalCandles([{ end_period_ts: ts, yes_bid: { close: '.37' }, yes_ask: { close: '.39' } }]);
    expect(oddsBeforeClose(candles, close)?.probability).toBeCloseTo(.38);
    expect(oddsBeforeClose([{ ...candles[0], end_period_ts: ts + 60 }], close)).toBeNull();
    expect(oddsBeforeClose([{ ...candles[0], end_period_ts: ts - 120 }], close)).toBeNull();
    expect(oddsBeforeClose(normalizeHistoricalCandles([{ end_period_ts: ts, yes_bid: { close: null }, yes_ask: { close: '.39' } }]), close)).toBeNull();
});
it('classifies call-mention markets by Kalshi category and range ladders including their end caps', () => {
    expect(marketKind('custom', 'Mentions', 'What will Apple say during their next earnings call?', false)).toBe('mention');
    expect(marketKind('greater', 'Financials', 'Will Apple report above 164000 employees?', false)).toBe('kpi');
    const ladder = ['less', 'between', 'between', 'greater'];
    expect(isRangeLadder(true, ladder)).toBe(true);
    expect(ladder.map(type => marketKind(type, 'Financials', 'S&P close', true))).toEqual(['bracket', 'bracket', 'bracket', 'bracket']);
    // Thresholds without buckets, non-exclusive events and unknown strike types are not ladders.
    expect(isRangeLadder(true, ['greater', 'greater'])).toBe(false);
    expect(isRangeLadder(false, ladder)).toBe(false);
    expect(isRangeLadder(true, ['between', 'custom'])).toBe(false);
    expect(isRangeLadder(true, ['between', null])).toBe(false);
    expect(marketKind('greater', 'Financials', 'S&P above 7000', false)).toBe('kpi');
});
it('dates an event by the most specific upcoming Kalshi time and falls back to the market close', () => {
    const now = Date.parse('2026-10-10T00:00:00Z'), at = (iso: string) => new Date(iso);
    const close = at('2026-11-12T15:00:00Z'), call = at('2026-10-29T21:00:00Z'), strike = at('2026-11-01T00:00:00Z'), expected = at('2026-11-05T00:00:00Z');
    expect(eventTime(now, close, call, strike, expected)).toEqual({ time: call, source: 'occurrence' });
    expect(eventTime(now, close, null, strike, expected)).toEqual({ time: strike, source: 'strike' });
    expect(eventTime(now, close, null, null, expected)).toEqual({ time: expected, source: 'expected' });
    expect(eventTime(now, close, null, null, null)).toEqual({ time: close, source: 'close' });
    // Once the call has happened, the next date that matters is the market close.
    expect(eventTime(Date.parse('2026-10-30T00:00:00Z'), close, call, null, null)).toEqual({ time: close, source: 'close' });
    expect(eventTime(now, close, new Date('invalid'), null, null).source).toBe('close');
    // A data release after trading stops is still the event date.
    expect(eventTime(now, at('2026-11-07T03:29:00Z'), at('2026-11-14T05:00:00Z'), null, null).source).toBe('occurrence');
});
it('can award medium and high trust; no history is rescaled, not scored as zero', () => {
    expect(trustScore(1, 100000, 1000000, null, 0).band).toBe('High');
    expect(trustScore(3, 1000, 10000, null, 0).band).toBe('Medium');
    expect(trustScore(6, 0, 505.48, null, 0).band).toBe('Low');
    expect(trustScore(1, null, 1000, null, 0).total).toBeNull();
});
it('shows measured links only when shared tags and reliable history support them', () => {
    const holding = { symbol: 'DAL', valueUsd: 100 };
    const fit = { symbol: 'DAL', driver: 'CL=F', b: -.1, se: .01, low: -.1196, high: -.0804, days: 250, reliable: true, computed_at: new Date() };
    expect(matchHolding(holding, ['oil'], ['oil'], [fit])?.type).toBe('Measured');
    expect(matchHolding(holding, ['oil'], [], [fit])).toBeNull();
    expect(matchHolding(holding, ['DAL', 'oil'], ['oil'], [fit])?.type).toBe('Direct');
    const unreliable = matchHolding(holding, ['oil'], ['oil'], [{ ...fit, se: 1 }]);
    expect(unreliable?.type).toBe('Related');
    expect(unreliable?.sensitivity).toBeNull();
});
