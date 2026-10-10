import {it,expect} from 'vitest';
import {releaseWindow,observedMove} from './event-window.ts';
const now=new Date('2026-10-10T12:00:00Z');
it('uses prior and release-day closes for verified pre-open releases across DST and weekends',()=>{
 const spy=[{date:'2026-09-10',close:100},{date:'2026-09-11',close:102}];
 expect(releaseWindow('2026-09-11T12:30:00Z',spy,now)).toEqual({beforeDate:'2026-09-10',afterDate:'2026-09-11'});
 expect(releaseWindow('2026-09-14T12:30:00Z',[...spy,{date:'2026-09-14',close:103}],now)?.beforeDate).toBe('2026-09-11');
 expect(releaseWindow('2026-01-13T13:30:00Z',[{date:'2026-01-12',close:100},{date:'2026-01-13',close:101}],now)?.afterDate).toBe('2026-01-13');
});
it('fails closed for intraday releases, future releases and missing benchmark dates',()=>{
 const spy=[{date:'2026-09-10',close:100},{date:'2026-09-11',close:102}];
 expect(releaseWindow('2026-09-11T18:00:00Z',spy,now)).toBeNull();
 expect(releaseWindow('2026-10-14T12:30:00Z',spy,now)).toBeNull();
 expect(releaseWindow('2026-09-14T12:30:00Z',spy,now)).toBeNull();
 expect(releaseWindow('bad',spy,now)).toBeNull();
 expect(releaseWindow('2026-09-11T12:30:00Z',[{date:'2026-09-09',close:100},{date:'2026-09-11',close:102}],now)).toBeNull();
 expect(releaseWindow('2026-09-11T12:30:00Z',spy,new Date('2026-09-11T14:00:00Z'))).toBeNull();
});
it('uses identical price endpoints and does not replace a missing stock close',()=>{
 const window={beforeDate:'2026-09-10',afterDate:'2026-09-11'};
 expect(observedMove([{date:'2026-09-10',close:100},{date:'2026-09-11',close:105}],window)?.change).toBeCloseTo(.05);
 expect(observedMove([{date:'2026-09-09',close:100},{date:'2026-09-11',close:105}],window)).toBeNull();
 expect(observedMove([{date:'2026-09-10',close:0},{date:'2026-09-11',close:105}],window)).toBeNull();
});
