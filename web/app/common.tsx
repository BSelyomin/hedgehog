'use client';
import { useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { ExposureEvent, LinkType, Market } from '../../shared/types';
export const money = (n: number | null) => n === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export const percent = (n: number | null) => n === null ? 'Unavailable' : `${(n * 100).toFixed(1)}%`;

export const number = (n: number | null, digits = 1) => n === null ? 'Unavailable' : n.toFixed(digits);

export const dateText = (s: string, showYear = false) => new Date(s).toLocaleString(undefined, { year: showYear ? 'numeric' : undefined, month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const href = (screen: string, id?: string) => `#${screen}${id ? `/${encodeURIComponent(id)}` : ''}`;

// One link vocabulary for every screen, as shown on the Overview. The API's Measured links
// (backed by a historical measurement) read "Related"; unmeasured shared-topic links read "Topic".
export const linkLabel = (type: LinkType) => type === 'Measured' ? 'Related' : type === 'Related' ? 'Topic' : type;

// Says which Kalshi field an event date came from, so a market close is never passed off as the event.
export const eventTimeLabel = (source: ExposureEvent['eventTimeSource']) => ({ occurrence: 'Kalshi event time', strike: 'Kalshi strike date', expected: 'Kalshi expected resolution', close: 'Kalshi market close' })[source];

export function EventDate({ event, showYear = false }: {
    event: ExposureEvent;
    showYear?: boolean;
}) { return <><time dateTime={event.eventTime}>{dateText(event.eventTime, showYear)}</time> · {eventTimeLabel(event.eventTimeSource)}{event.eventTimeSource !== 'close' && <> · market closes <time dateTime={event.closeTime}>{dateText(event.closeTime, showYear)}</time></>}</>; }

export function LinkChip({ type, children }: {
    type: LinkType;
    children?: ReactNode;
}) { return <span className={`chip ${type}`} title={children ? linkLabel(type) : undefined}>{children ?? linkLabel(type)}</span>; }

let sessionKey: string | null = null;
export function setSessionKey(value: string) { sessionKey = value; }
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    headers.set('Content-Type', 'application/json');
    headers.set('X-Hedgehog-Request', '1');
    if (sessionKey) headers.set('X-Hedgehog-Session', sessionKey);
    const r = await fetch(`/api${path}`, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
    const data = await r.json();
    if (!r.ok) {
        if ((r.status === 401 && !['/auth/signin', '/auth/signup', '/auth/session'].includes(path)) || r.status === 409 && data.error?.includes('session changed'))
            window.dispatchEvent(new Event('hedgehog-session-changed'));
        throw new Error(data.error ?? 'Data unavailable');
    }
    return data as T;
}

export function useData<T>(path: string) { const [data, setData] = useState<T | null>(null), [error, setError] = useState(''); useEffect(() => { const controller = new AbortController(); setData(null); setError(''); api<T>(path, { signal: controller.signal }).then(setData).catch(e => { if (e.name !== 'AbortError')
    setError(e.message); }); return () => controller.abort(); }, [path]); return { data, error }; }

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

export function EventList({ events, showYear = false }: {
    events: ExposureEvent[];
    showYear?: boolean;
}) { return <>{events.map(e => <div className="event-row" key={e.ticker}><div className="row"><div><span className="chip plain">{e.links.some(l => l.type === 'Direct') ? 'Company' : e.category}</span><p className="note"><EventDate event={e} showYear={showYear}/></p><a className="event-title" href={href('event', e.ticker)}>{e.title}</a><div className="link-chips" aria-label="Linked holdings">{e.links.map(l => <LinkChip key={l.symbol} type={l.type}>{l.symbol}</LinkChip>)}</div></div><div><strong className="mono">{money(e.linkedValue)}</strong><p className="note">{percent(e.share)} of portfolio</p><a href={href('event', e.ticker)}>View event →</a></div></div>{e.markets.length === 1 && <><span className="mono">{percent(e.markets[0].probability)} yes · bid–ask midpoint</span> <TrustBadge market={e.markets[0]}/></>}</div>)}</>; }
