import type { AssetClass, Categories, CategoryGroup, ExposureEvent, Holding, HoldingLink } from '../../../shared/types.ts';
import { seedFile } from '../seed.ts';
import { ASSET_TAGS, assetType, isSecurity } from './asset-links.ts';
import { drivers, materialRows, rankDrivers } from './matching.ts';
import type { MeasuredRow } from './matching.ts';
import type { SecurityProfile } from '../jobs/profiles.ts';

// Two ways to group a portfolio. An asset class says what a holding is, and each holding has
// exactly one. A theme says what kind of event is linked to it, and a holding can have several.
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
    stocks: 'Stocks', bonds: 'Bonds', cash: 'Cash', property: 'Property', commodities: 'Commodities', crypto: 'Crypto', mixed: 'Mixed funds', unclassified: 'Unclassified',
};
// Markets about the holding itself (a company's earnings call, a fund's own price) are one
// theme, whichever holding it is.
export const DIRECT_THEME = 'direct';
const THEME_LABELS: Record<string, string> = {
    [DIRECT_THEME]: 'Direct markets', sp500: 'Stock market', oil: 'Oil', 'fed-rates': 'Fed rates', inflation: 'Inflation',
    'treasury-yields': 'Treasury yields', 'mortgage-rates': 'Mortgage rates', 'credit-defaults': 'Credit',
};
export const themeLabel = (key: string) => THEME_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replaceAll('-', ' ');

export type FundClasses = Record<string, AssetClass>;
let loaded: Promise<FundClasses> | undefined;
// Yahoo fund category -> asset class, written by a human in server/seed/fund_classes.json.
export const fundClasses = () => loaded ??= seedFile<FundClasses>('fund_classes');

// A key ending in * matches every category that starts with it ("Target-Date *").
export function fundClass(category: string | null, classes: FundClasses): AssetClass | null {
    if (!category)
        return null;
    const prefix = Object.keys(classes).find(name => name.endsWith('*') && category.startsWith(name.slice(0, -1)));
    return Object.hasOwn(classes, category) ? classes[category] : prefix ? classes[prefix] : null;
}

// A holding's asset class and what it rests on. A holding the user described is classed by that
// description. A ticker is classed from Yahoo's profile of it; nothing is inferred from its name,
// so a ticker without a profile, or a fund whose category is not mapped, is Unclassified.
export function classify(holding: Holding, profile: SecurityProfile | undefined, classes: FundClasses): { assetClass: AssetClass; detail: string | null } {
    const type = assetType(holding);
    if (type === 'cash')
        return { assetClass: 'cash', detail: 'Cash or savings' };
    if (type === 'treasury' || type === 'bond')
        return { assetClass: 'bonds', detail: type === 'bond' ? 'Bond' : 'Treasury or CD' };
    if (type === 'property')
        return { assetClass: 'property', detail: holding.details?.state ?? null };
    switch (profile?.quote_type) {
        case 'EQUITY': return { assetClass: 'stocks', detail: profile.sector };
        case 'MONEYMARKET': return { assetClass: 'cash', detail: 'Money market fund' };
        case 'CRYPTOCURRENCY': return { assetClass: 'crypto', detail: 'Cryptocurrency' };
        case 'ETF': case 'MUTUALFUND':
            return { assetClass: fundClass(profile.fund_category, classes) ?? 'unclassified', detail: profile.fund_category ? `${profile.fund_category} fund` : 'Fund' };
        default: return { assetClass: 'unclassified', detail: null };
    }
}

// The themes a link holds through: the event's topics that the holding shares and that put a
// number behind the link. An unmeasured topic link has none, as on the Overview.
export function linkThemes(link: HoldingLink, eventTags: string[], stockTags: string[], measurements: MeasuredRow[]): string[] {
    if (link.type === 'Direct')
        return [DIRECT_THEME];
    const type = assetType(link);
    if (link.type === 'Calculated')
        return type === 'security' ? [] : eventTags.filter(tag => ASSET_TAGS[type].includes(tag));
    if (link.type === 'Measured') {
        // Every shared topic whose driver is big enough for this holding to draw a link from.
        const material = materialRows(link.symbol, measurements);
        return eventTags.filter(tag => stockTags.includes(tag) && material.some(m => m.driver === drivers[tag]));
    }
    return [];
}

