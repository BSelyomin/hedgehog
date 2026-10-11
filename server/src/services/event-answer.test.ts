import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ eventDetail: vi.fn(), searchSources: vi.fn(), cortexResult: vi.fn(), configured: vi.fn() }));
vi.mock('../db.ts', () => ({ query: vi.fn(), pool: {}, aiPool: {} }));
vi.mock('./exposure.ts', () => ({ eventDetail: mocks.eventDetail }));
vi.mock('./snowflake.ts', async original => ({ ...await original<typeof import('./snowflake.ts')>(), searchSources: mocks.searchSources, cortexResult: mocks.cortexResult, snowflakeSearchConfigured: mocks.configured }));
import { ASK_INSTRUCTIONS, ASK_LIMIT, ASK_WINDOW_MS, askAllowed, askEvent, checkedAnswer, resetAskLimits, validateQuestion } from './event-answer.ts';
import { CortexError } from './snowflake.ts';
import { spelledFigure } from './ai-guard.ts';
import { SUMMARY_INSTRUCTIONS, checkedSummary } from '../jobs/summaries.ts';

const passages = [{ id: 'source-0', title: 'Fed holds rates', url: 'https://example.com/fed', text: 'The Fed held rates at 4.25 percent.' }, { id: 'source-1', title: 'Jobs report', url: 'https://example.com/jobs', text: 'Payrolls rose by 150,000.' }];
const marketData = { event: { ticker: 'KXFED-26DEC', title: 'Fed decision in December' }, markets: [{ outcome: 'Cut', yes_percent: 62 }, { outcome: 'Hold', yes_percent: null }] };
const detail = { asOf: '2026-10-10T12:00:00Z', event: { ticker: 'KXFED-26DEC', title: 'Fed decision in December', markets: [{ title: 'Will the Fed cut?', subtitle: 'Cut', probability: .6249 }, { title: 'Will the Fed hold?', subtitle: 'Hold', probability: null }] } };
// Cortex returns what it was asked to write, with the input it was written from.
const reply = (result: unknown) => async (_instructions: string, input: unknown, _schema: unknown, _identity: unknown, accept?: (r: unknown) => boolean) => {
    if (accept && !accept(result)) throw new CortexError('Snowflake estimate failed driver, confidence, evidence or source/number validation.');
    return { value: { result, input }, createdAt: '2026-10-10T12:00:05.000Z' };
};
beforeEach(() => {
    vi.resetAllMocks(); resetAskLimits();
    mocks.configured.mockReturnValue(true); mocks.eventDetail.mockResolvedValue(detail); mocks.searchSources.mockResolvedValue(passages);
    mocks.cortexResult.mockImplementation(reply({ answered: true, text: 'Reporting says the Fed held rates. Kalshi puts a cut at 62 percent.', sourceIds: ['source-0'] }));
});

