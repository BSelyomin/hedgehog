'use client';
import { useRef, useState } from 'react';
import { ExposureTable, countedLinks } from './exposure-table';
import { CategoryCards, CategoryFilter } from './category-controls';
import type { ExposureResponse, CalendarResponse, BriefingPart, BriefingResponse } from '../../../shared/types';
import { money, percent, dateText, href, api, useData, Card, Fresh, Status, LinkChip, EventDate, ReloadButton } from '../common';
import { useOwner } from '../auth';

export function Overview() {
    const { data, error, reload } = useData<ExposureResponse>('/exposure');
    const [revision, setRevision] = useState(0);
    const owner = useOwner();
    // Events arrive widest first. One linked only by an unmeasured topic has no reach and is left out, as in the table.
    const counted = data?.events.filter(event => countedLinks(event).length > 0) ?? [], widest = counted[0];
    return <>
        <div className="row"><div><h1>{owner.Their} exposure map</h1><p>{owner.Their} holdings and the events linked to them</p></div><div className="toolbar"><ReloadButton onReload={async () => { setRevision(v => v + 1); await reload(); }}/><a href="#holdings">Edit holdings →</a></div></div>
        <Status error={error} loading={!data && !error} layout="summary"/>
        {data && <>
            <Fresh asOf={data.asOf}/>
            <div className="stats overview-stats">
                <Card><span className="muted">Portfolio value · entered by {owner.they}</span><strong className="number">{money(data.totalValue)}</strong><span className="muted">{data.holdings.length} holdings</span></Card>
                <Card className="widest-event"><span className="muted">Widest-reaching event</span><h3>{widest?.title ?? 'No links yet'}</h3>
                    <p>{widest ? `${percent(widest.share)} of ${owner.their} value linked` : 'Add holdings and review market tags.'}</p>
                    {widest && <p className="note">Ends <time dateTime={widest.closeTime}>{dateText(widest.closeTime, true)}</time> · Kalshi market close</p>}
                </Card>
                <EndingSoon key={revision}/>
                <Card><span className="muted">Linked events (all future dates)</span><strong className="number">{counted.length}</strong><p className="note">Calendar defaults to the next 14 days.</p><a href="#calendar">Open calendar →</a></Card>
                <Card><span className="muted">Daily price changes</span><h3>Understand {owner.their} move</h3><a href="#moves">Open move explainer →</a></Card>
            </div>
            <CategoryCards categories={data.categories}/>
            <Card className="exposure-map">
                <div className="row exposure-map-heading"><div><h2>Which events touch which holdings</h2><p className="note">Expand an event for details. Every linked holding is shown in its row.</p></div>
                    <div className="exposure-legend">{(['Direct', 'Calculated', 'Measured'] as const).map(type => <LinkChip key={type} type={type} focusable/>)}</div>
                </div>
                <CategoryFilter categories={data.categories}/>
                <ExposureTable data={data}/>
                <details className="exposure-help"><summary>How to read this table</summary><p className="note">Red = Direct; green = Calculated from a holding’s own terms (cash, bonds, a mortgage); blue = Related, backed by historical measurements. Only connected holdings appear, strongest links first. Color describes the link, not the direction of a price move. Share counts every holding linked by a Direct, Calculated or Related link, including those hidden by filters, against {owner.their} full portfolio value. A holding linked only by a shared topic is not counted. Share shows portfolio reach, not how much holdings would move.</p></details>
            </Card>
        </>}
        <Briefing key={revision}/>
    </>;
}

function EndingSoon() {
    const { data, error } = useData<CalendarResponse>('/calendar?days=14');
    const upcoming = data?.events.filter(event => countedLinks(event).length > 0) ?? [], next = upcoming[0];
    return <Card className="ending-soon"><span className="muted">Events coming up</span>
        {error ? <p className="note">Upcoming events unavailable.</p> : !data ? <Status error="" loading layout="compact" label="Loading upcoming events"/> : <>
            <strong className="number">{upcoming.length}</strong><p className="note">In the next 14 days</p>
            {next ? <><a href={href('event', next.ticker)}>{next.title}</a><p className="note">Next: <EventDate event={next} showYear/></p></> : <p className="note">No linked events fall in this window.</p>}
        </>}
        <a href="#calendar">View upcoming events →</a>
    </Card>;
}

// The briefing as text that follows the voice. The sentence being spoken is marked, pressing a
// sentence plays from it, and a sentence that states a figure links to the screen the figure is on.
export function Transcript({ parts, time = -1, onPlay }: { parts: BriefingPart[]; time?: number; onPlay?: (start: number) => void }) {
    // The sentence being spoken is the last one that has started.
    let speaking = -1;
    if (time >= 0)
        parts.forEach((part, i) => { if (part.start !== null && time >= part.start) speaking = i; });
    return <ol className="briefing-transcript" aria-label="Briefing transcript">{parts.map((part, i) => <li key={i} className={i === speaking ? 'speaking' : undefined} aria-current={i === speaking ? 'true' : undefined}>
        {part.start !== null && onPlay ? <button onClick={() => onPlay(part.start!)} title="Play from this sentence">{part.text}</button> : <span>{part.text}</span>}
        {part.source && <a href={part.source.href}>{part.source.label} →</a>}
    </li>)}</ol>;
}

const briefingDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });

export function Briefing() {
    const { data, error, reload } = useData<BriefingResponse>('/briefing');
    const owner = useOwner();
    const [time, setTime] = useState(-1);
    const audio = useRef<HTMLAudioElement>(null);
    const play = (start: number) => { const player = audio.current; if (player) { player.currentTime = start; void player.play(); } };
    const follows = Boolean(data?.audioUrl && data.parts?.some(part => part.start !== null));
    return <Card>
        <div className="row"><h2>{owner.Their} saved briefing</h2><ReloadButton label="Reload briefing" onReload={() => reload('/briefing/reload')}/></div>
        <Status error={error} loading={!data && !error} layout="compact"/>
        {data && <>
            <p className="note" role="status">{!data.text ? `No briefing for ${owner.their} current holdings yet. Select Reload briefing to prepare one from available data.`
                : data.date === data.today ? `Today’s briefing for ${owner.their} current holdings. One is made each day.`
                : `The latest briefing for ${owner.their} current holdings is from ${briefingDate(data.date)}. Select Reload briefing to make today’s.`}</p>
            {data.generatedAt && <p className="note">Saved <time dateTime={data.generatedAt}>{new Date(data.generatedAt).toLocaleString()}</time>. It describes that moment; current market figures may differ.</p>}
            {data.audioUrl && <audio ref={audio} controls preload="none" src={data.audioUrl} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} onEnded={() => setTime(-1)}/>}
            {data.parts ? <>
                <Transcript parts={data.parts} time={time} onPlay={follows ? play : undefined}/>
                <p className="note">{follows ? 'The transcript follows the voice; press a sentence to hear it from there. ' : ''}A sentence that states a figure links to the screen where that figure is shown. Every number was checked against the data it came from before it was spoken.{data.audioUrl ? ' Voice by ElevenLabs.' : ''}</p>
            </> : data.text && <details><summary>Read briefing</summary><p>{data.text}</p></details>}
            <Fresh asOf={data.asOf}/>
        </>}
    </Card>;
}
