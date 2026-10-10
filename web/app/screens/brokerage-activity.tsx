'use client';
import { useState } from 'react';
import type { BrokerageActivitiesResponse } from '../../../shared/types';
import { api, dateText } from '../common';

export function BrokerageActivity({ accountId }: { accountId: string }) {
    const [data, setData] = useState<BrokerageActivitiesResponse | null>(null), [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    async function load(offset = 0) {
        setOpen(true); setBusy(true); setError('');
        try { setData(await api<BrokerageActivitiesResponse>(`/brokerages/accounts/${accountId}/activities?offset=${offset}&limit=100`)); }
        catch (e) { setError((e as Error).message); }
        finally { setBusy(false); }
    }
    return <div><button disabled={busy} onClick={() => { if (open) setOpen(false); else void load(); }}>
        {busy ? 'Loading activity…' : open ? 'Hide activity' : 'View trades and activity'}
    </button>{open && <>
        <p className="note">Historical records from SnapTrade. Trade amounts are cash flows; portfolio exposure uses current positions. Values keep their reported currency. This endpoint supplies no source freshness timestamp.</p>
        {error && <p className="error" role="alert">{error}</p>}
        {data && <><div className="scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Symbol</th><th>Quantity</th><th>Trade price</th><th>Cash flow</th></tr></thead><tbody>
            {data.activities.map(activity => <tr key={activity.id}><td>{activity.tradeDate ? dateText(activity.tradeDate) : 'Unavailable'}</td>
                <td>{activity.type}</td><td className="mono">{activity.symbol ?? 'No security'}</td><td className="mono">{activity.quantity ?? 'Unavailable'}</td>
                <td className="mono">{activity.price !== null && activity.currency ? `${activity.price} ${activity.currency}` : 'Unavailable'}</td>
                <td className="mono">{activity.amount !== null && activity.currency ? `${activity.amount} ${activity.currency}` : 'Unavailable'}</td></tr>)}
        </tbody></table></div>{!data.activities.length && <p>No activity returned for this page.</p>}
            <div className="actions"><button disabled={busy || data.pagination.offset === 0} onClick={() => void load(Math.max(0, data.pagination.offset - data.pagination.limit))}>Previous activity</button>
                <button disabled={busy || data.pagination.offset + data.pagination.limit >= data.pagination.total} onClick={() => void load(data.pagination.offset + data.pagination.limit)}>Next activity</button></div>
            <p className="note">Cache read at <time dateTime={data.fetchedAt}>{dateText(data.fetchedAt)}</time>{data.mode === 'sandbox' ? ' · Simulated sandbox records' : ''}</p>
        </>}
    </>}</div>;
}
