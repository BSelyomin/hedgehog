import type { OddsRange, OddsReading } from '../../../shared/types';

// The ranges the event chart offers. `detail` says what each one draws.
export const RANGES: { key: OddsRange; label: string; title: string; detail: string }[] = [
    { key: 'day', label: '1D', title: 'Past day', detail: 'Every reading Hedgehog stored in the past 24 hours, with Kalshi’s hourly closes.' },
    { key: 'week', label: '1W', title: 'Past week', detail: 'Hourly: Kalshi’s hourly closes, with Hedgehog’s last reading of each hour.' },
    { key: 'month', label: '1M', title: 'Past month', detail: 'Daily: Kalshi’s close for each day, ending at the latest reading.' },
    { key: 'all', label: 'All', title: 'All time', detail: 'Daily: Kalshi’s close for each day since it listed the market, ending at the latest reading.' },
];

type Unit = 'hour' | 'day' | 'month' | 'year';
const STEPS: [Unit, number][] = [['hour', 1], ['hour', 2], ['hour', 4], ['hour', 6], ['hour', 12], ['day', 1], ['day', 2], ['day', 7], ['day', 14],
    ['month', 1], ['month', 3], ['month', 6], ['year', 1], ['year', 2], ['year', 5], ['year', 10]];

// Tick positions fall on round local times: whole hours, midnights, firsts of the month.
function floorTo(time: number, unit: Unit, count: number) {
    const d = new Date(time);
    return unit === 'hour' ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(d.getHours() / count) * count)
        : unit === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate())
        : unit === 'month' ? new Date(d.getFullYear(), Math.floor(d.getMonth() / count) * count, 1)
        : new Date(Math.floor(d.getFullYear() / count) * count, 0, 1);
}
function advance(d: Date, unit: Unit, count: number) {
    return unit === 'hour' ? new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + count)
        : unit === 'day' ? new Date(d.getFullYear(), d.getMonth(), d.getDate() + count)
        : unit === 'month' ? new Date(d.getFullYear(), d.getMonth() + count, 1)
        : new Date(d.getFullYear() + count, 0, 1);
}
function tickLabel(d: Date, unit: Unit) {
    if (unit === 'hour' && d.getHours() !== 0)
        return d.toLocaleTimeString(undefined, { hour: 'numeric' });
    return unit === 'year' ? String(d.getFullYear())
        : unit === 'month' ? d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Width of one character of the 12px monospace tick labels, the space kept between two labels,
// and the most labels an axis carries.
const CHARACTER = 7.3, SPACE = 14, MOST = 8;

// The finest round step whose labels fit side by side along an axis `width` pixels long. `hourly`
// says the labels are times of day, so the axis can be titled for what it shows: a market listed
// two days ago has an all-time chart measured in hours.
export function timeTicks(from: number, to: number, width: number): { time: number; label: string; hourly: boolean }[] {
    let ticks: { time: number; label: string; hourly: boolean }[] = [];
    for (const [unit, count] of STEPS) {
        ticks = [];
        for (let d = floorTo(from, unit, count), guard = 0; d.getTime() <= to && guard < 400; guard++) {
            if (d.getTime() >= from)
                ticks.push({ time: d.getTime(), label: tickLabel(d, unit), hourly: unit === 'hour' });
            const next = advance(d, unit, count);
            if (next.getTime() <= d.getTime())
                break;
            d = next;
        }
        const room = Math.max(0, ...ticks.map(tick => tick.label.length)) * CHARACTER + SPACE;
        if (ticks.length <= MOST && ticks.every((tick, i) => i === 0 || (tick.time - ticks[i - 1].time) / Math.max(1, to - from) * width >= room))
            return ticks;
    }
    return ticks;
}

// The probability axis, in points. It zooms to the readings so that a move of a few points can be
// seen, but never to a span under ten points, so that noise is not drawn as a swing.
export function probabilityAxis(low: number, high: number): { min: number; max: number; ticks: number[] } {
    const points = (value: number) => Math.round(value * 1e8) / 1e6;
    let lo = points(low), hi = points(high);
    if (hi - lo < 10)
        [lo, hi] = [(lo + hi) / 2 - 5, (lo + hi) / 2 + 5];
    if (lo < 0)
        [lo, hi] = [0, hi - lo];
    if (hi > 100)
        [lo, hi] = [lo - (hi - 100), 100];
    for (const step of [2, 5, 10]) {
        const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
        if ((max - min) / step <= 5)
            return { min, max, ticks: Array.from({ length: (max - min) / step + 1 }, (_, i) => min + i * step) };
    }
    const min = Math.floor(lo / 25) * 25, max = Math.ceil(hi / 25) * 25;
    return { min, max, ticks: Array.from({ length: (max - min) / 25 + 1 }, (_, i) => min + i * 25) };
}

// A stepped line: each reading holds until the next one, which is how a quote behaves. A straight
// line between two readings days apart would draw a gradual change that did not happen.
export function stepPath(points: { x: number; y: number }[]): string {
    return points.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `H${p.x}V${p.y}`).join('');
}

export function nearestIndex(xs: number[], x: number): number {
    let best = 0;
    for (let i = 1; i < xs.length; i++)
        if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x))
            best = i;
    return best;
}

// Read straight from the readings drawn; nothing is estimated.
export function readingStats(points: OddsReading[]) {
    if (!points.length)
        return null;
    const values = points.map(p => p.probability);
    return { start: values[0], low: Math.min(...values), high: Math.max(...values), latest: values.at(-1)! };
}
