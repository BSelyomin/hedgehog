import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../db.ts', () => ({ query: vi.fn().mockResolvedValue([]) }));
import { query } from '../db.ts';
import { syncMeasuredTags } from './measure.ts';
beforeEach(() => vi.clearAllMocks());
it('publishes only the fixed driver tags supported by a reliable regression', async () => {
    await syncMeasuredTags('DAL', 'DGS2', true);
    expect(query).toHaveBeenLastCalledWith(expect.stringContaining('FROM allowed_tags'), ['DAL', ['fed-rates', 'inflation']]);
});
it('removes a failed measured mapping without deleting independent human or filing tags', async () => {
    await syncMeasuredTags('DAL', 'CL=F', false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("AND link_type='measured'"), ['DAL', ['oil']]);
});
