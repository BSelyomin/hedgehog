import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LinkChip, linkLabel, linkMeaning } from './common';
import { Explain, Info } from './explain';
import type { LinkType } from '../../shared/types';

describe('link chips that explain themselves', () => {
    it('keeps the chip and adds its meaning beside it, closed until pointed at', () => {
        const html = renderToStaticMarkup(<LinkChip type="Measured"/>);
        expect(html).toContain('<span class="chip Measured">Related</span>');
        expect(html).toContain('role="tooltip"');
        expect(html).toContain('class="explain-pop" hidden=""');
        expect(html).toContain('<strong>Related link</strong>');
        expect(html).toContain('<em>Based on</em> Measured from the holding’s past daily price changes');
        expect(html).toContain('at least 60 observations and a 95% range that excludes zero');
        expect(html).toContain('<em>Keep in mind</em> It describes the past');
        // The explanation is tied to the chip for screen readers even while it is closed.
        const described = /aria-describedby="([^"]+)"/.exec(html)![1];
        expect(html).toContain(`role="tooltip" id="${described}"`);
    });
    it('explains every link type under the name the screens use for it', () => {
        for (const type of ['Direct', 'Calculated', 'Measured', 'Related'] as LinkType[]) {
            const html = renderToStaticMarkup(<LinkChip type={type}/>);
            expect(html, type).toContain(`<strong>${linkLabel(type)} link</strong>`);
            for (const part of Object.values(linkMeaning[type]))
                expect(part.length, type).toBeGreaterThan(40);
        }
        expect(renderToStaticMarkup(<LinkChip type="Related"/>)).toContain('<strong>Topic link</strong>');
        expect(linkMeaning.Calculated.basis).toContain('Nothing is estimated from price history');
        expect(linkMeaning.Direct.limit).toContain('no estimate of how far the price would move');
        expect(linkMeaning.Related.basis).toContain('no number is shown');
    });
    it('is reachable by keyboard only where asked, and leaves symbol chips as they were', () => {
        expect(renderToStaticMarkup(<LinkChip type="Direct"/>)).not.toContain('tabindex');
        expect(renderToStaticMarkup(<LinkChip type="Direct" focusable/>)).toContain('class="explained" tabindex="0"');
        expect(renderToStaticMarkup(<LinkChip type="Direct">AAPL</LinkChip>)).toBe('<span class="chip Direct" title="Direct">AAPL</span>');
    });
    it('offers an “i” button that says what it explains and is tied to the explanation', () => {
        const html = renderToStaticMarkup(<Info title="Beyond market">The change minus the market estimate.</Info>);
        const [, described] = /<button type="button" class="info" aria-label="What “Beyond market” means" aria-describedby="([^"]+)"><span aria-hidden="true">i<\/span><\/button>/.exec(html)!;
        expect(html).toContain(`<span role="tooltip" id="${described}" class="explain-pop" hidden=""><strong>Beyond market</strong><span>The change minus the market estimate.</span></span>`);
        // A real button: the keyboard reaches it without the wrapper being made focusable too.
        expect(html).not.toContain('tabindex');
    });
    it('wraps any label with a titled explanation', () => {
        const html = renderToStaticMarkup(<Explain title="Trust" body={<span>How far to rely on the odds.</span>}>Trust 82</Explain>);
        expect(html).toMatch(/^<span class="explained" aria-describedby="[^"]+">Trust 82<span role="tooltip"/);
        expect(html).toContain('<strong>Trust</strong><span>How far to rely on the odds.</span>');
    });
});
