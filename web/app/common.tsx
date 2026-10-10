'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { AssetType, ExposureEvent, LinkType, Market } from '../../shared/types';
import { Explain } from './explain';
export const money = (n: number | null) => n === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);

export const percent = (n: number | null) => n === null ? 'Unavailable' : `${(n * 100).toFixed(1)}%`;

export const number = (n: number | null, digits = 1) => n === null ? 'Unavailable' : n.toFixed(digits);

export const dateText = (s: string, showYear = false) => new Date(s).toLocaleString(undefined, { year: showYear ? 'numeric' : undefined, month: 'short', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit' });

export const href = (screen: string, id?: string) => `#${screen}${id ? `/${encodeURIComponent(id)}` : ''}`;

// One link vocabulary for every screen, as shown on the Overview. The API's Measured links
// (backed by a historical measurement) read "Related"; unmeasured shared-topic links read "Topic".
// Calculated links are exact arithmetic on a holding's own terms (cash, bonds, a mortgage).
export const linkLabel = (type: LinkType) => type === 'Measured' ? 'Related' : type === 'Related' ? 'Topic' : type;

export const assetLabel: Record<AssetType, string> = { security: 'Stock or fund', cash: 'Cash or savings', treasury: 'Treasury or CD', bond: 'Bond', property: 'Property' };

// Says which Kalshi field an event date came from, so a market close is never passed off as the event.
export const eventTimeLabel = (source: ExposureEvent['eventTimeSource']) => ({ occurrence: 'Kalshi event time', stated: 'Kalshi stated date', strike: 'Kalshi strike date', expected: 'Kalshi expected resolution', close: 'Kalshi market close' })[source];

// A day without a time, read in New York where Kalshi states it.
export const dayOnly = (s: string, showYear = false) => new Date(s).toLocaleDateString(undefined, { timeZone: 'America/New_York', year: showYear ? 'numeric' : undefined, month: 'short', day: 'numeric', weekday: 'short' });

export function EventDate({ event, showYear = false }: {
    event: ExposureEvent;
    showYear?: boolean;
}) { return <><time dateTime={event.eventTime}>{event.eventTimeSource === 'stated' ? dayOnly(event.eventTime, showYear) : dateText(event.eventTime, showYear)}</time> · {eventTimeLabel(event.eventTimeSource)}{event.eventTimeSource !== 'close' && <> · market closes <time dateTime={event.closeTime}>{dateText(event.closeTime, showYear)}</time></>}</>; }

// What each link type means, opened beside its chip: what it is, what it rests on, and what it
// does not tell you.
export const linkMeaning: Record<LinkType, { means: string; basis: string; limit: string }> = {
    Direct: {
        means: 'A Kalshi market about this holding itself: a company’s earnings call or a number it reports, or a fund’s own price.',
        basis: 'The market’s series carries this ticker as a reviewed tag.',
        limit: 'It says the event concerns the holding. It gives no estimate of how far the price would move.',
    },
    Calculated: {
        means: 'Exact arithmetic on the terms you entered for a holding without a ticker: cash, a Treasury or CD, a bond, or a property with an adjustable mortgage.',
        basis: 'Yearly interest per point of rate on a cash or mortgage balance, or a bond’s price change from its duration. Nothing is estimated from price history.',
        limit: 'It answers what one point of rate change would do, not whether the event will happen.',
    },
    Measured: {
        means: 'The holding’s price has moved reliably with the driver behind this event: oil, Treasury yields, mortgage rates or the stock market.',
        basis: 'Measured from the holding’s past daily price changes (weekly for mortgage rates). It counts only with at least 60 observations and a 95% range that excludes zero.',
        limit: 'It describes the past, not what this event’s outcome will do. The link can be small: each one says which driver matters most to the holding.',
    },
    Related: {
        means: 'The holding shares a reviewed topic with the event, and nothing more.',
        basis: 'No reliable relationship showed up in price history, so no number is shown.',
        limit: 'Worth knowing about, not a measured effect. The Overview leaves these out.',
    },
};

// A chip that names a link type explains it when pointed at; `focusable` lets the keyboard reach
// it too. A chip that carries a holding's symbol keeps its short label.
export function LinkChip({ type, children, focusable = false }: {
    type: LinkType;
    children?: ReactNode;
    focusable?: boolean;
}) {
    if (children)
        return <span className={`chip ${type}`} title={linkLabel(type)}>{children}</span>;
    const meaning = linkMeaning[type];
    return <Explain title={`${linkLabel(type)} link`} focusable={focusable} body={<><span>{meaning.means}</span><span><em>Based on</em> {meaning.basis}</span><span><em>Keep in mind</em> {meaning.limit}</span></>}>
        <span className={`chip ${type}`}>{linkLabel(type)}</span>
    </Explain>;
}


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

export function EventList({ events, showYear = false }: {
    events: ExposureEvent[];
    showYear?: boolean;
}) { return <>{events.map(e => <div className="event-row" key={e.ticker}><div className="row"><div><span className="chip plain">{e.links.some(l => l.type === 'Direct') ? 'Company' : e.category}</span><p className="note"><EventDate event={e} showYear={showYear}/></p><a className="event-title" href={href('event', e.ticker)}>{e.title}</a><div className="link-chips" aria-label="Linked holdings">{e.links.map(l => <LinkChip key={l.symbol} type={l.type}>{l.symbol}</LinkChip>)}</div></div><div><strong className="mono">{money(e.linkedValue)}</strong><p className="note">{percent(e.share)} of portfolio</p><a href={href('event', e.ticker)}>View event →</a></div></div>{e.markets.length === 1 && <><span className="mono">{percent(e.markets[0].probability)} yes · bid–ask midpoint</span> <TrustBadge market={e.markets[0]}/></>}</div>)}</>; }
