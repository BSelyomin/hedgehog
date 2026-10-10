'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Categories, CategoryGroup } from '../../../shared/types';
import { money, percent, dateText, dayOnly, href, Card } from '../common';
import { activeSelection, noSelection, selectionSummary, setCategorySelection, useCategorySelection } from './category-filter';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The filter every screen shares. Choosing here changes the Overview, the Calendar and Moves.
export function CategoryFilter({ categories }: { categories: Categories }) {
    const selection = activeSelection(categories, useCategorySelection());
    if (!categories.holdings.length)
        return null;
    const summary = selectionSummary(categories, selection), active = Boolean(selection.assetClass || selection.theme);
    return <div className="category-filter">
        <label>Asset class<select aria-label="Asset class" value={selection.assetClass} onChange={event => setCategorySelection({ ...selection, assetClass: event.target.value })}>
            <option value="">All asset classes</option>{categories.assetClasses.map(group => <option key={group.key} value={group.key}>{group.label} ({group.symbols.length})</option>)}
        </select></label>
        <label>Event theme<select aria-label="Event theme" value={selection.theme} onChange={event => setCategorySelection({ ...selection, theme: event.target.value })}>
            <option value="">All event themes</option>{categories.themes.map(group => <option key={group.key} value={group.key}>{group.label} ({group.symbols.length})</option>)}
        </select></label>
        <p className="note" role="status">{active
            ? <>{summary.holdings} of {plural(categories.holdings.length, 'holding')} · <span className="mono">{money(summary.valueUsd)}</span> · <span className="mono">{percent(summary.share)}</span> of your portfolio</>
            : <>All {plural(categories.holdings.length, 'holding')} · <span className="mono">{money(categories.totalValue)}</span></>}</p>
        {active && <button className="reset-filters" onClick={() => setCategorySelection(noSelection)}>Clear category</button>}
    </div>;
}

// The two ways the cards group a portfolio, with what each one's figures mean.
const VIEWS = [
    { key: 'assetClasses', field: 'assetClass', label: 'By asset class', figure: 'Value you hold',
        help: 'What you own. Each holding sits in exactly one group, so the groups add up to your whole portfolio.' },
    { key: 'themes', field: 'theme', label: 'By event theme', figure: 'Value of the holdings linked to it',
        help: 'The kinds of Kalshi events linked to your holdings. Each card is one kind of event and lists the holdings linked to it. The dollar figure is what those holdings are worth, not an amount at risk or an expected move. A holding appears under every kind of event it is linked to, so the cards overlap and do not add up to 100%. Filled tickers are the ones that kind of event matters most to.' },
] as const;

// What each theme's events are about.
const THEME_ABOUT: Record<string, string> = {
    direct: 'Kalshi markets about the holding itself, such as a company’s earnings call or a fund’s own price.',
    sp500: 'Events about the S&P 500 and the stock market as a whole.',
    oil: 'Events about oil and fuel prices.',
    'fed-rates': 'Events about the Fed’s rate decisions and short-term interest rates.',
    inflation: 'Events about inflation reports such as the CPI.',
    'treasury-yields': 'Events about Treasury yields.',
    'mortgage-rates': 'Events about mortgage rates.',
    'credit-defaults': 'Events about defaults and credit conditions.',
};

export function CategoryCards({ categories, initial = 'assetClasses' }: { categories: Categories; initial?: typeof VIEWS[number]['key'] }) {
    const [viewKey, setViewKey] = useState(initial);
    const selection = activeSelection(categories, useCategorySelection());
    const view = VIEWS.find(option => option.key === viewKey)!, groups = categories[view.key];
    if (!categories.holdings.length)
        return null;
    return <Card className="category-overview">
        <div className="row"><div><h2>Your portfolio by category</h2><p className="note">{view.help}</p></div>
            <div className="toggle" role="group" aria-label="Group holdings by">{VIEWS.map(option => <button key={option.key} aria-pressed={option.key === viewKey} className={option.key === viewKey ? 'active' : ''} onClick={() => setViewKey(option.key)}>{option.label}</button>)}</div>
        </div>
        {groups.length ? <CardRow key={view.key} label={`${plural(groups.length, 'group')}, ${view.label.toLowerCase()}`}>{groups.map(group => {
            const chosen = selection[view.field] === group.key;
            return <CategoryCard key={group.key} group={group} categories={categories} chosen={chosen} theme={view.key === 'themes'} figure={view.figure} onToggle={() => setCategorySelection({ ...selection, [view.field]: chosen ? '' : group.key })}/>;
        })}</CardRow> : <p className="note">No open Kalshi event is linked to your holdings by more than a shared topic yet.</p>}
    </Card>;
}

