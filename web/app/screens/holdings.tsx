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
    const [importedFile, setImportedFile] = useState<{ name: string; count: number } | null>(null);
    const [operation, setOperation] = useState<'import' | 'save' | 'clear' | null>(null);
    const busy = operation !== null;
    async function clearPortfolio() {
        setOperation('clear'); setError(''); setNotice('');
        try {
            await api<HoldingsResponse>('/holdings', { method: 'POST', body: JSON.stringify({ holdings: [] }) });
            setHoldings([]); setSymbol(''); setAmount(''); setSearch(''); setCleared(true);
            setImportedFile(null);
            setNotice('Manual holdings cleared. Connected brokerage holdings are unchanged.');
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setOperation(null);
        }
    }
    const [holdings, setHoldings] = useState<Holding[]>([]), [symbol, setSymbol] = useState(''), [amount, setAmount] = useState(''), [error, setError] = useState('');
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
    async function save() { setOperation('save'); setError(''); setNotice(''); try {
        await api('/holdings', { method: 'POST', body: JSON.stringify({ holdings }) });
        window.location.hash = 'overview';
    }
    catch (e) {
        setError((e as Error).message);
    }
    finally {
        setOperation(null);
    } }
    async function importCsv(file: File | undefined) { if (!file)
        return; setOperation('import'); setNotice(''); setError(''); try {
        const imported = parseHoldingsCsv(await file.text());
        setHoldings(imported);
        setImportedFile({ name: file.name, count: imported.length });
        setSearch('');
        setError('');
    }
    catch (e) {
        setError(`Could not import ${file.name}: ${(e as Error).message}`);
    } finally { setOperation(null); } }
    return <div className="holdings-page">
            <div className="holdings-heading">
                <span className="eyebrow">Kalshi odds · {owner.Their} holdings</span>
                <h1>See which real-world events {owner.their} portfolio depends on.</h1>
                <p>Add stocks, funds, cash, bonds or property. Review your holdings, then map them to Kalshi events.</p>
            </div>
            <Card className="portfolio-editor">
                <div className="holdings-section-heading">
                    <h2>{owner.name ? `${owner.Their} holdings` : 'Add your holdings'}</h2>
                    <a className="account-link" href="#brokerages">Connect a brokerage →</a>
                </div>
                <div className="holdings-import">
                    <div>
                        <h3>Import a CSV</h3>
                        <p className="note">Upload your holdings in one step. A new file replaces the manual / CSV list below.</p>
                    </div>
                    <label className={`holdings-upload${busy || !saved.data ? ' disabled' : ''}`}>
                        <input className="sr-only" disabled={busy || !saved.data} type="file" accept=".csv,text/csv" aria-label="Import CSV (symbol,valueUsd) · optional type and terms" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void importCsv(file); }}/>
                        <span>{operation === 'import' ? 'Importing…' : importedFile ? 'Choose another CSV' : 'Choose CSV file'}</span>
                    </label>
                    {importedFile && <div className="holdings-import-receipt" role="status" aria-live="polite">
                        <span className="holdings-import-check" aria-hidden="true">✓</span>
                        <div><strong>{importedFile.name}</strong><p className="note">Successfully imported {importedFile.count} {importedFile.count === 1 ? 'holding' : 'holdings'}. Review the list, then select “Map my exposure” to save.</p></div>
                    </div>}
                    {operation === 'import' && <p className="note" role="status">Reading and validating your CSV…</p>}
                    <details className="holdings-csv-help">
                        <summary>CSV format and supported assets</summary>
                        <p className="note">CSV columns: <span className="mono">{CSV_COLUMNS}</span>. Stocks and funds need only the first two; the rest describe cash, Treasuries, bonds and property. Try <span className="mono">examples/feature-tour.csv</span>.</p>
                    </details>
                </div>
                {error && <p className="error" role="alert">{error}</p>}
                <section className="holdings-entry" aria-labelledby="manual-holdings-heading">
                <h3 id="manual-holdings-heading">Add a holding manually</h3>
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
                    <button disabled={busy || !saved.data} type="submit">Add holding</button>
                </form>
                <p className="note">{typeHelp[assetType]}</p>
                </section>
                <Status error={saved.error} loading={!saved.data && !saved.error} layout="compact"/>
                <div className="holdings-review-heading">
                    <h3>Review manual / CSV holdings</h3>
                    <label>Search portfolio holdings<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a ticker…" disabled={!saved.data}/></label>
                </div>
                {saved.data && <><p className="note" role="status">Showing {visibleHoldings.length} of {holdings.length} holdings. Saving includes {owner.their} full portfolio.</p>
                <div className="portfolio-list" tabIndex={0} role="region" aria-label="Portfolio holdings">
                    {visibleHoldings.map(holding => <div className="row holding" key={holding.symbol}>
                        <div className="holdings-identity"><strong className="mono">{holding.symbol}</strong><span className="chip plain">{assetLabel[holding.assetType ?? 'security']}</span></div><span className="mono">{money(holding.valueUsd)}</span>
                        <button disabled={busy || !saved.data} aria-label={`Remove ${holding.symbol}`} onClick={() => setHoldings(previous => previous.filter(row => row.symbol !== holding.symbol))}>×</button>
                    </div>)}
                    {!holdings.length ? <Empty>Add what you own to see which events reach your portfolio.</Empty> : !visibleHoldings.length && <Empty>No holdings match your search.</Empty>}
                </div></>}
                {!!saved.data?.brokerageHoldings?.length && <details className="holdings-connected">
                    <summary>Connected brokerage holdings · {saved.data.brokerageHoldings.length}</summary>
                    <p className="note">Read-only; {saved.data.sandbox ? 'simulated sandbox data' : 'SnapTrade data'}. Values are quantity × provider price. Manual entries add to these values; remove any duplicate entries.</p>{saved.data.brokerageHoldings.map(h => <div className="row holding" key={h.symbol}><strong className="mono">{h.symbol}</strong><span className="mono">{money(h.valueUsd)}</span></div>)}<a className="account-link" href="#brokerages">Manage connected accounts</a>
                </details>}
                <div className="portfolio-actions">
                    <div className="actions">
                        <button className="primary" onClick={() => void save()} disabled={busy || !saved.data || !holdings.length && !saved.data.brokerageHoldings?.length}>{operation === 'save' ? 'Saving…' : 'Map my exposure →'}</button>
                        <button onClick={() => void clearPortfolio()} disabled={busy || !saved.data || (!holdings.length && (cleared || !(saved.data.manualHoldings ?? saved.data.holdings).length))}>{operation === 'clear' ? 'Clearing…' : 'Clear manual / CSV holdings'}</button>
                    </div>
                </div>
                {notice && <p role="status">{notice}</p>}
                <p className="note">Clearing immediately removes manual and CSV holdings {user ? 'from your account on every device' : 'for this guest session'}.</p>
                <p className="note">Hedgehog reads odds and prices; it never trades. {user ? `${owner.Their} portfolio is saved to ${user.email}.` : <>Your guest portfolio is stored on the server and linked to this browser. <a href="#signup">Create an account</a> to keep it across devices.</>}</p>
                {saved.data && <Fresh asOf={cleared && !saved.data.brokerageHoldings?.length ? null : saved.data.asOf}/>}
            </Card>
        <details className="holdings-how-it-works">
            <summary>How it works</summary>
            <div className="grid">{[['Add what you own', 'Enter tickers and dollar values, import a CSV, or add cash, bonds and property by their terms.'], ['We match Kalshi markets', 'Direct company markets first, then figures calculated from a holding’s own terms and Related links backed by historical price measurements. Every link says which kind it is.'], ['Watch what matters to you', 'Explore upcoming events, earnings previews and daily moves, with evidence behind the odds.']].map(([title, text], i) => <Card key={title}><span className="eyebrow">0{i + 1}</span><h3>{title}</h3><p>{text}</p></Card>)}</div>
        </details>
    </div>;
}
