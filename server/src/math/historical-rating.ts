import type { HistoricalRating } from '../../../shared/types.ts';
export interface RatingObservation {event: string;bid: number|null;ask: number|null;outcome: number;status: string}
// Observed favored-outcome agreement, not a probability of the next event or calibration.
export function historicalRating(rows: RatingObservation[]): HistoricalRating {
    let evaluated=0,matched=0,missing=0,tied=0,excluded=0;
    const events=new Set<string>();
    for(const r of rows) {
        if(r.status==='missing') {missing++;continue;}
        if(r.status!=='quoted'||r.bid===null||r.ask===null||!Number.isFinite(r.bid)||!Number.isFinite(r.ask)||r.bid<0||r.ask>1||r.bid>r.ask||![0,1].includes(r.outcome)) {excluded++;continue;}
        const p=(r.bid+r.ask)/2;
        if(p===.5) {tied++;continue;}
        evaluated++;events.add(r.event);
        if((p>.5&&r.outcome===1)||(p<.5&&r.outcome===0))matched++;
    }
    const accuracy=evaluated?matched/evaluated:null;
    // A sample gate, not statistical proof of reliability. Event IDs may still share a release.
    const enough=evaluated>=30&&events.size>=10;
    const grade=!enough||accuracy===null?null:accuracy>=.9?'A':accuracy>=.75?'B':accuracy>=.5?'C':'D';
    const label=accuracy===null?'No history yet':!enough?'Limited history':grade==='A'?'Very often right':grade==='B'?'Usually right':grade==='C'?'Mixed record':'More often wrong';
    return {accuracy,grade,label,matched,evaluated,eventCount:events.size,missing,tied,excluded};
}
