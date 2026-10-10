import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OddsChart, OddsPlot } from './screens/odds-chart';
import { RANGES, nearestIndex, probabilityAxis, readingStats, stepPath, timeTicks } from './screens/odds-chart-scale';
import type { OddsHistoryResponse } from '../../shared/types';

// Local times, so the expectations hold in any time zone.
const at = (month: number, day: number, hour = 0, minute = 0, year = 2026) => new Date(year, month - 1, day, hour, minute).getTime();
const history = (overrides: Partial<OddsHistoryResponse> = {}): OddsHistoryResponse => ({ ticker: 'M', range: 'week', from: new Date(at(10, 3, 15)).toISOString(), to: new Date(at(10, 10, 15)).toISOString(), listed: new Date(at(10, 1, 9)).toISOString(), asOf: null,
    points: [[4, .4], [6, .35], [8, .62], [10, .58]].map(([day, probability]) => ({ ts: new Date(at(10, day, 12)).toISOString(), probability })), ...overrides });

describe('time axis', () => {
    it('marks every four hours across a day and names the date at midnight', () => {
        const ticks = timeTicks(at(10, 9, 14, 30), at(10, 10, 14, 30), 650);
        expect(ticks.map(tick => new Date(tick.time).getHours())).toEqual([16, 20, 0, 4, 8, 12]);
        expect(ticks[2].label).toBe(new Date(at(10, 10)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
        expect(ticks[0].label).toBe(new Date(at(10, 9, 16)).toLocaleTimeString(undefined, { hour: 'numeric' }));
    });
    it('marks each midnight across a week and each week across a month', () => {
        const week = timeTicks(at(10, 3, 15), at(10, 10, 15), 650);
        expect(week.map(tick => new Date(tick.time).getDate())).toEqual([4, 5, 6, 7, 8, 9, 10]);
        const month = timeTicks(at(9, 10, 15), at(10, 10, 15), 650);
        expect(month.map(tick => new Date(tick.time).getDate())).toEqual([17, 24, 1, 8]);
        expect(month.every(tick => new Date(tick.time).getHours() === 0)).toBe(true);
    });
    it('marks quarters across a year and years across a decade', () => {
        const year = timeTicks(at(10, 13, 14, 0, 2025), at(10, 10, 15), 650);
        expect(year.map(tick => new Date(tick.time).getMonth())).toEqual([0, 3, 6, 9]);
        expect(year[0].label).toBe(new Date(2026, 0, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }));
        expect(timeTicks(at(1, 5, 0, 0, 2019), at(10, 10, 15), 650).map(tick => tick.label)).toEqual(['2020', '2021', '2022', '2023', '2024', '2025', '2026']);
    });
    it('never lets two labels touch, down to a phone, and still dates a week there', () => {
        for (const [from, to] of [[at(10, 9, 14), at(10, 10, 14)], [at(10, 3), at(10, 10)], [at(9, 10), at(10, 10)], [at(10, 13, 0, 0, 2025), at(10, 10)], [at(10, 10, 9), at(10, 10, 11)]])
            for (const width of [250, 400, 650, 1000]) {
                const ticks = timeTicks(from, to, width), longest = Math.max(...ticks.map(tick => tick.label.length));
                expect(ticks.length, `${from} ${width}`).toBeGreaterThan(0);
                expect(ticks.length, `${from} ${width}`).toBeLessThanOrEqual(8);
                expect(ticks.every(tick => tick.time >= from && tick.time <= to)).toBe(true);
                for (let i = 1; i < ticks.length; i++)
                    expect((ticks[i].time - ticks[i - 1].time) / (to - from) * width, `${from} ${width}`).toBeGreaterThanOrEqual(longest * 7.3 + 14);
            }
        expect(timeTicks(at(10, 3, 15), at(10, 10, 15), 250).map(tick => new Date(tick.time).getDate())).toEqual([5, 7, 9]);
        expect(timeTicks(at(10, 9, 15), at(10, 10, 15), 250).map(tick => new Date(tick.time).getHours())).toEqual([18, 0, 6, 12]);
        // A wide axis still prefers a few round dates to many odd ones: months across five months.
        expect(timeTicks(at(5, 19, 16), at(10, 10, 15), 760).map(tick => [new Date(tick.time).getMonth() + 1, new Date(tick.time).getDate()])).toEqual([[6, 1], [7, 1], [8, 1], [9, 1], [10, 1]]);
    });
});

describe('probability axis', () => {
    it('zooms to the readings on round levels', () => {
        expect(probabilityAxis(.515, .895)).toEqual({ min: 50, max: 90, ticks: [50, 60, 70, 80, 90] });
        expect(probabilityAxis(.3, .85)).toEqual({ min: 25, max: 100, ticks: [25, 50, 75, 100] });
        expect(probabilityAxis(.005, .99)).toEqual({ min: 0, max: 100, ticks: [0, 25, 50, 75, 100] });
    });
    it('never zooms closer than ten points, so a flat line stays flat', () => {
        expect(probabilityAxis(.845, .875)).toEqual({ min: 80, max: 95, ticks: [80, 85, 90, 95] });
        expect(probabilityAxis(.85, .85)).toEqual({ min: 80, max: 90, ticks: [80, 82, 84, 86, 88, 90] });
        for (const [low, high] of [[.845, .875], [.85, .85], [.5, .52], [.123, .19]])
            expect(probabilityAxis(low, high).max - probabilityAxis(low, high).min).toBeGreaterThanOrEqual(10);
    });
    it('stays between 0% and 100% and always contains the readings', () => {
        expect(probabilityAxis(.02, .04)).toEqual({ min: 0, max: 10, ticks: [0, 2, 4, 6, 8, 10] });
        expect(probabilityAxis(.97, .99)).toEqual({ min: 90, max: 100, ticks: [90, 92, 94, 96, 98, 100] });
        for (const [low, high] of [[0, 0], [1, 1], [0, 1], [.02, .04], [.97, .99], [.455, .61], [.07, .93], [.9, .9]]) {
            const axis = probabilityAxis(low, high);
            expect(axis.min).toBeGreaterThanOrEqual(0);
            expect(axis.max).toBeLessThanOrEqual(100);
            expect(axis.min).toBeLessThanOrEqual(low * 100);
            expect(axis.max).toBeGreaterThanOrEqual(high * 100);
            expect(axis.ticks.length).toBeLessThanOrEqual(6);
            expect(axis.ticks[0]).toBe(axis.min);
            expect(axis.ticks.at(-1)).toBe(axis.max);
        }
    });
});

describe('odds line', () => {
    it('holds each reading until the next one rather than sloping between them', () => {
        expect(stepPath([{ x: 10, y: 100 }, { x: 50, y: 100 }, { x: 90, y: 40 }])).toBe('M10,100H50V100H90V40');
        expect(stepPath([])).toBe('');
    });
    it('finds the reading nearest the pointer', () => {
        expect([0, 24, 26, 60, 500].map(x => nearestIndex([10, 40, 90], x))).toEqual([0, 0, 1, 1, 2]);
    });
    it('reads its summary straight from the readings', () => {
        expect(readingStats(history().points)).toEqual({ start: .4, low: .35, high: .62, latest: .58 });
        expect(readingStats([])).toBeNull();
    });
});

describe('odds chart', () => {
    it('titles both axes, labels the scale and summarises the readings', () => {
        const html = renderToStaticMarkup(<OddsPlot data={history()}/>);
        expect(html).toContain('>Chance of yes (bid–ask midpoint)</text>');
        expect(html).toContain('class="axis-title">Date</text>');
        // Readings from 35% to 62% are drawn on a 30% to 70% scale.
        for (const level of ['30%', '40%', '50%', '60%', '70%'])
            expect(html).toContain(`class="tick">${level}</text>`);
        expect(html).not.toContain('class="tick">100%</text>');
        expect(html).toContain('aria-label="Past week: chance of yes went from 40.0% to 58.0%, between 35.0% and 62.0%."');
        expect(html).toContain('Start <strong class="mono">40.0%</strong>');
        expect(html).toContain('Latest <strong class="mono">58.0%</strong>');
        expect(html).toContain('4 readings from');
        expect(html).toContain('Kalshi listed this market');
        // Three steps for four readings.
        const line = /<path d="([^"]+)" class="line"/.exec(html)![1];
        expect(line.match(/H/g)).toHaveLength(3);
        expect(line.match(/V/g)).toHaveLength(3);
    });
    it('titles the time axis for what it shows, even when all time is only two days', () => {
        const young = history({ range: 'all', from: new Date(at(10, 8, 16)).toISOString(), points: [[9, .36], [10, .56]].map(([day, probability]) => ({ ts: new Date(at(10, day)).toISOString(), probability })) });
        expect(renderToStaticMarkup(<OddsPlot data={young}/>)).toContain('class="axis-title">Time (your time zone)</text>');
        expect(renderToStaticMarkup(<OddsPlot data={history({ range: 'all' })}/>)).toContain('class="axis-title">Date</text>');
    });
    it('names the time axis for the past day and says what each range draws', () => {
        const html = renderToStaticMarkup(<OddsPlot data={history({ range: 'day', from: new Date(at(10, 9, 15)).toISOString(), points: [[10, .4], [13, .5]].map(([hour, probability]) => ({ ts: new Date(at(10, 10, hour)).toISOString(), probability })) })}/>);
        expect(html).toContain('class="axis-title">Time (your time zone)</text>');
        expect(html).toContain('Every reading Hedgehog stored in the past 24 hours');
        expect(RANGES.map(range => range.label)).toEqual(['1D', '1W', '1M', 'All']);
    });
    it('draws nothing from fewer than two readings', () => {
        const html = renderToStaticMarkup(<OddsPlot data={history({ points: history().points.slice(0, 1) })}/>);
        expect(html).toContain('Not enough odds history for this range yet.');
        expect(html).not.toContain('<svg');
    });
    it('offers the four ranges as buttons, starting on the past week', () => {
        const html = renderToStaticMarkup(<OddsChart ticker="M" name="Above 4%"/>);
        expect(html).toContain('<h3>Past week · Above 4%</h3>');
        expect(html.match(/<button/g)).toHaveLength(4);
        expect(html).toContain('<button aria-pressed="true" aria-label="Past week" class="active">1W</button>');
        expect(html).toContain('<button aria-pressed="false" aria-label="All time" class="">All</button>');
    });
});