describe('a question about an event', () => {
    it('accepts one line of 5 to 200 characters and tidies its spacing', () => {
        expect(validateQuestion('  What   has been\nreported? ')).toBe('What has been reported?');
        for (const bad of [undefined, null, 42, '', 'Why?', '   a   ', 'x'.repeat(201)]) expect(() => validateQuestion(bad)).toThrow();
        expect(validateQuestion('x'.repeat(200))).toHaveLength(200);
    });
    it('shows an answer only when it cites retrieved passages and states no figure outside the market data', () => {
        const good = { answered: true, text: 'The Fed held rates. A cut is at 62 percent.', sourceIds: ['source-1', 'source-0'] };
        expect(checkedAnswer(good, marketData, passages)).toEqual({ text: good.text, sources: [{ title: 'Fed holds rates', url: 'https://example.com/fed' }, { title: 'Jobs report', url: 'https://example.com/jobs' }] });
        // A figure from the reporting, not the market data: 4.25 is in a passage but not in what Kalshi quotes.
        expect(checkedAnswer({ ...good, text: 'The Fed held rates at 4.25 percent.' }, marketData, passages)).toBeNull();
        expect(checkedAnswer({ ...good, sourceIds: [] }, marketData, passages)).toBeNull();
        expect(checkedAnswer({ ...good, sourceIds: ['source-9'] }, marketData, passages)).toBeNull();
        expect(checkedAnswer({ ...good, text: '   ' }, marketData, passages)).toBeNull();
        expect(checkedAnswer({ ...good, text: 'See https://example.org/made-up for more.' }, marketData, passages)).toBeNull();
        expect(checkedAnswer({ ...good, answered: false }, marketData, passages)).toBeNull();
        expect(checkedAnswer('The Fed held rates.', marketData, passages)).toBeNull();
        // A figure spelled out in words is a figure the digit check cannot read: it is refused too.
        expect(checkedAnswer({ ...good, text: 'Output is forecast to average thirteen point eight million barrels a day.' }, marketData, passages)).toBeNull();
    });
    it('retrieves reporting for the event and the question, and answers from it with the checks it passed', async () => {
        const answer = await askEvent('session', 'KXFED-26DEC', 'What has been reported?');
        expect(mocks.searchSources).toHaveBeenCalledWith('Fed decision in December What has been reported?');
        const [instructions, input, schema, identity] = mocks.cortexResult.mock.calls[0];
        expect(instructions).toBe(ASK_INSTRUCTIONS);
        // Odds are given as whole percents; a market with no quote gives none.
        expect(input).toEqual({ question: 'What has been reported?', marketData, passages });
        expect(schema.properties.sourceIds.items.enum).toEqual(['source-0', 'source-1']);
        // The same question over the same passages is one stored answer, whatever the odds are now.
        expect(identity).toEqual({ event: 'KXFED-26DEC', question: 'what has been reported?', passages });
        expect(answer).toEqual({ status: 'answered', question: 'What has been reported?', text: 'Reporting says the Fed held rates. Kalshi puts a cut at 62 percent.',
            sources: [{ title: 'Fed holds rates', url: 'https://example.com/fed' }], checks: { sourcesRetrieved: 2, sourcesCited: 1, numbersChecked: 1 },
            reason: null, generatedAt: '2026-10-10T12:00:05.000Z', asOf: detail.asOf });
    });
    it('shows no answer when the sources do not answer the question or none were found', async () => {
        mocks.cortexResult.mockImplementation(reply({ answered: false, text: '', sourceIds: [] }));
        expect(await askEvent('session', 'KXFED-26DEC', 'Who will win the game?')).toMatchObject({ status: 'no-answer', text: null, sources: [], checks: { sourcesRetrieved: 2, sourcesCited: 0, numbersChecked: 0 } });
        mocks.searchSources.mockResolvedValue([]); mocks.cortexResult.mockClear();
        expect(await askEvent('session', 'KXFED-26DEC', 'What has been reported?')).toMatchObject({ status: 'no-answer', text: null, checks: null });
        expect(mocks.cortexResult).not.toHaveBeenCalled();
    });
    it('hides an answer that fails the checks, and says so without the text', async () => {
        mocks.cortexResult.mockImplementation(reply({ answered: true, text: 'The Fed held rates at 4.25 percent.', sourceIds: ['source-0'] }));
        const answer = await askEvent('session', 'KXFED-26DEC', 'What has been reported?');
        expect(answer).toMatchObject({ status: 'unavailable', text: null, sources: [], reason: 'An answer was written but did not pass the source and number checks, so it is not shown.' });
        expect(JSON.stringify(answer)).not.toContain('4.25');
        expect(mocks.cortexResult).toHaveBeenCalledTimes(1);
    });
    it('checks a stored answer against the market data it was written from', async () => {
        // Stored when a cut was at 55 percent; today's 62 must not make the old figure fail, nor a new one pass.
        mocks.cortexResult.mockResolvedValue({ value: { result: { answered: true, text: 'A cut was at 55 percent.', sourceIds: ['source-0'] }, input: { marketData: { markets: [{ outcome: 'Cut', yes_percent: 55 }] } } }, createdAt: '2026-10-08T09:00:00.000Z' });
        expect(await askEvent('session', 'KXFED-26DEC', 'What has been reported?')).toMatchObject({ status: 'answered', text: 'A cut was at 55 percent.', generatedAt: '2026-10-08T09:00:00.000Z' });
        mocks.cortexResult.mockResolvedValue({ value: { result: { answered: true, text: 'A cut is at 62 percent.', sourceIds: ['source-0'] }, input: { marketData: { markets: [{ outcome: 'Cut', yes_percent: 55 }] } } }, createdAt: '2026-10-08T09:00:00.000Z' });
        expect(await askEvent('session', 'KXFED-26DEC', 'What has been reported?')).toMatchObject({ status: 'no-answer', text: null });
    });
    it('answers nothing for an event the portfolio is not linked to, or without the reporting index', async () => {
        mocks.eventDetail.mockResolvedValue(null);
        expect(await askEvent('session', 'NOPE', 'What has been reported?')).toBeNull();
        mocks.eventDetail.mockResolvedValue(detail); mocks.configured.mockReturnValue(false);
        expect(await askEvent('session', 'KXFED-26DEC', 'What has been reported?')).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('reporting index') });
        expect(mocks.searchSources).not.toHaveBeenCalled();
        mocks.configured.mockReturnValue(true); mocks.searchSources.mockRejectedValue(new Error('socket hang up at 10.0.0.1'));
        // A failure says nothing of what went wrong inside.
        expect(await askEvent('session', 'KXFED-26DEC', 'What has been reported?')).toMatchObject({ status: 'unavailable', reason: 'The answer service is unavailable right now.' });
    });
    it('lets one browser ask eight questions in ten minutes', () => {
        const start = 1_000_000;
        for (let i = 0; i < ASK_LIMIT; i++) expect(askAllowed('a', start + i)).toBe(true);
        expect(askAllowed('a', start + ASK_LIMIT)).toBe(false);
        // Another browser is not held back, and the first may ask again when the window has passed.
        expect(askAllowed('b', start)).toBe(true);
        expect(askAllowed('a', start + ASK_WINDOW_MS - 1)).toBe(false);
        expect(askAllowed('a', start + ASK_WINDOW_MS + ASK_LIMIT)).toBe(true);
    });
});

