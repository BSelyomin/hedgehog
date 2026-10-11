'use client';
import { ExposureTable } from './exposure-table';
import { CategoryCards, CategoryFilter } from './category-controls';
import type { ExposureResponse, CalendarResponse, BriefingResponse } from '../../../shared/types';
import { money, percent, dateText, href, useData, Card, Fresh, Status, LinkChip, EventDate, ReloadButton } from '../common';
import { invalidateCachedResponses } from '../../lib/api-client';

export async function reloadOverview(exposure: () => Promise<unknown>, upcoming: () => Promise<unknown>, briefing: () => Promise<unknown>) {
    for (const path of ['/exposure', '/calendar', '/briefing']) invalidateCachedResponses(path);
    if (!await exposure()) return;
    // Upcoming events reuse the freshly built exposure snapshot. Refreshing the
    // briefing metadata does not generate AI/audio; that remains an explicit action.
    await Promise.all([upcoming(), briefing()]);
}

export function Overview() {
    const { data, error, reload } = useData<ExposureResponse>('/exposure');
    const upcoming = useData<CalendarResponse>('/calendar?days=14');
    const briefing = useData<BriefingResponse>('/briefing');
    const widest = data?.events[0];
    return <>
        <div className="row"><div><h1>Your exposure map</h1><p>Your holdings and the events linked to them</p></div><div className="toolbar"><ReloadButton onReload={() => reloadOverview(() => reload(), () => upcoming.reload(undefined, false), () => briefing.reload())}/><a href="#holdings">Edit holdings →</a></div></div>
        <Status error={error} loading={!data && !error} layout="summary"/>
        {data && <>
            <Fresh asOf={data.asOf}/>
            <div className="stats overview-stats">
                <Card><span className="muted">Portfolio value · entered by you</span><strong className="number">{money(data.totalValue)}</strong><span className="muted">{data.holdings.length} holdings</span></Card>
                <Card className="widest-event"><span className="muted">Widest-reaching event</span><h3>{widest?.title ?? 'No links yet'}</h3>
                    <p>{widest ? `${percent(widest.share)} of your value linked` : 'Add holdings and review market tags.'}</p>
                    {widest && <p className="note">Ends <time dateTime={widest.closeTime}>{dateText(widest.closeTime, true)}</time> · Kalshi market close</p>}
                </Card>
                <EndingSoon data={upcoming.data} error={upcoming.error}/>
                <Card><span className="muted">Linked events (all future dates)</span><strong className="number">{data.events.length}</strong><p className="note">Calendar defaults to the next 14 days.</p><a href="#calendar">Open calendar →</a></Card>
                <Card><span className="muted">Daily price changes</span><h3>Understand your move</h3><a href="#moves">Open move explainer →</a></Card>
            </div>
            <CategoryCards categories={data.categories}/>
            <Card className="exposure-map">
                <div className="row exposure-map-heading"><div><h2>Which events touch which holdings</h2><p className="note">Expand an event for details. Every linked holding is shown in its row.</p></div>
                    <div className="exposure-legend">{(['Direct', 'Calculated', 'Measured'] as const).map(type => <LinkChip key={type} type={type} focusable/>)}</div>
                </div>
                <CategoryFilter categories={data.categories}/>
                <ExposureTable data={data}/>
                <details className="exposure-help"><summary>How to read this table</summary><p className="note">Red = Direct; green = Calculated from a holding’s own terms (cash, bonds, a mortgage); blue = Related, backed by historical measurements. Only connected holdings appear, strongest links first. Color describes the link, not the direction of a price move. Share and linked-holding counts use all source links, including those hidden by filters, and your full portfolio value. They show portfolio reach, not how much holdings would move.</p></details>
            </Card>
        </>}
        <BriefingContent {...briefing}/>
    </>;
}

function EndingSoon({ data, error }: { data: CalendarResponse | null; error: string }) {
    const next = data?.events[0];
    return <Card className="ending-soon"><span className="muted">Events coming up</span>
        {error ? <p className="note">Upcoming events unavailable.</p> : !data ? <Status error="" loading layout="compact" label="Loading upcoming events"/> : <>
            <strong className="number">{data.events.length}</strong><p className="note">In the next 14 days</p>
            {next ? <><a href={href('event', next.ticker)}>{next.title}</a><p className="note">Next: <EventDate event={next} showYear/></p></> : <p className="note">No linked events fall in this window.</p>}
        </>}
        <a href="#calendar">View upcoming events →</a>
    </Card>;
}

export function Briefing({ refreshOnMount = false }: { refreshOnMount?: boolean } = {}) {
    const state = useData<BriefingResponse>('/briefing', refreshOnMount);
    return <BriefingContent {...state}/>;
}

function BriefingContent({ data, error, reload }: ReturnType<typeof useData<BriefingResponse>>) {
    return <Card>
        <div className="row"><h2>Your saved briefing</h2><ReloadButton label="Reload briefing" onReload={() => reload('/briefing/reload')}/></div>
        <Status error={error} loading={!data && !error} layout="compact"/>
        {data && <>
            <p className="note" role="status">{data.text ? 'Cached briefing for your current holdings.' : 'No cached briefing for your current holdings. Select Reload briefing to prepare one from available data.'}</p>
            {data.generatedAt && <p className="note">Saved <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time>. This briefing describes that snapshot; current market figures may differ. Unchanged holdings reuse this saved briefing.</p>}
            {data.audioUrl && <audio controls preload="none" src={data.audioUrl}/>}
            {data.text && <details><summary>Read briefing</summary><p>{data.text}</p></details>}
            <Fresh asOf={data.asOf}/>
        </>}
    </Card>;
}
