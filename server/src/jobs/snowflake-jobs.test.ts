import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
    query: vi.fn(), seedFile: vi.fn(), cortexJson: vi.fn(), searchSources: vi.fn(),
    configured: vi.fn(), searchConfigured: vi.fn(), readFile: vi.fn()
}));
vi.mock('../db.ts', () => ({ query: mocks.query }));
vi.mock('../seed.ts', () => ({ seedFile: mocks.seedFile }));
vi.mock('./prices.ts', () => ({ yahoo: {} }));
vi.mock('node:fs/promises', () => ({ readFile: mocks.readFile }));
vi.mock('../services/snowflake.ts', async importOriginal => ({
    ...await importOriginal<typeof import('../services/snowflake.ts')>(),
    cortexJson: mocks.cortexJson, searchSources: mocks.searchSources,
    snowflakeConfigured: mocks.configured, snowflakeSearchConfigured: mocks.searchConfigured
}));

import { tagSeries } from './tagging.ts';
import { riskFactors } from './risk.ts';
import { checkedSummary, summaries } from './summaries.ts';

const passage = { id: 'source-0', title: 'Reporting', url: 'https://news.example/report', text: 'Oil prices moved 99 percent.' };
beforeEach(() => {
    vi.resetAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.searchConfigured.mockReturnValue(true);
    mocks.seedFile.mockResolvedValue(['oil', 'AAPL']);
    mocks.query.mockResolvedValue([]);
    mocks.searchSources.mockResolvedValue([passage]);
    mocks.readFile.mockResolvedValue('Filing risk factors');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Snowflake jobs', () => {
    it('caches valid empty classifications and does not repeatedly pay to classify unchanged series', async () => {
        const series = { series_ticker: 'SPORTS', title: 'Unrelated event', description: '' };
        mocks.query.mockResolvedValueOnce([series]);
        mocks.cortexJson.mockResolvedValue({ series: [{ series_ticker: 'SPORTS', tags: [] }] });
        await tagSeries();
        expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO series_tags'), expect.anything());
        const hash = createHash('sha256').update(JSON.stringify([['oil', 'AAPL'], series.title, series.description])).digest('hex');
        expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO job_state'), ['tag-series:SPORTS', hash]);
        mocks.cortexJson.mockClear();
        mocks.query.mockResolvedValueOnce([{ ...series, previous_hash: hash }]);
        await tagSeries();
        expect(mocks.cortexJson).not.toHaveBeenCalled();
    });

    it('does not mark a malformed classification as successfully processed', async () => {
        mocks.query.mockResolvedValueOnce([{ series_ticker: 'OIL', title: 'Oil', description: '' }]);
        mocks.cortexJson.mockResolvedValue({ series: [{ series_ticker: 'OIL', tags: 'oil' }] });
        await tagSeries();
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('does not contact the database or AI provider when disabled', async () => {
        mocks.configured.mockReturnValue(false);
        mocks.searchConfigured.mockReturnValue(false);
        await tagSeries();
        await summaries();
        expect(mocks.query).not.toHaveBeenCalled();
        expect(mocks.cortexJson).not.toHaveBeenCalled();
    });

    it('stores only allowed tags for requested series, with Snowflake provenance and pending review', async () => {
        mocks.query.mockResolvedValueOnce([{ series_ticker: 'OIL', title: 'Oil prices', description: '' }]);
        mocks.cortexJson.mockResolvedValue({ series: [
            { series_ticker: 'OIL', tags: ['oil', 'invented-tag', 'oil'] },
            { series_ticker: 'NOT-REQUESTED', tags: ['AAPL'] }, null, 5
        ] });
        await tagSeries();
        expect(mocks.query).toHaveBeenCalledTimes(3);
        expect(mocks.query.mock.calls[1]).toEqual([
            expect.stringContaining("'snowflake',false"), ['OIL', 'oil']
        ]);
    });

    it('continues later batches after a provider failure', async () => {
        mocks.query.mockResolvedValueOnce(Array.from({ length: 21 }, (_, i) => ({ series_ticker: `S${i}`, title: 'Oil', description: '' })));
        mocks.cortexJson.mockRejectedValueOnce(new Error('Provider failed'))
            .mockResolvedValueOnce({ series: [{ series_ticker: 'S20', tags: ['oil'] }] });
        await tagSeries();
        expect(mocks.cortexJson).toHaveBeenCalledTimes(2);
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO series_tags'), ['S20', 'oil']);
    });

    it('filters filing tags and caches successfully processed filings', async () => {
        mocks.cortexJson.mockResolvedValue({ tags: ['oil', 'invented-tag', 'oil'] });
        await riskFactors('AAPL', 'filing.txt', 'https://www.sec.gov/filing');
        expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO stock_tags'), ['AAPL', 'oil']);
        expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO risk_factors'),
            ['AAPL', 'https://www.sec.gov/filing', 'Filing risk factors']);
    });

    it('does not cache a malformed filing response as successful', async () => {
        mocks.cortexJson.mockResolvedValue({ tags: 'oil' });
        await expect(riskFactors('AAPL', 'filing.txt', 'https://www.sec.gov/filing')).rejects.toThrow('invalid filing tags');
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('reuses cached filings without calling Snowflake', async () => {
        mocks.query.mockResolvedValueOnce([{ symbol: 'AAPL' }]);
        await riskFactors('AAPL', 'filing.txt', 'https://www.sec.gov/filing');
        expect(mocks.readFile).not.toHaveBeenCalled();
        expect(mocks.cortexJson).not.toHaveBeenCalled();
    });

    it('does not generate or save an ungrounded summary', async () => {
        mocks.query.mockResolvedValueOnce([{ ticker: 'OIL', title: 'Oil event' }]);
        mocks.searchSources.mockResolvedValue([]);
        await summaries();
        expect(mocks.cortexJson).not.toHaveBeenCalled();
        expect(mocks.query).toHaveBeenCalledTimes(1);
    });

    it('stores checked text with retrieved citations and the original numeric inputs', async () => {
        const event = { ticker: 'OIL', title: 'Oil event' };
        const markets = [{ probability_points: 38 }];
        mocks.query.mockResolvedValueOnce([event]).mockResolvedValueOnce(markets);
        mocks.cortexJson.mockResolvedValue({ text: 'Odds are 38%.', sourceIds: ['source-0'] });
        await summaries();
        expect(mocks.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO summaries'), [
            'OIL', 'Odds are 38%.', JSON.stringify([{ title: passage.title, url: passage.url }]), JSON.stringify({ event, markets })
        ]);
    });

    it('does not persist invented numbers even when they occur in retrieved reporting', async () => {
        mocks.query.mockResolvedValueOnce([{ ticker: 'OIL', title: 'Oil event' }])
            .mockResolvedValueOnce([{ probability_points: 38 }]);
        mocks.cortexJson.mockResolvedValue({ text: 'Odds are 99%.', sourceIds: ['source-0'] });
        await summaries();
        expect(mocks.query).toHaveBeenCalledTimes(2);
    });
});

describe('summary acceptance', () => {
    it.each([
        { text: 'Context', sourceIds: [] },
        { text: 'Context', sourceIds: ['fabricated-source'] },
        { text: 'Context', sourceIds: ['source-0', 'fabricated-source'] },
        { text: 'Odds are 99%.', sourceIds: ['source-0'] },
        { text: '', sourceIds: ['source-0'] },
        null
    ])('fails closed for unsupported text or missing citations: %j', result => {
        expect(checkedSummary(result, { probability: 38 }, [passage])).toBeNull();
    });

    it('uses only retrieved URLs, ignoring any model-supplied source objects', () => {
        expect(checkedSummary({ text: 'Odds are 38%.', sourceIds: ['source-0', 'source-0'],
            sources: [{ title: 'Invented', url: 'https://fake.example' }] }, { probability: 38 }, [passage]))
            .toEqual({ text: 'Odds are 38%.', sources: [{ title: passage.title, url: passage.url }] });
    });
});
