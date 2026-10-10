'use client';
import { useEffect, useRef, useState } from 'react';
import type { OddsHistoryResponse, OddsRange } from '../../../shared/types';
import { percent, dateText, useData, Status, Empty } from '../common';
import { RANGES, timeTicks, probabilityAxis, stepPath, nearestIndex, readingStats } from './odds-chart-scale';

// One market's odds over time, with a choice of how far back to look.
export function OddsChart({ ticker, name }: { ticker: string; name: string }) {
    const [range, setRange] = useState<OddsRange>('week');
    const { data, error } = useData<OddsHistoryResponse>(`/odds/${encodeURIComponent(ticker)}?range=${range}`);
    const view = RANGES.find(r => r.key === range)!;
    return <div className="odds-chart">
        <div className="odds-chart-head">
            <h3>{view.title} · {name}</h3>
            <div className="toggle range-toggle" role="group" aria-label="How far back the chart looks">
                {RANGES.map(r => <button key={r.key} aria-pressed={r.key === range} aria-label={r.title} className={r.key === range ? 'active' : ''} onClick={() => setRange(r.key)}>{r.label}</button>)}
            </div>
        </div>
        <div className="odds-chart-body">
            <Status error={error} loading={!data && !error}/>
            {data && <OddsPlot data={data}/>}
        </div>
    </div>;
}

const HEIGHT = 330, TOP = 14, BOTTOM = 258, LEFT = 62, RIGHT = 14;

export function OddsPlot({ data }: { data: OddsHistoryResponse }) {
    const frame = useRef<HTMLDivElement>(null);
    // Drawn at the width it is shown, so axis text stays readable on a phone.
    const [width, setWidth] = useState(720);
    const [active, setActive] = useState<number | null>(null);
    useEffect(() => {
        const element = frame.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.max(LEFT + RIGHT + 1, Math.round(entry.contentRect.width))));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    const view = RANGES.find(r => r.key === data.range)!;
    const { points } = data, stats = readingStats(points);
    const listed = data.listed && <>Kalshi listed this market <time dateTime={data.listed}>{dateText(data.listed, true)}</time>.</>;
    if (points.length < 2 || !stats)
        return <Empty>Not enough odds history for this range yet. {listed}</Empty>;
    const from = Date.parse(data.from ?? points[0].ts), to = Date.parse(data.to), right = width - RIGHT;
    const x = (time: number) => LEFT + (time - from) / Math.max(1, to - from) * (right - LEFT);
    const axis = probabilityAxis(stats.low, stats.high);
    const y = (probability: number) => BOTTOM - (probability * 100 - axis.min) / (axis.max - axis.min) * (BOTTOM - TOP);
    const marks = points.map(p => ({ x: Math.max(LEFT, x(Date.parse(p.ts))), y: y(p.probability) }));
    const line = stepPath(marks), last = marks.at(-1)!;
    const ticks = timeTicks(from, to, right - LEFT);
    const point = active === null ? null : points[active], mark = active === null ? null : marks[active];
    const follow = (clientX: number) => setActive(nearestIndex(marks.map(m => m.x), clientX - frame.current!.getBoundingClientRect().left));
    return <>
        <div className="odds-plot" ref={frame} onPointerMove={e => follow(e.clientX)} onPointerDown={e => follow(e.clientX)} onPointerLeave={() => setActive(null)}>
            <svg viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`${view.title}: chance of yes went from ${percent(stats.start)} to ${percent(stats.latest)}, between ${percent(stats.low)} and ${percent(stats.high)}.`}>
                <defs><linearGradient id="odds-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5AA2FF" stopOpacity=".22"/><stop offset="1" stopColor="#5AA2FF" stopOpacity="0"/></linearGradient></defs>
                {axis.ticks.map(level => <g key={level}>
                    <line x1={LEFT} x2={right} y1={y(level / 100)} y2={y(level / 100)} className="grid"/>
                    <text x={LEFT - 8} y={y(level / 100) + 4} textAnchor="end" className="tick">{level}%</text>
                </g>)}
                {ticks.map(tick => <g key={tick.time}>
                    <line x1={x(tick.time)} x2={x(tick.time)} y1={BOTTOM} y2={BOTTOM + 5} className="grid"/>
                    <text x={x(tick.time)} y={BOTTOM + 20} textAnchor="middle" className="tick">{tick.label}</text>
                </g>)}
                <text transform={`translate(14 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">Chance of yes (bid–ask midpoint)</text>
                <text x={(LEFT + right) / 2} y={BOTTOM + 46} textAnchor="middle" className="axis-title">{ticks.some(tick => tick.hourly) ? 'Time (your time zone)' : 'Date'}</text>
                <path d={`${line}V${BOTTOM}H${marks[0].x}Z`} className="area"/>
                <path d={line} className="line"/>
                {mark ? <><line x1={mark.x} x2={mark.x} y1={TOP} y2={BOTTOM} className="crosshair"/><circle cx={mark.x} cy={mark.y} r="5" className="dot"/></>
                    : <circle cx={last.x} cy={last.y} r="4" className="dot"/>}
            </svg>
            {point && mark && <div className={`odds-tip${mark.y < 52 ? ' below' : ''}`} style={{ left: Math.min(width - 96, Math.max(96, mark.x)), top: mark.y }}>
                <strong className="mono">{percent(point.probability)}</strong> <span>{dateText(point.ts)}</span>
            </div>}
        </div>
        <ul className="odds-stats">
            {([['Start', stats.start], ['Low', stats.low], ['High', stats.high], ['Latest', stats.latest]] as const).map(([label, value]) => <li key={label}>{label} <strong className="mono">{percent(value)}</strong></li>)}
        </ul>
        <p className="note">{view.detail} Each reading is a bid–ask midpoint, and the line holds it until the next one. {points.length} readings from <time dateTime={points[0].ts}>{dateText(points[0].ts, true)}</time>. {listed}</p>
    </>;
}
