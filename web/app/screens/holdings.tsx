'use client';
import { useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { Holding, HoldingsResponse, ExposureResponse, ExposureEvent, Market, CalendarResponse, EventResponse, MovesResponse, EarningsResponse, TrackRecordResponse, BriefingResponse, CategoryRecord, OddsPoint } from '../../../shared/types';
import { money, percent, number, dateText, href, api, useData, Card, Fresh, Status, Empty, TrustBadge, Progress, EventList } from '../common';

export function AddHoldings() {
    const saved = useData<HoldingsResponse>('/holdings');
    const [holdings, setHoldings] = useState<Holding[]>([]), [symbol, setSymbol] = useState(''), [amount, setAmount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    useEffect(() => { if (saved.data)
        setHoldings(saved.data.holdings); }, [saved.data]);
    function add(e: FormEvent) { e.preventDefault(); const ticker = symbol.trim().toUpperCase(), value = Number(amount); if (!/^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(ticker) || !Number.isFinite(value) || value <= 0 || holdings.some(h => h.symbol === ticker)) {
        setError('Use a unique ticker and a positive dollar value.');
        return;
    } setHoldings([...holdings, { symbol: ticker, valueUsd: value }]); setSymbol(''); setAmount(''); setError(''); }
    async function save() { setBusy(true); setError(''); try {
        await api('/holdings', { method: 'POST', body: JSON.stringify({ holdings }) });
        window.location.hash = 'overview';
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setBusy(false);
    } }
    async function importCsv(file: File | undefined) { if (!file)
        return; try {
        const rows = (await file.text()).trim().split(/\r?\n/).map(s => s.split(',').map(v => v.trim()));
        if (rows[0]?.[0]?.toLowerCase() === 'symbol')
            rows.shift();
        const parsed = rows.map(([symbol, value]) => ({ symbol: symbol.toUpperCase(), valueUsd: Number(value) }));
        if (parsed.some(h => !h.symbol || !Number.isFinite(h.valueUsd) || h.valueUsd <= 0) || new Set(parsed.map(h => h.symbol)).size !== parsed.length)
            throw new Error('CSV must contain unique symbol,valueUsd rows with positive values.');
        setHoldings(parsed);
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } }
    return <><div className="hero"><div><span className="eyebrow">Kalshi odds · Your holdings</span><h1>See which real-world events your portfolio depends on.</h1><p>Hedgehog links your stocks to prediction markets, shows what’s coming up and what moved today, and tells you how far to trust each number.</p></div><Card><h2>Add your holdings</h2><form onSubmit={add} className="form-row"><label>Ticker<input required value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="e.g. AAPL" maxLength={15}/></label><label>Amount ($)<input required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Dollar value"/></label><button type="submit">Add</button></form><Status error={saved.error} loading={!saved.data && !saved.error}/>{holdings.map(h => <div className="row holding" key={h.symbol}><strong className="mono">{h.symbol}</strong><span className="mono">{money(h.valueUsd)}</span><button aria-label={`Remove ${h.symbol}`} onClick={() => setHoldings(holdings.filter(row => row.symbol !== h.symbol))}>×</button></div>)}{!holdings.length && <Empty>Add what you own to see which events reach your portfolio.</Empty>}<div className="actions"><label className="wide">Import CSV (symbol,valueUsd)<input type="file" accept=".csv,text/csv" onChange={e => void importCsv(e.target.files?.[0])}/></label></div>{error && <p className="error" role="alert">{error}</p>}<button className="primary wide" onClick={() => void save()} disabled={busy || !holdings.length}>{busy ? 'Saving…' : 'Map my exposure →'}</button><p className="note">No brokerage login. Hedgehog reads odds and prices; it never trades. Your values stay in your browser’s anonymous session.</p><Fresh asOf={saved.data?.asOf ?? null}/></Card></div><h2>How it works</h2><div className="grid">{[['Add what you own', 'Enter tickers and dollar values, or import a CSV.'], ['We match Kalshi markets', 'Company markets first, then measured links and related events. Every link says which kind it is.'], ['Watch what matters to you', 'Explore upcoming events, earnings previews and daily moves, with evidence behind the odds.']].map(([title, text], i) => <Card key={title}><span className="eyebrow">0{i + 1}</span><h3>{title}</h3><p>{text}</p></Card>)}</div></>;
}
