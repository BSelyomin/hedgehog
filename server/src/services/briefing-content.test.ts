import { describe, it, expect } from 'vitest';
import { briefingDay, buildBriefing, morningReady } from './briefing-content.ts';
import type { ExposureResponse, ExposureEvent, MovesResponse } from '../../../shared/types.ts';
const now = new Date('2026-10-12T12:00:00Z');
function event(title: string, closeTime: string, asOf = now.toISOString()): ExposureEvent {
    return { title, closeTime, share: .3, markets: [{title, probability: .7, asOf}], links: [] } as unknown as ExposureEvent;
}
function portfolio(events: ExposureEvent[], asOf: string | null = now.toISOString()): ExposureResponse {
    return {events, asOf} as ExposureResponse;
}
describe('morning briefing', () => {
    it('uses New York dates across UTC midnight and daylight saving changes', () => {
        expect(briefingDay(new Date('2026-10-10T01:00:00Z'))).toBe('2026-10-09');
        expect(briefingDay(new Date('2026-11-02T04:30:00Z'))).toBe('2026-11-01');
    });
    it('waits for 8 a.m. New York before generating the daily cache', () => {
        expect(morningReady(new Date('2026-10-12T11:59:00Z'))).toBe(false);
        expect(morningReady(now)).toBe(true);
        expect(morningReady(new Date('2026-11-02T12:59:00Z'))).toBe(false);
        expect(morningReady(new Date('2026-11-02T13:00:00Z'))).toBe(true);
    });
    it('reports the supplied completed session and reconciled move components', () => {
        const text = buildBriefing(portfolio([]), {date:'2026-10-09',total:-12.5,fromMarket:-10,beyondMarket:-2.5,oddsMoves:[],spyReturn:0,holdings:[],drivers:[],missingDrivers:[],unpricedValue:0,asOf:now.toISOString()} as MovesResponse, now);
        expect(text).toContain('October 9, 2026'); expect(text).toContain('down 12.50 dollars'); expect(text).toContain('down 2.50 dollars');
    });
    it('includes events beyond seven days, earliest first, and omits closed events', () => {
        const text = buildBriefing(portfolio([event('Later','2026-12-01T00:00:00Z'),event('Sooner','2026-11-01T00:00:00Z'),event('Closed','2026-10-01T00:00:00Z')]),null,now);
        expect(text).toContain('Sooner'); expect(text).not.toContain('Later'); expect(text).not.toContain('Closed');expect(text).toContain('yes at 70 percent');
    });
    it('omits stale or future quotes and never combines multiple outcomes into one probability', () => {
        const stale=event('Stale','2026-11-01T00:00:00Z','2026-10-11T12:00:00Z');
        const future=event('Future','2026-11-02T00:00:00Z','2026-10-12T13:00:00Z');
        const multiple=event('Multiple','2026-11-03T00:00:00Z'); multiple.markets.push({...multiple.markets[0]});
        expect(buildBriefing(portfolio([stale,future,multiple],'2026-10-11T12:00:00Z'),null,now)).not.toContain('yes at 70 percent');
    });
    it('gives an honest briefing when prices and events are missing', () => {
        const text=buildBriefing(portfolio([],null),null,now);
        expect(text).toContain('waiting for a complete view');expect(text).toContain('watchlist is still incomplete');expect(text).toContain('current odds are unavailable');
    });
});