describe('a figure spelled out in words', () => {
    it('is recognised, so that asking for no digits cannot let an unchecked number through', () => {
        for (const text of ['forecast to average thirteen point eight million barrels per day', 'the third quarter of twenty twenty-six', 'rose ten percent', 'fell by two percentage points',
            'about five hundred jobs', 'Thirty-five thousand workers', 'a deficit of one trillion', 'millions of barrels', 'sixty-five per cent'])
            expect([text, spelledFigure(text)]).toEqual([text, true]);
    });
    it('leaves alone a plain count and the name of an instrument or a period', () => {
        for (const text of ['The two-year Treasury yield rose.', 'the thirty-year mortgage rate fell', 'Two reports describe rising prices.', 'At one point prices fell sharply.', 'the third quarter',
            'a record for the second year running', 'Prices rose for a seventh week.', 'one of the reasons', 'the point of the report'])
            expect([text, spelledFigure(text)]).toEqual([text, false]);
    });
    it('keeps a summary that spells a figure out from being stored or shown', () => {
        const input = { event: { ticker: 'KXWTI', title: 'Oil above 90' }, markets: [] };
        expect(checkedSummary({ text: 'Crude prices rose amid tight supply.', sourceIds: ['source-0'] }, input, passages)).toEqual({ text: 'Crude prices rose amid tight supply.', sources: [{ title: 'Fed holds rates', url: 'https://example.com/fed' }] });
        expect(checkedSummary({ text: 'Output is forecast to average thirteen point eight million barrels a day.', sourceIds: ['source-0'] }, input, passages)).toBeNull();
        expect(checkedSummary({ text: 'Crude rose to 91 dollars.', sourceIds: ['source-0'] }, input, passages)).toBeNull();
        // The digits of the market data may still be used.
        expect(checkedSummary({ text: 'Traders are watching the 90 level.', sourceIds: ['source-0'] }, input, passages)?.text).toBe('Traders are watching the 90 level.');
        expect(SUMMARY_INSTRUCTIONS).toContain('neither in digits nor spelled out in words');
    });
});
