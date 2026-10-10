'use client';
import { useEffect, useState } from 'react';
import type { BrokerageConnectResponse, BrokeragesResponse } from '../../../shared/types';
import { BrokerageActivity } from './brokerage-activity';
import { useAccount } from '../auth';
import { api, Card, Fresh, money } from '../common';

export function Brokerages() {
    const { session } = useAccount();
    const [data, setData] = useState<BrokeragesResponse | null>(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
    useEffect(() => {
        if (!session?.user) return;
        let active = true;
        setBusy(true);
        // Pull provider's cached account data after the hosted portal returns.
        api<BrokeragesResponse>('/brokerages').then(async status => {
            if (!active) return;
            setData(status);
            if (status.configured) {
                const synced = await api<BrokeragesResponse>('/brokerages/sync', { method: 'POST', body: '{}' });
                if (active) setData(synced);
            }
        }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [session?.user?.id]);
    async function update(path: string, body: object = {}) {
        setBusy(true); setError('');
        try { setData(await api<BrokeragesResponse>(path, { method: 'POST', body: JSON.stringify(body) })); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(false); setConfirmDisconnect(null); }
    }
    async function link(reconnect?: string) {
        setBusy(true); setError('');
        try {
            const result = await api<BrokerageConnectResponse>('/brokerages/connect', { method: 'POST', body: JSON.stringify(reconnect ? { reconnect } : {}) });
            window.location.assign(result.portalUrl);
        } catch (e) { setError((e as Error).message); setBusy(false); }
    }
    return <><span className="eyebrow">Read-only · SnapTrade</span><h1>Connected brokerages</h1>
        <p>Link accounts to import holdings. <a href="#holdings">Manual entry and CSV uploads</a> remain available.</p>
        {!session?.user ? <Card><h2>Sign in to link accounts</h2><p>Brokerage connections belong to your Hedgehog account.</p><a href="#signin">Sign in</a> · <a href="#signup">Create account</a></Card> : <>
            <Card><h2>{data?.mode === 'live' ? 'Live brokerages' : 'Sandbox brokerages'}</h2>
                <p>{data?.message ?? 'Loading brokerage configuration…'}</p>
                {data?.mode === 'sandbox' && <p className="account-notice">Sandbox accounts are simulated. Their source is labeled here and in your holdings.</p>}
                <div className="actions"><button className="primary" disabled={busy || !data?.configured} onClick={() => void link()}>{data?.mode === 'live' ? 'Connect brokerage' : 'Connect sandbox account'}</button>
                    <button disabled={busy || !data?.configured} onClick={() => void update('/brokerages/sync')}>Sync accounts</button></div>
                <p className="note">Sync reads SnapTrade’s cached data. The source timestamp below can be older than the last check. Automatic checks run hourly. Brokerage passwords stay in SnapTrade’s hosted connection flow.</p>
                {data?.checkedAt && <p className="note">Last checked <time dateTime={data.checkedAt}>{new Date(data.checkedAt).toLocaleString()}</time></p>}
            </Card>
            {busy && <p role="status">Updating brokerage connection…</p>}{error && <p role="alert" className="error">{error}</p>}
            {data?.connections.map(c => <Card key={c.id}><h2>{c.name}{c.disabled ? ' · Reconnection needed' : ''}</h2>
                <div className="actions">{c.disabled && <button disabled={busy || !data.configured} onClick={() => void link(c.id)}>Reconnect</button>}
                    <button disabled={busy || !data.configured} onClick={() => setConfirmDisconnect(c.id)}>Disconnect</button></div>
                {confirmDisconnect === c.id && <div><p>Disconnect {c.name} and remove its imported holdings from Hedgehog? Manual and CSV holdings remain.</p>
                    <button disabled={busy} onClick={() => void update(`/brokerages/connections/${c.id}/disconnect`)}>Confirm disconnect</button> <button disabled={busy} onClick={() => setConfirmDisconnect(null)}>Cancel</button></div>}
                {data.accounts.filter(a => a.connectionId === c.id).map(a => <section key={a.id}>
                    <h3>{a.name} · {a.numberMask}</h3>
                    <label className="check-label"><input type="checkbox" checked={a.included} disabled={busy || !data.configured} onChange={e => void update(`/brokerages/accounts/${a.id}`, { included: e.target.checked })}/>Include supported positions in my portfolio</label>
                    {a.syncError && <p role="status" className="note">{a.syncError}</p>}
                    {!a.available && <p className="note">These holdings are excluded from exposure until source data is available.</p>}
                    <div className="scroll"><table><thead><tr><th>Position</th><th>Quantity</th><th>Provider price</th><th>USD value</th></tr></thead><tbody>
                        {a.positions.map((p, index) => <tr key={`${p.symbol}-${index}`}><td><span className="mono">{p.symbol}</span><p className="note">{p.excludedReason ?? 'Calculated: quantity × SnapTrade price'}</p></td><td className="mono">{p.units ?? 'Unavailable'}</td><td className="mono">{p.price ? `${p.price} ${p.currency ?? ''}` : 'Unavailable'}</td><td className="mono">{money(p.valueUsd)}</td></tr>)}
                    </tbody></table></div>{!a.positions.length && <p className="note">No security positions returned. Cash is excluded from exposure.</p>}<Fresh asOf={a.asOf}/><BrokerageActivity accountId={a.id}/>
                </section>)}
                {!data.accounts.some(a => a.connectionId === c.id) && <p className="note">No investment accounts returned yet. Initial synchronization can take time; try Sync accounts again.</p>}
            </Card>)}
            {data?.configured && !data.connections.length && <Card><p>No connected accounts yet. Select Connect to open SnapTrade’s hosted portal.</p></Card>}
            <p className="note">Supported long US-listed stocks, ETFs and ADRs priced in USD are imported. Cash, shorts, derivatives, crypto, foreign listings and positions without verifiable prices are excluded. Manual holdings add to imported holdings, so remove duplicate manual entries.</p>
            <a href="#overview">View my exposure →</a>
        </>}
    </>;
}
