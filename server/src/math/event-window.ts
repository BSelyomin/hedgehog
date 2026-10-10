import type { PricePoint } from './series.ts';
import type { HistoricalPriceMove } from '../../../shared/types.ts';
const marketDate=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
// First version supports verified pre-open releases. Intraday and after-hours
// releases need an exchange close calendar (including early closes), never a guessed 4 p.m.
export function releaseWindow(releasedAt:string,spy:PricePoint[],now=new Date()):{beforeDate:string;afterDate:string}|null {
    const release=new Date(releasedAt);
    if(!Number.isFinite(release.getTime())||release>=now) return null;
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(release);
    const minutes=Number(parts.find(p=>p.type==='hour')?.value)*60+Number(parts.find(p=>p.type==='minute')?.value);
    if(minutes>=570) return null;
    const day=marketDate(release);
    // Today's daily candle may still be forming; publish comparisons from the next day.
    if(day>=marketDate(now)) return null;
    const dates=[...new Set(spy.filter(p=>Number.isFinite(p.close)&&p.close>0).map(p=>p.date))].sort();
    // A missing release-day benchmark is a gap, not proof the exchange was closed.
    if(!dates.includes(day)) return null;
    const previousWeekday=new Date(`${day}T12:00:00Z`);
    do {previousWeekday.setUTCDate(previousWeekday.getUTCDate()-1);} while([0,6].includes(previousWeekday.getUTCDay()));
    const before=previousWeekday.toISOString().slice(0,10);
    // Without an exchange holiday calendar, omit holiday/gapped windows rather
    // than silently comparing an older, potentially multi-session price.
    if(!dates.includes(before)) return null;
    return {beforeDate:before,afterDate:day};
}
export function observedMove(prices:PricePoint[],window:{beforeDate:string;afterDate:string}|null):HistoricalPriceMove|null {
    if(!window) return null;
    const before=prices.find(p=>p.date===window.beforeDate)?.close,after=prices.find(p=>p.date===window.afterDate)?.close;
    if(before===undefined||after===undefined||!Number.isFinite(before)||!Number.isFinite(after)||before<=0||after<=0) return null;
    return {...window,beforeClose:before,afterClose:after,change:after/before-1};
}
