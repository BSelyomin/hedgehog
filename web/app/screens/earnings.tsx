'use client';
import { useState } from 'react';
import type { ExposureResponse, EarningsResponse } from '../../../shared/types';
import { percent, href, useData, Card, Fresh, Status, Empty, TrustBadge, Progress } from '../common';

export function Earnings() {
    const { data, error } = useData<ExposureResponse>('/exposure');
    const [symbol, setSymbol] = useState('');
    const symbols = data?.holdings.filter(h => data.events.some(e => e.links.some(l => l.symbol === h.symbol && l.type === 'Direct'))).map(h => h.symbol).sort() ?? [];
    const uncovered = data?.holdings.filter(h => !symbols.includes(h.symbol)).map(h => h.symbol) ?? [];
    const selected = symbols.includes(symbol) ? symbol : symbols[0];
    return <><h1>Earnings preview</h1><p>Company markets linked directly to your holdings. These include earnings-call topics, business metrics and company-specific events.</p>
        <Status error={error} loading={!data && !error}/>
        {data && <p className="note" role="status">{symbols.length} of {data.holdings.length} holdings have active, reviewed company markets.
            {uncovered.length > 0 && <> No active reviewed company links for: {uncovered.join(', ')}.</>}
        </p>}
        <div className="toolbar" aria-label="Companies with markets">{symbols.map(s => <button key={s} aria-pressed={selected === s} className={selected === s ? 'primary' : ''} onClick={() => setSymbol(s)}>{s}</button>)}</div>
        {selected ? <EarningsDetail symbol={selected}/> : <Card><Empty>No reviewed Kalshi company markets are linked to your holdings yet.</Empty><Fresh asOf={data?.asOf ?? null}/></Card>}
    </>;
}

export function EarningsDetail({ symbol }: {
    symbol: string;
}) { const { data, error } = useData<EarningsResponse>(`/earnings/${encodeURIComponent(symbol)}`); return <><Status error={error} loading={!data && !error}/>{data && <><span className="eyebrow">{symbol} · company markets</span><Fresh asOf={data.asOf}/>{data.ladders.map(l => <Card key={l.eventTicker}><h2>{data.events.find(e => e.ticker === l.eventTicker)?.title}</h2>{l.outcomes.map(o => <div className="event-row" key={o.ticker}><div className="row"><a href={href('event', o.ticker)}>{o.title}</a><span className="mono">{percent(o.probability)}</span></div><Progress value={o.probability}/></div>)}<p className="note">Raw bid–ask midpoints sum to {percent(l.rawSum)}. This mutually exclusive bracket ladder is scaled to 100%.</p></Card>)}<Card><h2>Other company markets and call topics</h2>{data.events.flatMap(e => e.markets.filter(m => !data.ladders.some(l => l.outcomes.some(o => o.ticker === m.ticker))).map(m => <div className="event-row" key={m.ticker}><div className="row"><a href={href('event', m.ticker)}>{m.subtitle || m.title}</a><span className="mono">{percent(m.probability)}</span><TrustBadge market={m}/></div><span className="note">{m.kind === 'mention' ? 'Call mention market' : 'Company market'} · Kalshi midpoint</span></div>))}<p className="note">{data.historyNote}</p></Card></>}</>; }
