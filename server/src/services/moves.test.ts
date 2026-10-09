import { it, expect } from 'vitest';
import { splitMove } from './moves.ts';
import { normalizeLadder } from './earnings.ts';
import type { ExposureEvent } from '../../../shared/types.ts';
it('move components sum to the actual move', () => { for (const actual of [-250.31, 0, 234.56]) {
    const split = splitMove(actual, 1.13, -.013, 5000);
    expect(split.fromMarket + split.beyondMarket).toBeCloseTo(actual, 10);
} });
it('normalizes a complete exclusive bracket ladder and retains raw sum', () => { const e = { ticker: 'event', mutuallyExclusive: true, markets: [{ ticker: 'a', title: 'a', subtitle: '', kind: 'bracket', probability: .2 }, { ticker: 'b', title: 'b', subtitle: '', kind: 'bracket', probability: .4 }] } as ExposureEvent; const ladder = normalizeLadder(e); expect(ladder?.rawSum).toBeCloseTo(.6); expect(ladder?.outcomes.reduce((s, m) => s + m.probability, 0)).toBeCloseTo(1); e.mutuallyExclusive = false; expect(normalizeLadder(e)).toBeNull(); });
