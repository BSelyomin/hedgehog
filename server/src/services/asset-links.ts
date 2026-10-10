import type { AssetType, Calculation, Holding, HoldingLink } from '../../../shared/types.ts';
import { modifiedDuration, yearsUntil } from '../math/fixed-income.ts';

// Holdings without a ticker link to markets through their asset type, not through price history.
// Where the holding's own terms give an exact figure the link is Calculated; otherwise it is an
// unmeasured topic link (API type Related) with no number.
type Asset = Exclude<AssetType, 'security'>;
// Topics a property only shares with a market that names its state, or the whole country.
const LOCAL = ['housing', 'housing-starts', 'rents', 'hurricanes', 'floods', 'wildfires', 'commercial-real-estate'];
export const ASSET_TAGS: Record<Asset, string[]> = {
    cash: ['fed-rates'],
    treasury: ['treasury-yields', 'fed-rates', 'inflation'],
    bond: ['treasury-yields', 'fed-rates', 'inflation', 'credit-defaults'],
    property: ['mortgage-rates', 'home-sales', ...LOCAL],
};
export const assetType = (holding: Holding): AssetType => holding.assetType ?? 'security';
export const isSecurity = (holding: Holding) => assetType(holding) === 'security';

const money = (value: number) => `$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const names = (title: string, place: string) => new RegExp(`\\b${place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(title);
// "US" is matched with its capitals so the word "us" does not count.
const national = (title: string) => /\bUS\b|\bU\.S\.|United States/.test(title) || /\bnational\b/i.test(title);

export interface AssetContext {
    now: number;
    /** Latest 2-year and 10-year Treasury yields in percent, used to discount a bond's payments. */
    shortYield: number | null;
    longYield: number | null;
}

export function assetLink(holding: Holding, eventTags: string[], eventTitle: string, context: AssetContext): HoldingLink | null {
    const type = assetType(holding);
    if (type === 'security')
        return null;
    const shared = eventTags.filter(tag => ASSET_TAGS[type].includes(tag));
    if (!shared.length)
        return null;
    const calculated = (calculation: Calculation, evidence: string): HoldingLink => ({ ...holding, type: 'Calculated', evidence, sensitivity: null, calculation });
    const topic = (evidence: string): HoldingLink => ({ ...holding, type: 'Related', evidence: `${evidence} No figure is calculated for this link.`, sensitivity: null });

    // A market tagged for mortgage rates is about what borrowers pay; of these holdings only property shares it.
    if (type !== 'property' && eventTags.includes('mortgage-rates'))
        return null;
    // Interest on cash follows short policy rates, not longer Treasury yields.
    if (type === 'cash' && eventTags.includes('treasury-yields'))
        return null;
    if (type === 'cash')
        return calculated({ kind: 'income', perPointUsd: holding.valueUsd * 0.01, rate: 'the rate it earns' },
            `Calculated from the amount entered: a one percentage point change in the rate it earns changes yearly interest by ${money(holding.valueUsd * 0.01)}. How closely that rate follows the Fed's policy rate depends on the account.`);

    if (type === 'treasury' || type === 'bond') {
        const { maturity, couponRate } = holding.details ?? {};
        const years = maturity ? yearsUntil(maturity, context.now) : NaN;
        if (shared.includes('treasury-yields') && typeof couponRate === 'number' && years > 0) {
            // Discount at the Treasury yield nearest its remaining life; fall back to its own coupon.
            const marketYield = (years <= 5 ? context.shortYield : context.longYield) ?? couponRate;
            const duration = modifiedDuration(couponRate, years, marketYield);
            const perPoint = -duration * 0.01 * holding.valueUsd;
            return calculated({ kind: 'price', perPointUsd: perPoint, rate: 'its own yield', duration },
                `Calculated from its terms (${couponRate}% coupon, matures ${maturity}) at a ${marketYield.toFixed(2)}% yield: modified duration ${duration.toFixed(2)} years, so a one percentage point rise in its yield lowers its market value by about ${money(perPoint)}. Held to maturity it still repays its face value.`);
        }
        return topic(`${type === 'bond' ? 'Bonds' : 'Treasuries'} share the reviewed ${shared.join(', ')} topic with this market.`);
    }

    // Property.
    const { state, adjustableMortgage, rental } = holding.details ?? {};
    if (shared.includes('mortgage-rates')) {
        if (typeof adjustableMortgage === 'number' && adjustableMortgage > 0)
            return calculated({ kind: 'payment', perPointUsd: adjustableMortgage * 0.01, rate: 'the mortgage rate' },
                `Calculated from the adjustable mortgage balance entered: a one percentage point change in its rate changes yearly interest by ${money(adjustableMortgage * 0.01)}. Your loan's reset dates and caps decide when that applies.`);
        return topic('Mortgage rates affect what buyers can pay for property; no adjustable mortgage was entered for this one.');
    }
    if (shared.includes('home-sales') && national(eventTitle))
        return topic('National home sales and prices are a reviewed housing topic.');
    const local = shared.filter(tag => LOCAL.includes(tag) && (tag !== 'rents' || rental === true));
    if (local.length && state && names(eventTitle, state))
        return topic(`This market names ${state}, where the property is, and shares the reviewed ${local.join(', ')} topic.`);
    if (local.some(tag => tag === 'housing' || tag === 'rents') && national(eventTitle))
        return topic(`A national market on the reviewed ${local.filter(tag => tag === 'housing' || tag === 'rents').join(', ')} topic.`);
    return null;
}
