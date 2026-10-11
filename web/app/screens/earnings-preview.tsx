'use client';
import type { EarningsCall, EarningsCompany, EarningsMetric, EarningsReportMove, TrustSummary } from '../../../shared/types';
import { money, percent, number, href, dateText, dayOnly, Card } from '../common';
import { countdown, describeEvenOdds, firmQuote, leadTickers, signed, summarizeEvenOdds } from './earnings-text';
import { useOwner } from '../auth';

// One trust figure for a group of markets: the median of their scores.
export function GroupTrust({ trust }: { trust: TrustSummary | null }) {
    if (!trust)
        return <span className="trust">Trust unavailable</span>;
    return <span className={`trust ${trust.band === 'Low' ? 'orange' : ''}`} title={`Median trust score of ${trust.markets} ${trust.markets === 1 ? 'market' : 'markets'}`}>Trust {number(trust.total, 0)} · {trust.band}</span>;
}

// Holdings with an earnings call Kalshi has dated, soonest first.
export function UpcomingReports({ companies, selected, onSelect, now }: {
    companies: EarningsCompany[]; selected?: string; onSelect: (symbol: string) => void; now?: number;
}) {
    return <nav className="earnings-upcoming" aria-label={`${useOwner().Their} upcoming reports`}>
        {companies.map(company => <button key={company.symbol} className={`report-card${selected === company.symbol ? ' active' : ''}`} aria-pressed={selected === company.symbol} onClick={() => onSelect(company.symbol)}>
            <span className="report-card-top"><strong className="mono">{company.symbol}</strong><span className="note">{countdown(company.callTime, now)}</span></span>
            <span className="note">{company.markets} Kalshi {company.markets === 1 ? 'market' : 'markets'}</span>
        </button>)}
    </nav>;
}

// The lead card: one reported metric read from its ladder of "above X" markets.
export function ExpectationCard({ metric }: { metric: EarningsMetric }) {
    const lead = leadTickers(metric);
    return <Card className="expectation">
        <div className="row expectation-heading"><h2>{metric.title}: what traders expect</h2><GroupTrust trust={metric.trust}/></div>
        <p className="expectation-lead">{describeEvenOdds(metric)}</p>
        <div className="threshold-bars" role="list" aria-label={`Chance of each level for ${metric.title}`}>
            {metric.thresholds.map(threshold => <div key={threshold.ticker} role="listitem" className={`threshold${lead.has(threshold.ticker) ? ' lead' : ''}`} title={firmQuote(threshold) ? `${threshold.label}: bid ${percent(threshold.bid)}, ask ${percent(threshold.ask)} · midpoint ${percent(threshold.probability)}` : `${threshold.label}: the bid and ask are more than 50 points apart`}>
                <span className="mono threshold-label">{threshold.label}</span>
                {firmQuote(threshold) ? <><div className="bar"><span style={{ width: `${Math.min(1, Math.max(0, threshold.probability ?? 0)) * 100}%` }}/></div><strong className="mono">{percent(threshold.probability)}</strong></>
                    : <span className="note threshold-unquoted">No firm quote</span>}
            </div>)}
        </div>
        <p className="note">Each bar is one Kalshi market: the bid–ask midpoint for that level being exceeded. The highlighted levels sit either side of even odds: the highest whose bid is at least 50% and the lowest whose ask is at most 50%. A level whose bid and ask are more than 50 points apart shows no number. These are separate markets, so they are not scaled to add up. <a href={href('event', metric.eventTicker)}>Open the event →</a></p>
    </Card>;
}

// The other reported metrics, one row each.
export function MetricsTable({ metrics }: { metrics: EarningsMetric[] }) {
    return <Card className="earnings-metrics"><h2>Other company markets</h2>
        <div className="scroll"><table><thead><tr><th>Metric</th><th>What traders expect</th><th>Trust</th></tr></thead><tbody>
            {metrics.map(metric => <tr key={metric.eventTicker}>
                <td><a href={href('event', metric.eventTicker)}>{metric.title}</a></td>
                <td>{summarizeEvenOdds(metric)}</td>
                <td><GroupTrust trust={metric.trust}/></td>
            </tr>)}
        </tbody></table></div>
        <p className="note">Each reading comes from the two Kalshi markets clearly either side of 50% odds for that metric. Open a metric for every level.</p>
    </Card>;
}

// The chance each word is said on the next earnings call.
export function CallTopics({ call }: { call: EarningsCall }) {
    return <Card className="call-topics">
        <div className="row expectation-heading"><h2>Topics expected on the call</h2><GroupTrust trust={call.trust}/></div>
        <div className="topic-chips">{call.topics.map(topic => <a key={topic.ticker} className="topic-chip" href={href('event', topic.ticker)}>{topic.word} <span className="mono">{percent(topic.probability)}</span></a>)}</div>
        <p className="note">Chance each word is said on the call. These markets trade thinly, so treat them as rough.</p>
        <p className="note">Call <time dateTime={call.time}>{call.session ? dateText(call.time, true) : dayOnly(call.time, true)}</time> · {call.session ? 'Kalshi event time' : 'Kalshi’s date for the call; it gives no time'}</p>
    </Card>;
}

const BAND = 80, WIDTH = 56, BASE = 110, REACH = 88;
// A column with a rounded data end and a square foot on the baseline.
function column(x: number, tip: number) {
    const r = Math.min(4, Math.abs(BASE - tip)), turn = tip < BASE ? r : -r;
    return `M${x},${BASE} V${tip + turn} Q${x},${tip} ${x + r},${tip} H${x + WIDTH - r} Q${x + WIDTH},${tip} ${x + WIDTH},${tip + turn} V${BASE} Z`;
}

// Past report moves, oldest to latest. Direction is shown by position and sign as well as colour.
export function MovesChart({ symbol, history }: { symbol: string; history: EarningsReportMove[] }) {
    const reports = [...history].reverse();
    const largest = Math.max(...reports.map(report => Math.abs(report.move ?? 0)), 0.0001);
    return <svg className="chart moves-chart" viewBox={`0 0 ${reports.length * BAND} 236`} role="img" aria-label={`${symbol} moves across its last ${reports.length} results filings, oldest first: ${reports.map(report => report.move === null ? 'unavailable' : `${signed(report.move)}%`).join(', ')}`}>
        <line x1="0" y1={BASE} x2={reports.length * BAND} y2={BASE} stroke="#2A313C"/>
        {reports.map((report, index) => {
            const x = index * BAND + (BAND - WIDTH) / 2;
            return <g key={report.sourceUrl}>
                {report.move !== null && <path d={column(x, BASE - report.move / largest * REACH)} fill={report.move < 0 ? '#FF9F45' : '#7DB6FF'}>
                    <title>{`Filed ${report.filingDate}: ${signed(report.move)}% (close ${money(report.closeBefore)} to ${money(report.closeAfter)})`}</title>
                </path>}
                <text x={x + WIDTH / 2} y="226" textAnchor="middle" fill="#A3ADBA" fontSize="14" fontFamily="'IBM Plex Mono', monospace">{report.move === null ? 'n/a' : signed(report.move)}</text>
            </g>;
        })}
    </svg>;
}
