import { describe, expect, it } from 'vitest';
import { searchIdentifier, validateSearchDocuments } from './search-setup.ts';

const now = new Date('2026-10-09T16:00:00Z');
const source = { title: 'Energy release', url: 'https://www.eia.gov/report', text: 'Published energy reporting.',
    publishedAt: '2026-10-08T12:00:00Z', feedUrl: 'https://www.eia.gov/rss/todayinenergy.xml' };

describe('search source import', () => {
    it('preserves source text and produces stable identities for repeat imports', () => {
        const first = validateSearchDocuments([source], now)[0];
        const revised = validateSearchDocuments([{ ...source, text: 'Corrected reporting.' }], now)[0];
        expect(first).toMatchObject({ ...source, publishedAt: '2026-10-08T12:00:00.000Z' });
        expect(first.id).toMatch(/^[a-f0-9]{64}$/);
        expect(revised.id).toBe(first.id);
    });

    it.each([
        [], [source, source], [{ ...source, url: 'http://www.eia.gov/report' }],
        [{ ...source, url: 'https://user:secret@www.eia.gov/report' }],
        [{ ...source, text: '' }], [{ ...source, text: 'x'.repeat(12001) }],
        [{ ...source, publishedAt: 'not a date' }], [{ ...source, publishedAt: '2020-01-01' }],
        [{ ...source, publishedAt: '2027-01-01' }], [{ ...source, feedUrl: 'file:///source' }]
    ].map(input => ({ input })))('rejects invalid, duplicate, stale or unsafe records: %j', ({ input }) => {
        expect(() => validateSearchDocuments(input, now)).toThrow();
    });

    it('rejects SQL fragments as resource identifiers', () => {
        expect(searchIdentifier('EVENT_SOURCES')).toBe('EVENT_SOURCES');
        for (const invalid of ['name; DROP TABLE x', 'a.b', '"Quoted"', 'lowercase'])
            expect(() => searchIdentifier(invalid)).toThrow();
    });
});
