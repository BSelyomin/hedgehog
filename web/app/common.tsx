'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { Holding, HoldingsResponse, ExposureResponse, ExposureEvent, Market, CalendarResponse, EventResponse, MovesResponse, EarningsResponse, TrackRecordResponse, BriefingResponse, CategoryRecord, OddsPoint } from '../../shared/types';
export const money = (n: number | null) => n === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export const percent = (n: number | null) => n === null ? 'Unavailable' : `${(n * 100).toFixed(1)}%`;

export const number = (n: number | null, digits = 1) => n === null ? 'Unavailable' : n.toFixed(digits);

export const dateText = (s: string) => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const href = (screen: string, id?: string) => `#${screen}${id ? `/${encodeURIComponent(id)}` : ''}`;

import { api } from '../lib/api-client';
export { api, setSessionKey } from '../lib/api-client';

export function useData<T>(path: string) {
    const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    const reload = useCallback(async (reloadPath?: string) => {
        controller.current?.abort();
        const request = new AbortController();
        controller.current = request;
        setError('');
        try {
            const result = await api<T>(reloadPath ?? path, { signal: request.signal, method: reloadPath ? 'POST' : 'GET', body: reloadPath ? '{}' : undefined });
            if (!request.signal.aborted) setData(result);
        } catch (e) {
            if (!request.signal.aborted) {
                const message = e instanceof Error ? e.message : 'Unable to reload data';
                setError(message);
                throw e;
            }
        }
    }, [path]);
    useEffect(() => {
        setData(null);
        void reload().catch(() => {});
        return () => controller.current?.abort();
    }, [reload]);
    return { data, error, reload };
}

export function ReloadButton({ onReload, label = 'Reload' }: { onReload: () => Promise<unknown>; label?: string }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    async function reload() {
        if (busy) return;
        setBusy(true); setError('');
        try { await onReload(); }
        catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'Unable to reload data'); }
        finally { if (mounted.current) setBusy(false); }
    }
    return <div><button type="button" disabled={busy} aria-busy={busy} onClick={() => void reload()}>{busy ? 'Reloading…' : label}</button>
        {error && <p className="error" role="alert">{error}</p>}</div>;
}

export function Card({ children, className = '' }: {
    children: ReactNode;
    className?: string;
}) { return <section className={`card ${className}`}>{children}</section>; }

export function Fresh({ asOf }: {
    asOf: string | null;
}) { return <p className="note">{asOf ? <>Data updated <time dateTime={asOf}>{dateText(asOf)}</time></> : 'No source data available yet'}</p>; }

export function Status({ error, loading }: {
    error: string;
    loading: boolean;
}) { return error ? <p role="alert" className="error">{error}. Check the backend connection and try again.</p> : loading ? <p role="status" className="empty">Loading your data…</p> : null; }

export function Empty({ children }: {
    children: ReactNode;
}) { return <div className="empty">{children}</div>; }

export function TrustBadge({ market }: {
    market: Market;
}) { return <span className={`trust ${market.trust.band === 'Low' ? 'orange' : ''}`}>{market.trust.total === null ? 'Trust unavailable' : `Trust ${number(market.trust.total, 0)} · ${market.trust.band}`}</span>; }

export function Progress({ value }: {
    value: number;
}) { return <div className="bar"><span style={{ width: `${Math.min(1, Math.max(0, value)) * 100}%` }}/></div>; }

export function EventList({ events }: {
    events: ExposureEvent[];
}) { return <>{events.map(e => <div className="event-row" key={e.ticker}><div className="row"><div><span className="chip Related">{e.links.some(l => l.type === 'Direct') ? 'Company' : e.category}</span><p className="note">{dateText(e.closeTime)} · Kalshi close time</p><a className="event-title" href={href('event', e.ticker)}>{e.title}</a><p>{e.links.map(l => l.symbol).join(' · ')}</p></div><div><strong className="mono">{money(e.linkedValue)}</strong><p className="note">{percent(e.share)} of portfolio</p><a href={href('event', e.ticker)}>View event →</a></div></div>{e.markets.length === 1 && <><span className="mono">{percent(e.markets[0].probability)} yes · bid–ask midpoint</span> <TrustBadge market={e.markets[0]}/></>}</div>)}</>; }