// One row of cards that scrolls sideways. The arrows appear only when cards are off to a side,
// so a row that continues is never mistaken for a complete one.
function CardRow({ label, children }: { label: string; children: ReactNode }) {
    const row = useRef<HTMLDivElement>(null);
    const [more, setMore] = useState({ left: false, right: false });
    function measure() {
        const element = row.current;
        if (element)
            setMore({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 });
    }
    useEffect(() => {
        measure();
        const observer = new ResizeObserver(measure);
        if (row.current)
            observer.observe(row.current);
        return () => observer.disconnect();
    }, []);
    const move = (direction: number) => row.current?.scrollBy({ left: direction * row.current.clientWidth * .8 });
    return <>
        <div className="category-row-head">
            <span className="note">{label}{(more.left || more.right) && ' · scroll sideways for more'}</span>
            {(more.left || more.right) && <span className="category-arrows">
                <button aria-label="Show earlier groups" disabled={!more.left} onClick={() => move(-1)}>‹</button>
                <button aria-label="Show more groups" disabled={!more.right} onClick={() => move(1)}>›</button>
            </span>}
        </div>
        <div className="category-cards" ref={row} tabIndex={0} role="group" aria-label={label} onScroll={measure}>{children}</div>
    </>;
}

function CategoryCard({ group, categories, chosen, theme, figure, onToggle }: { group: CategoryGroup; categories: Categories; chosen: boolean; theme: boolean; figure: string; onToggle: () => void }) {
    // The holdings the theme matters most to come first and are filled in.
    const shown = [...group.symbols.filter(symbol => group.lead.includes(symbol)), ...group.symbols.filter(symbol => !group.lead.includes(symbol))].slice(0, 8);
    const detail = (symbol: string) => categories.holdings.find(holding => holding.symbol === symbol)?.detail ?? undefined;
    // What an asset class rests on: sectors and fund categories from Yahoo, or the type you entered.
    const details = [...new Set(group.symbols.flatMap(symbol => detail(symbol) ?? []))];
    return <article className={`category-card${chosen ? ' active' : ''}`}>
        <h3>{group.label}</h3>
        {theme && THEME_ABOUT[group.key] && <p className="note">{THEME_ABOUT[group.key]}</p>}
        <p className="category-figure"><span className="note">{figure}</span><strong className="number">{money(group.valueUsd)}</strong></p>
        <p className="note"><span className="mono">{percent(group.share)}</span> of your portfolio · {plural(group.symbols.length, 'holding')}</p>
        <p className="category-symbols">{shown.map(symbol => <span key={symbol} className={group.lead.includes(symbol) ? 'chip lead' : 'chip plain'} title={detail(symbol)}>{symbol}</span>)}{group.symbols.length > shown.length && <span className="note">+{group.symbols.length - shown.length} more</span>}</p>
        {!theme && details.length > 0 && <p className="note">{details.slice(0, 6).join(' · ')}{details.length > 6 && ` · +${details.length - 6} more`}</p>}
        {group.key === 'unclassified' && <p className="note">Yahoo has no profile for these tickers, or their fund category is not one Hedgehog has mapped.</p>}
        {group.lead.length > 0 && <p className="note driver-top">Matters most to <strong>{group.lead.join(', ')}</strong>: calculated from its own terms, or its biggest measured driver.</p>}
        <p className="note">{group.events ? `${plural(group.events, 'open event')} linked` : 'No open events linked'}{group.next && <> · next <a href={href('event', group.next.ticker)}>{group.next.title}</a>, <time dateTime={group.next.eventTime}>{group.next.eventTimeSource === 'stated' ? dayOnly(group.next.eventTime) : dateText(group.next.eventTime)}</time></>}</p>
        <button aria-pressed={chosen} onClick={onToggle}>{chosen ? 'Showing only these · clear' : 'Show only these'}</button>
    </article>;
}
