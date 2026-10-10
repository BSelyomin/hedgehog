import type { HistoricalRating } from '../../../shared/types.ts';
// An earlier quote and how the question ended. The quote is a bid and an ask, or the midpoint
// alone where that is all the record keeps (settled_markets).
export interface RatingObservation {event: string;bid?: number|null;ask?: number|null;probability?: number|null;outcome: number;status: string}
const midpoint=(r: RatingObservation): number|null=>{
    if(r.probability!==undefined)return r.probability!==null&&Number.isFinite(r.probability)&&r.probability>=0&&r.probability<=1?r.probability:null;
    const {bid,ask}=r;
    return bid==null||ask==null||!Number.isFinite(bid)||!Number.isFinite(ask)||bid<0||ask>1||bid>ask?null:(bid+ask)/2;
};
// Observed favored-outcome agreement, not a probability of the next event or calibration.
export function historicalRating(rows: RatingObservation[]): HistoricalRating {
    let evaluated=0,matched=0,missing=0,tied=0,excluded=0;
    const events=new Set<string>();
    for(const r of rows) {
        if(r.status==='missing') {missing++;continue;}
        const p=r.status==='quoted'?midpoint(r):null;
        if(p===null||![0,1].includes(r.outcome)) {excluded++;continue;}
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
