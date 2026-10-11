import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { Categories, EarningsResponse, TrackRatingItem } from '../../shared/types';
import { AccountContext, ownerOf } from './auth';
import { AddHoldings } from './screens/holdings';
import { Overview } from './screens/overview';
import { Calendar } from './screens/calendar';
import { Earnings } from './screens/earnings';
import { Forecasts } from './screens/forecasts';
import { LeadDrivers, Moves } from './screens/moves';
import { FundPosition, HoldingDisclosure, TrackRecord } from './screens/track-record';
import { CategoryCards, CategoryFilter } from './screens/category-controls';
import { describeTypicalMove } from './screens/earnings-text';
import { describeLeadMove } from './screens/sensitivity';
import { money } from './common';

const user = (name: string) => ({ id: 'u1', email: 'alex@example.com', name, createdAt: '2026-01-01T00:00:00Z' });
// Draws a screen as the signed-in person sees it.
const as = (name: string, screen: ReactNode) => renderToStaticMarkup(<AccountContext.Provider value={{
    session: { user: user(name), sessionKey: 'k', expiresAt: null, asOf: null }, checking: false, error: '', notice: '', accept: () => {}, refresh: async () => {},
}}>{screen}</AccountContext.Provider>);

describe('whose portfolio the screens name', () => {
    it('names someone signed in and says "you" to a guest', () => {
        expect(ownerOf('Alex')).toMatchObject({ name: 'Alex', their: 'Alex’s', Their: 'Alex’s', they: 'Alex' });
        expect(ownerOf('Alex').does('hold')).toBe('Alex holds');
        expect(ownerOf('Alex').does('hold', true)).toBe('Alex holds');
        for (const guest of [ownerOf(), ownerOf(null), ownerOf(''), ownerOf('   ')]) {
            expect(guest).toMatchObject({ name: '', their: 'your', Their: 'Your', they: 'you' });
            expect([guest.does('hold'), guest.does('hold', true)]).toEqual(['you hold', 'You hold']);
        }
        // The name is used as it was written, without the spaces around it.
        expect(ownerOf('  Mary Ann  ').their).toBe('Mary Ann’s');
    });

    it('puts the name in the headings and subheadings of every portfolio screen', () => {
        expect(as('Alex', <Overview/>)).toContain('<h1>Alex’s exposure map</h1><p>Alex’s holdings and the events linked to them</p>');
        expect(as('Alex', <Overview/>)).toContain('<h2>Alex’s saved briefing</h2>');
        expect(as('Alex', <Moves/>)).toContain('<h1>What moved Alex’s portfolio</h1><p>Alex’s holdings at two closes, beside the Kalshi events of the same window</p>');
        expect(as('Alex', <Calendar/>)).toContain('<p>Explore the events linked to Alex’s holdings by event date and portfolio reach.</p>');
        expect(as('Alex', <Calendar/>)).toContain('Portfolio share always uses Alex’s full portfolio.');
        expect(as('Alex', <Earnings/>)).toContain('<h2>Alex’s upcoming reports</h2>');
        expect(as('Alex', <Forecasts/>)).toContain('<p>Which event results could move Alex’s portfolio—and which stocks could rise or fall.</p>');
        const holdings = renderToStaticMarkup(<AddHoldings user={user('Alex')}/>);
        expect(holdings).toContain('<span class="eyebrow">Kalshi odds · Alex’s holdings</span><h1>See which real-world events Alex’s portfolio depends on.</h1>');
        expect(holdings).toContain('<h2>Alex’s holdings</h2>');
        expect(holdings).toContain('Alex’s portfolio is saved to alex@example.com.');
    });

    it('keeps "your" for a guest, on the same screens', () => {
        expect(renderToStaticMarkup(<Overview/>)).toContain('<h1>Your exposure map</h1><p>Your holdings and the events linked to them</p>');
        expect(renderToStaticMarkup(<Calendar/>)).toContain('<p>Explore the events linked to your holdings by event date and portfolio reach.</p>');
        expect(renderToStaticMarkup(<Earnings/>)).toContain('<h2>Your upcoming reports</h2>');
        expect(renderToStaticMarkup(<Forecasts/>)).toContain('could move your portfolio—');
        const holdings = renderToStaticMarkup(<AddHoldings/>);
        expect(holdings).toContain('<span class="eyebrow">Kalshi odds · Your holdings</span><h1>See which real-world events your portfolio depends on.</h1>');
        expect(holdings).toContain('<h2>Add your holdings</h2>');
        expect(holdings).toContain('Your guest portfolio is stored on the server');
    });

    it('writes a name as text, whatever characters it holds', () => {
        const html = as('A&B <i>x</i>', <Overview/>);
        expect(html).toContain('<h1>A&amp;B &lt;i&gt;x&lt;/i&gt;’s exposure map</h1>');
        expect(html).not.toContain('<i>x</i>');
    });

    it('makes the verb agree where the person is the subject', () => {
        const rating = { accuracy: null, grade: null, label: 'No history', evaluated: 0, matched: 0, eventCount: 0, missing: 0, tied: 0 } as unknown as TrackRatingItem['rating'];
        const held = { symbol: 'SPY', type: 'Direct' as const, evidence: '', valueUsd: 4000, share: .4 };
        const fund: TrackRatingItem = { id: 'SPY', symbol: 'SPY', name: 'SPDR S&P 500', kind: 'fund', rating, linkedHoldings: [held] };
        const benchmark: TrackRatingItem = { id: 'sp500', name: 'S&P 500', kind: 'benchmark', rating, linkedHoldings: [held] };
        expect(as('Alex', <FundPosition item={fund}/>)).toContain('<p class="note rating-position">Alex holds this fund: <strong class="mono">$4,000.00</strong>');
        expect(as('Alex', <FundPosition item={benchmark}/>)).toContain('Tracked by <strong>SPY</strong>, which Alex holds: <strong class="mono">$4,000.00</strong>');
        expect(as('Alex', <FundPosition item={{ ...benchmark, linkedHoldings: [] }}/>)).toBe('<p class="note">Alex holds no fund that tracks this index.</p>');
        expect(as('Alex', <FundPosition item={{ ...fund, linkedHoldings: [] }}/>)).toBe('<p class="note">Not among Alex’s saved holdings.</p>');
        expect(as('Alex', <HoldingDisclosure name="Oil" holdings={[held]}/>)).toContain('<summary>Related to 1 of Alex’s holdings</summary>');
        expect(as('Alex', <TrackRecord/>)).not.toContain('your holdings');
    });

    it('names the person on the category cards and filter', () => {
        const group = (key: string, label: string, symbols: string[], valueUsd: number) => ({ key, label, symbols, valueUsd, share: valueUsd / 50000, events: 0, next: null, lead: [] });
        const categories: Categories = {
            totalValue: 50000,
            holdings: [{ symbol: 'XOM', valueUsd: 30000, assetClass: 'stocks', detail: 'Energy', themes: ['oil'] }, { symbol: 'SAVINGS', valueUsd: 20000, assetClass: 'cash', detail: 'Cash or savings', themes: [] }],
            assetClasses: [group('stocks', 'Stocks', ['XOM'], 30000), group('cash', 'Cash', ['SAVINGS'], 20000)],
            themes: [group('oil', 'Oil', ['XOM'], 30000)],
        };
        const cards = as('Alex', <CategoryCards categories={categories}/>);
        expect(cards).toContain('<h2>Alex’s portfolio by category</h2><p class="note">What Alex owns. Each holding sits in exactly one group, so the groups add up to Alex’s whole portfolio.</p>');
        expect(cards).toContain('<span class="note">Value Alex holds</span><strong class="number">$30,000.00</strong>');
        expect(cards).toContain('<span class="mono">60.0%</span> of Alex’s portfolio · 1 holding</p>');
        expect(as('Alex', <CategoryCards categories={categories} initial="themes"/>)).toContain('The kinds of Kalshi events linked to Alex’s holdings.');
        const guest = renderToStaticMarkup(<CategoryCards categories={categories}/>);
        expect(guest).toContain('<h2>Your portfolio by category</h2><p class="note">What you own. Each holding sits in exactly one group, so the groups add up to your whole portfolio.</p>');
        expect(as('Alex', <CategoryFilter categories={categories}/>)).not.toContain('your');
    });

    it('says whose move and whose position a figure is about', () => {
        const drivers = [{ driver: 'CL=F', contribution: -310 }, { driver: 'SPY', contribution: 120 }];
        expect(describeLeadMove(drivers, money, 'Alex’s')).toBe('Crude oil mattered most: about -$310.00 of Alex’s move, ahead of stock market (s&p 500) at about $120.00.');
        expect(as('Alex', <LeadDrivers drivers={drivers} changes={[]} missing={[]}/>)).toContain('about -$310.00 of Alex’s move');
        // One holding picked: the move is the holding's, signed in or not.
        expect(as('Alex', <LeadDrivers drivers={drivers} changes={[]} missing={[]} subject="XOM"/>)).toContain('about -$310.00 of XOM’s move');
        expect(renderToStaticMarkup(<LeadDrivers drivers={drivers} changes={[]} missing={[]}/>)).toContain('about -$310.00 of your move');
        const data = { typicalMove: { percent: .036, usd: 223.2, reports: 8 }, position: { valueUsd: 6200, share: .1 } } as unknown as EarningsResponse;
        expect(describeTypicalMove(data, money, 'Alex’s')).toBe('±3.6% ≈ ±$223.20 on Alex’s $6,200.00');
        expect(describeTypicalMove(data, money)).toBe('±3.6% ≈ ±$223.20 on your $6,200.00');
    });
});
