'use client';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { AccountUser, AssetType, Holding, HoldingsResponse } from '../../../shared/types';
import { money, api, useData, assetLabel, Card, Fresh, Status, Empty } from '../common';
import { CSV_COLUMNS, parseHoldingsCsv } from './holdings-csv';
import { ownerOf } from '../auth';

const STATES = ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'];
// What each kind of holding can be linked on, said before the user fills it in.
const typeHelp: Record<AssetType, string> = {
    security: 'Stocks and funds, including bond and real-estate funds, are linked by ticker and measured against oil, Treasury yields, mortgage rates and the stock market.',
    cash: 'Cash and savings have no ticker. Hedgehog calculates how much yearly interest changes when the rate it earns changes.',
    treasury: 'A Treasury or CD held directly has no daily price. Hedgehog calculates how its market value responds to yields from its maturity and coupon.',
    bond: 'A bond held directly has no free daily price. Hedgehog calculates how its market value responds to yields from its maturity and coupon; credit risk is shown without a number.',
    property: 'Property has no daily price. Hedgehog links it to housing and mortgage-rate markets, and to weather and local markets that name its state, without a measured number.',
};

export function AddHoldings({ user }: { user?: AccountUser | null } = {}) {
    const saved = useData<HoldingsResponse>('/holdings');
    const owner = ownerOf(user?.name);
    const [notice, setNotice] = useState('');
    const [cleared, setCleared] = useState(false);
    const [search, setSearch] = useState('');
    async function clearPortfolio() {
        setBusy(true); setError(''); setNotice('');
        try {
            await api<HoldingsResponse>('/holdings', { method: 'POST', body: JSON.stringify({ holdings: [] }) });
            setHoldings([]); setSymbol(''); setAmount(''); setSearch(''); setCleared(true);
            setNotice('Manual holdings cleared. Connected brokerage holdings are unchanged.');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    const [holdings, setHoldings] = useState<Holding[]>([]), [symbol, setSymbol] = useState(''), [amount, setAmount] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [assetType, setAssetType] = useState<AssetType>('security'), [maturity, setMaturity] = useState(''), [couponRate, setCouponRate] = useState('');
    const [usState, setUsState] = useState(''), [mortgage, setMortgage] = useState(''), [rental, setRental] = useState(false);
    const fixedTerm = assetType === 'treasury' || assetType === 'bond';
    const visibleHoldings = holdings.filter(holding => holding.symbol.toLowerCase().includes(search.trim().toLowerCase()));
    useEffect(() => { if (saved.data)
        setHoldings(saved.data.manualHoldings ?? saved.data.holdings); }, [saved.data]);
    function add(e: FormEvent) {
        e.preventDefault();
        const ticker = symbol.trim().toUpperCase(), value = Number(amount);
        if (!/^[A-Z][A-Z0-9.\-^=]{0,14}$/.test(ticker) || !Number.isFinite(value) || value <= 0 || holdings.some(h => h.symbol === ticker)) {
            setError(assetType === 'security' ? 'Use a unique ticker and a positive dollar value.' : 'Use a unique short name (letters and digits, starting with a letter) and a positive dollar value.');
            return;
        }
        const coupon = Number(couponRate), balance = Number(mortgage);
        if (fixedTerm && (!maturity || Date.parse(maturity) <= Date.now() || couponRate === '' || !Number.isFinite(coupon) || coupon < 0 || coupon > 25)) {
            setError('Enter a maturity date in the future and a yearly coupon rate between 0 and 25 percent.');
            return;
        }
        if (assetType === 'property' && (!usState || !Number.isFinite(balance) || balance < 0)) {
            setError('Choose the state the property is in. The mortgage balance is optional.');
            return;
        }
        // A listed security carries no extra fields; the others carry the terms their links are calculated from.
        const details = fixedTerm ? { maturity, couponRate: coupon } : assetType === 'property' ? { state: usState, ...(balance > 0 ? { adjustableMortgage: balance } : {}), ...(rental ? { rental: true } : {}) } : {};
        setNotice(''); setHoldings([...holdings, assetType === 'security' ? { symbol: ticker, valueUsd: value } : { symbol: ticker, valueUsd: value, assetType, details }]);
        setSymbol(''); setAmount(''); setMaturity(''); setCouponRate(''); setMortgage(''); setRental(false); setSearch(''); setError('');
    }
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
        setHoldings(parseHoldingsCsv(await file.text()));
        setSearch('');
        setError('');
    }
    catch (e) {
        setError((e as Error).message);
    } finally { setBusy(false); } }
    return <>
        <div className="hero">
            <div>
                <span className="eyebrow">Kalshi odds · {owner.Their} holdings</span>
                <h1>See which real-world events {owner.their} portfolio depends on.</h1>
                <p>Hedgehog links your stocks, funds, bonds, cash and property to prediction markets, shows what’s coming up and what moved today, and tells you how far to trust each number.</p>
            </div>
            <Card className="portfolio-editor">
                <h2>{owner.name ? `${owner.Their} holdings` : 'Add your holdings'}</h2>
                <p className="note">Manual entry and CSV imports remain available. <a href="#brokerages">Connect a brokerage →</a></p>{!!saved.data?.brokerageHoldings?.length && <div><p className="note">Connected holdings (read-only; {saved.data.sandbox ? 'simulated sandbox data' : 'SnapTrade data'}). Values are quantity × provider price. Manual entries add to these values; remove any duplicate entries.</p>{saved.data.brokerageHoldings.map(h => <div className="row" key={h.symbol}><strong className="mono">{h.symbol}</strong><span className="mono">{money(h.valueUsd)}</span></div>)}<a href="#brokerages">Manage connected accounts</a></div>}
                <form onSubmit={add} className="holding-form">
                    <label>Type<select disabled={busy || !saved.data} value={assetType} onChange={e => { setAssetType(e.target.value as AssetType); setError(''); }}>{(Object.keys(assetLabel) as AssetType[]).map(type => <option key={type} value={type}>{assetLabel[type]}</option>)}</select></label>
                    <label>{assetType === 'security' ? 'Ticker' : 'Short name'}<input disabled={busy || !saved.data} required value={symbol} onChange={e => setSymbol(e.target.value)} placeholder={assetType === 'security' ? 'e.g. AAPL' : assetType === 'property' ? 'e.g. HOME' : assetType === 'cash' ? 'e.g. SAVINGS' : 'e.g. TNOTE-2031'} maxLength={15}/></label>
                    <label>{assetType === 'property' ? 'Estimated value ($)' : 'Amount ($)'}<input disabled={busy || !saved.data} required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Dollar value"/></label>
                    {fixedTerm && <>
                        <label>Matures<input disabled={busy || !saved.data} required type="date" value={maturity} onChange={e => setMaturity(e.target.value)}/></label>
                        <label>Coupon rate (% a year)<input disabled={busy || !saved.data} required type="number" min="0" max="25" step="0.001" value={couponRate} onChange={e => setCouponRate(e.target.value)} placeholder="0 for a bill"/></label>
                    </>}
                    {assetType === 'property' && <>
                        <label>State<select disabled={busy || !saved.data} required value={usState} onChange={e => setUsState(e.target.value)}><option value="">Choose a state</option>{STATES.map(name => <option key={name}>{name}</option>)}</select></label>
                        <label>Adjustable mortgage balance ($, optional)<input disabled={busy || !saved.data} type="number" min="0" step="0.01" value={mortgage} onChange={e => setMortgage(e.target.value)} placeholder="Leave empty if fixed or none"/></label>
                        <label className="check-label"><input disabled={busy || !saved.data} type="checkbox" checked={rental} onChange={e => setRental(e.target.checked)}/>Rented out</label>
                    </>}
                    <button disabled={busy || !saved.data} type="submit">Add</button>
                </form>
                <p className="note">{typeHelp[assetType]}</p>
                <Status error={saved.error} loading={!saved.data && !saved.error} layout="compact"/>
                <label>Search portfolio holdings<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a ticker…" disabled={!saved.data}/></label>
                {saved.data && <><p className="note" role="status">Showing {visibleHoldings.length} of {holdings.length} holdings. Saving includes {owner.their} full portfolio.</p>
                <div className="portfolio-list" tabIndex={0} role="region" aria-label="Portfolio holdings">
                    {visibleHoldings.map(holding => <div className="row holding" key={holding.symbol}>
                        <strong className="mono">{holding.symbol}</strong>{holding.assetType && <span className="chip plain">{assetLabel[holding.assetType]}</span>}<span className="mono">{money(holding.valueUsd)}</span>
                        <button disabled={busy || !saved.data} aria-label={`Remove ${holding.symbol}`} onClick={() => setHoldings(previous => previous.filter(row => row.symbol !== holding.symbol))}>×</button>
                    </div>)}
                    {!holdings.length ? <Empty>Add what you own to see which events reach your portfolio.</Empty> : !visibleHoldings.length && <Empty>No holdings match your search.</Empty>}
                </div></>}
                <div className="portfolio-actions">
                    <label>Import CSV (symbol,valueUsd) · optional type and terms<input disabled={busy || !saved.data} type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importCsv(file); }}/></label>
                    {error && <p className="error" role="alert">{error}</p>}
                    <div className="actions">
                        <button className="primary" onClick={() => void save()} disabled={busy || !saved.data || !holdings.length && !saved.data.brokerageHoldings?.length}>{busy ? 'Saving…' : 'Map my exposure →'}</button>
                        <button onClick={() => void clearPortfolio()} disabled={busy || !saved.data || (!holdings.length && (cleared || !(saved.data.manualHoldings ?? saved.data.holdings).length))}>Clear manual / CSV holdings</button>
                    </div>
                </div>
                <p className="note">CSV columns: <span className="mono">{CSV_COLUMNS}</span>. Stocks and funds need only the first two; the rest describe cash, Treasuries, bonds and property. Try <span className="mono">examples/feature-tour.csv</span>.</p>
                {notice && <p role="status">{notice}</p>}
                <p className="note">Clearing immediately removes manual and CSV holdings {user ? 'from your account on every device' : 'for this guest session'}.</p>
                <p className="note">Hedgehog reads odds and prices; it never trades. {user ? `${owner.Their} portfolio is saved to ${user.email}.` : <>Your guest portfolio is stored on the server and linked to this browser. <a href="#signup">Create an account</a> to keep it across devices.</>}</p>
                {saved.data && <Fresh asOf={cleared && !saved.data.brokerageHoldings?.length ? null : saved.data.asOf}/>}
            </Card>
        </div>
        <h2>How it works</h2>
        <div className="grid">{[['Add what you own', 'Enter tickers and dollar values, import a CSV, or add cash, bonds and property by their terms.'], ['We match Kalshi markets', 'Direct company markets first, then figures calculated from a holding’s own terms and Related links backed by historical price measurements. Every link says which kind it is.'], ['Watch what matters to you', 'Explore upcoming events, earnings previews and daily moves, with evidence behind the odds.']].map(([title, text], i) => <Card key={title}><span className="eyebrow">0{i + 1}</span><h3>{title}</h3><p>{text}</p></Card>)}</div>
    </>;
}