export const noCategories: Categories = { totalValue: 0, holdings: [], assetClasses: [], themes: [] };

export function categorize(holdings: Holding[], events: ExposureEvent[], profiles: SecurityProfile[], measurements: MeasuredRow[], classes: FundClasses, now = Date.now()): Categories {
    const value = (list: Holding[]) => list.reduce((sum, holding) => sum + Math.round(holding.valueUsd * 100), 0) / 100;
    const totalValue = value(holdings);
    const classified = holdings.map(holding => ({ holding, ...classify(holding, profiles.find(profile => profile.symbol === holding.symbol), classes),
        themes: [...new Set(events.flatMap(event => event.links.filter(link => link.symbol === holding.symbol).flatMap(link => link.themes ?? [])))] }));
    // A link that matters: about the holding itself, exact arithmetic on its terms, or measured
    // against the holding's most important driver.
    const strong = (link: HoldingLink) => link.type === 'Direct' || link.type === 'Calculated'
        || (link.type === 'Measured' && link.sensitivity !== null && link.lead?.driver === link.sensitivity.driver);
    // `counts` picks out the group's own links. The next event is the soonest one reached by a
    // strong link, so a bond fund's faint tie to diesel prices is not put forward as its next
    // date; only when no such event is open is it the soonest linked event of any strength.
    const group = (key: string, label: string, members: Holding[], counts: (link: HoldingLink) => boolean, lead: string[] = []): CategoryGroup => {
        const linked = events.filter(event => event.links.some(counts));
        const soonest = (list: ExposureEvent[]) => list.filter(event => Date.parse(event.eventTime) >= now).sort((a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime) || a.ticker.localeCompare(b.ticker))[0];
        const next = soonest(linked.filter(event => event.links.some(link => counts(link) && strong(link)))) ?? soonest(linked);
        const symbols = [...members].sort((a, b) => b.valueUsd - a.valueUsd || a.symbol.localeCompare(b.symbol)).map(holding => holding.symbol);
        return { key, label, symbols, valueUsd: value(members), share: totalValue ? value(members) / totalValue : 0, events: linked.length,
            next: next ? { ticker: next.ticker, title: next.title, eventTime: next.eventTime, eventTimeSource: next.eventTimeSource } : null, lead: symbols.filter(symbol => lead.includes(symbol)) };
    };
    const largestFirst = (a: CategoryGroup, b: CategoryGroup) => b.valueUsd - a.valueUsd || a.label.localeCompare(b.label);
    const assetClasses = (Object.keys(ASSET_CLASS_LABELS) as AssetClass[]).flatMap(key => {
        const members = classified.filter(row => row.assetClass === key).map(row => row.holding), symbols = new Set(members.map(holding => holding.symbol));
        // An event counts for the class when it is linked to one of its holdings by more than a shared topic.
        return members.length ? [group(key, ASSET_CLASS_LABELS[key], members, link => link.type !== 'Related' && symbols.has(link.symbol))] : [];
    }).sort(largestFirst);
    const themes = [...new Set(classified.flatMap(row => row.themes))].map(key => {
        const members = classified.filter(row => row.themes.includes(key)).map(row => row.holding);
        // The holdings this theme matters most to. A holding without a ticker is in a theme only by
        // a Calculated link, which is exact; a security counts when the theme's driver is its most
        // important measured one.
        const lead = members.filter(holding => !isSecurity(holding) || (drivers[key] !== undefined && rankDrivers(holding.symbol, measurements)[0]?.driver === drivers[key])).map(holding => holding.symbol);
        return group(key, themeLabel(key), members, link => (link.themes ?? []).includes(key), lead);
    }).sort(largestFirst);
    return { totalValue, assetClasses, themes,
        holdings: classified.map(row => ({ symbol: row.holding.symbol, valueUsd: row.holding.valueUsd, assetClass: row.assetClass, detail: row.detail, themes: row.themes })) };
}
