'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AccountUser, Holding, HoldingsResponse } from '../../../shared/types';
import { money, api, useData, Card, Fresh, Status, Empty } from '../common';

export function AddHoldings({ user }: { user?: AccountUser | null } = {}) {
    const saved = useData<HoldingsResponse>('/holdings');
    const [notice, setNotice] = useState('');
    const [cleared, setCleared] = useState(false);
    const [search, setSearch] = useState('');
    async function clearPortfolio() {
        setBusy(true); setError(''); setNotice('');
        try {
            await api<HoldingsResponse>('/holdings', { method: 'POST', body: JSON.stringify({ holdings: [] }) });
            setHoldings([]); setSymbol(''); setAmount(''); setSearch(''); setCleared(true);
            setNotice('Portfolio cleared. Add holdings or import a CSV to start again.');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const [holdings, setHoldings] = useState<Holding[]>([]), [symbol, setSymbol] = useState(''), [amount, setAmount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const visibleHoldings = holdings.filter(holding => holding.symbol.toLowerCase().includes(search.trim().toLowerCase()));
    useEffect(() => { if (saved.data)
        setHoldings(saved.data.holdings); }, [saved.data]);
    function add(e: FormEvent) { e.preventDefault(); const ticker = symbol.trim().toUpperCase(), value = Number(amount); if (!/^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(ticker) || !Number.isFinite(value) || value <= 0 || holdings.some(h => h.symbol === ticker)) {
        setError('Use a unique ticker and a positive dollar value.');
        return;
    } setNotice(''); setHoldings([...holdings, { symbol: ticker, valueUsd: value }]); setSymbol(''); setAmount(''); setSearch(''); setError(''); }
    async function save() { setBusy(true); setError(''); setNotice(''); try {
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
        return; setBusy(true); setNotice(''); try {
        const rows = (await file.text()).trim().split(/\r?\n/).map(s => s.split(',').map(v => v.trim()));
        if (rows[0]?.[0]?.toLowerCase() === 'symbol')
            rows.shift();
        const parsed = rows.map(([symbol, value]) => ({ symbol: symbol.toUpperCase(), valueUsd: Number(value) }));
        if (parsed.some(h => !h.symbol || !Number.isFinite(h.valueUsd) || h.valueUsd <= 0) || new Set(parsed.map(h => h.symbol)).size !== parsed.length)
            throw new Error('CSV must contain unique symbol,valueUsd rows with positive values.');
        setHoldings(parsed);
        setSearch('');
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } finally { setBusy(false); } }
    return <>
        <div className="hero">
            <div>
                <span className="eyebrow">Kalshi odds · Your holdings</span>
                <h1>See which real-world events your portfolio depends on.</h1>
                <p>Hedgehog links your stocks to prediction markets, shows what’s coming up and what moved today, and tells you how far to trust each number.</p>
            </div>
            <Card className="portfolio-editor">
                <h2>Add your holdings</h2>
                <form onSubmit={add} className="form-row">
                    <label>Ticker<input disabled={busy || !saved.data} required value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="e.g. AAPL" maxLength={15}/></label>
                    <label>Amount ($)<input disabled={busy || !saved.data} required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Dollar value"/></label>
                    <button disabled={busy || !saved.data} type="submit">Add</button>
                </form>
                <Status error={saved.error} loading={!saved.data && !saved.error}/>
                <label>Search portfolio holdings<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a ticker…" disabled={!saved.data}/></label>
                <p className="note" role="status">Showing {visibleHoldings.length} of {holdings.length} holdings. Saving includes your full portfolio.</p>
                <div className="portfolio-list" tabIndex={0} role="region" aria-label="Portfolio holdings">
                    {visibleHoldings.map(holding => <div className="row holding" key={holding.symbol}>
                        <strong className="mono">{holding.symbol}</strong><span className="mono">{money(holding.valueUsd)}</span>
                        <button disabled={busy || !saved.data} aria-label={`Remove ${holding.symbol}`} onClick={() => setHoldings(previous => previous.filter(row => row.symbol !== holding.symbol))}>×</button>
                    </div>)}
                    {!holdings.length ? <Empty>Add what you own to see which events reach your portfolio.</Empty> : !visibleHoldings.length && <Empty>No holdings match your search.</Empty>}
                </div>
                <div className="portfolio-actions">
                    <label>Import CSV (symbol,valueUsd)<input disabled={busy || !saved.data} type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importCsv(file); }}/></label>
                    {error && <p className="error" role="alert">{error}</p>}
                    <div className="actions">
                        <button className="primary" onClick={() => void save()} disabled={busy || !saved.data || !holdings.length}>{busy ? 'Saving…' : 'Map my exposure →'}</button>
                        <button onClick={() => void clearPortfolio()} disabled={busy || !saved.data || (!holdings.length && (cleared || !saved.data.holdings.length))}>Clear portfolio</button>
                    </div>
                </div>
                {notice && <p role="status">{notice}</p>}
                <p className="note">Clear portfolio immediately removes saved holdings {user ? 'from your account on every device' : 'for this guest session'}.</p>
                <p className="note">Hedgehog reads odds and prices; it never trades. {user ? `Your portfolio is saved to ${user.email}.` : <>Your guest portfolio is stored on the server and linked to this browser. <a href="#signup">Create an account</a> to keep it across devices.</>}</p>
                <Fresh asOf={cleared ? null : saved.data?.asOf ?? null}/>
            </Card>
        </div>
        <h2>How it works</h2>
        <div className="grid">{[['Add what you own', 'Enter tickers and dollar values, or import a CSV.'], ['We match Kalshi markets', 'Direct company markets first, then Related links backed by historical price measurements. Every link says which kind it is.'], ['Watch what matters to you', 'Explore upcoming events, earnings previews and daily moves, with evidence behind the odds.']].map(([title, text], i) => <Card key={title}><span className="eyebrow">0{i + 1}</span><h3>{title}</h3><p>{text}</p></Card>)}</div>
    </>;
}
