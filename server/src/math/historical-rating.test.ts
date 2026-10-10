import {it,expect} from 'vitest';
import {historicalRating} from './historical-rating.ts';
const rows=(count:number,right:number)=>Array.from({length:count},(_,i)=>({event:`event-${i}`,bid:.7,ask:.9,outcome:i<right?1:0,status:'quoted'}));
it('scores the favored side, not the probability itself, and gates grades',()=>{
 expect(historicalRating(rows(40,36))).toMatchObject({accuracy:.9,grade:'A',matched:36});
 expect(historicalRating(rows(40,30))).toMatchObject({grade:'B',label:'Usually right'});
 expect(historicalRating(rows(40,20)).grade).toBe('C');
 expect(historicalRating(rows(40,19)).grade).toBe('D');
 expect(historicalRating(rows(29,29))).toMatchObject({accuracy:1,grade:null,label:'Limited history'});
 expect(historicalRating(rows(50,50).map(r=>({...r,event:'same-release'}))).grade).toBeNull();
 expect(historicalRating([{event:'no',bid:.1,ask:.2,outcome:0,status:'quoted'}]).accuracy).toBe(1);
});
it('excludes tied, missing, invalid and already-known observations from the denominator',()=>{
 const base={event:'x',bid:.4,ask:.6,outcome:1,status:'quoted'};
 expect(historicalRating([base,{...base,status:'missing'},{...base,status:'outcome_known'},{...base,bid:.8,ask:.2}])).toMatchObject({accuracy:null,tied:1,missing:1,excluded:2,evaluated:0});
});
