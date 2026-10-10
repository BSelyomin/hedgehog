import { useSyncExternalStore } from 'react';
import type { Categories, ExposureEvent, HoldingLink, HoldingMove } from '../../../shared/types';

// The category filter is one choice for every screen: what you own, and what could move it.
export interface CategorySelection {
    assetClass: string;
    theme: string;
}
export const noSelection: CategorySelection = { assetClass: '', theme: '' };

// Kept for the browser tab, so the choice follows you from the Overview to the Calendar and Moves.
const KEY = 'hedgehog-categories';
const listeners = new Set<() => void>();
let current = noSelection, restored = false;
function read(): CategorySelection {
    if (!restored && typeof window !== 'undefined') {
        restored = true;
        try {
            const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null');
            if (typeof saved?.assetClass === 'string' && typeof saved?.theme === 'string')
                current = { assetClass: saved.assetClass, theme: saved.theme };
        } catch { /* storage unavailable: the choice lasts until the page is reloaded */ }
    }
    return current;
}
export function setCategorySelection(next: CategorySelection) {
    current = next;
    restored = true;
    try { window.sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* as above */ }
    listeners.forEach(listener => listener());
}
export function useCategorySelection(): CategorySelection {
    return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, read, () => current);
}

// A choice naming a group this portfolio does not have is ignored, so one left over from an
// earlier portfolio never empties a screen.
export function activeSelection(categories: Categories, selection: CategorySelection): CategorySelection {
    return { assetClass: categories.assetClasses.some(group => group.key === selection.assetClass) ? selection.assetClass : '',
        theme: categories.themes.some(group => group.key === selection.theme) ? selection.theme : '' };
}

// The holdings a choice names: in the asset class and linked through the theme. Null means all.
export function selectedSymbols(categories: Categories, selection: CategorySelection): Set<string> | null {
    const { assetClass, theme } = activeSelection(categories, selection);
    if (!assetClass && !theme)
        return null;
    return new Set(categories.holdings.filter(holding => (!assetClass || holding.assetClass === assetClass) && (!theme || holding.themes.includes(theme))).map(holding => holding.symbol));
}

// Value of the chosen holdings and their share of the whole portfolio. Each holding counts once.
export function selectionSummary(categories: Categories, selection: CategorySelection) {
    const symbols = selectedSymbols(categories, selection);
    const chosen = categories.holdings.filter(holding => !symbols || symbols.has(holding.symbol));
    const cents = chosen.reduce((sum, holding) => sum + Math.round(holding.valueUsd * 100), 0);
    return { holdings: chosen.length, valueUsd: cents / 100, share: categories.totalValue ? cents / 100 / categories.totalValue : 0 };
}

// A link belongs to the choice when its holding is chosen and, with a theme chosen, the link
// itself holds through that theme.
export const linkSelected = (link: HoldingLink, symbols: Set<string> | null, theme: string) =>
    (!symbols || symbols.has(link.symbol)) && (!theme || (link.themes ?? []).includes(theme));

// `topicLinks` says whether an unmeasured topic link is enough; the Overview does not show those.
export function selectEvents(events: ExposureEvent[], categories: Categories, selection: CategorySelection, topicLinks = true): ExposureEvent[] {
    const symbols = selectedSymbols(categories, selection), { theme } = activeSelection(categories, selection);
    return symbols ? events.filter(event => event.links.some(link => (topicLinks || link.type !== 'Related') && linkSelected(link, symbols, theme))) : events;
}

// The chosen holdings' part of a day's move: sums of the rows shown, in whole cents. A figure is
// left out when any chosen security lacks it, as the portfolio totals are.
export function selectionMove(rows: HoldingMove[]) {
    const priced = rows.filter(row => !row.assetType || row.assetType === 'security');
    const sum = (field: 'actual' | 'fromMarket' | 'beyondMarket') => priced.length && priced.every(row => row[field] !== null)
        ? priced.reduce((total, row) => total + Math.round(row[field]! * 100), 0) / 100 : null;
    return { securities: priced.length, actual: sum('actual'), fromMarket: sum('fromMarket'), beyondMarket: sum('beyondMarket') };
}
