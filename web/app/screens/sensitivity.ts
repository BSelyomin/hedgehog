import type { DriverMove, DriverRank, HoldingLink, Sensitivity } from '../../../shared/types';

// How each measured driver reads in a sentence, and the size of driver move the sentence uses.
// b is the holding's return per unit of driver change: per 1.00 return for oil and SPY, and per
// one percentage point for yields and rates (see server/src/config/drivers.ts).
const drivers: Record<string, { name: string; step: number; stepText: string; control: boolean; weekly?: boolean }> = {
    'CL=F': { name: 'crude oil futures', step: 0.01, stepText: '1%', control: true },
    'DGS2': { name: 'the 2-year Treasury yield', step: 0.1, stepText: '0.10 percentage points', control: true },
    'DGS10': { name: 'the 10-year Treasury yield', step: 0.1, stepText: '0.10 percentage points', control: true },
    'MORTGAGE30US': { name: 'the 30-year mortgage rate', step: 0.1, stepText: '0.10 percentage points', control: true, weekly: true },
    'SPY': { name: 'the S&P 500 (SPY)', step: 0.01, stepText: '1%', control: false },
};

// Short names for tables and comparisons. An unknown driver shows its series key.
const short: Record<string, string> = { 'CL=F': 'Crude oil', 'DGS2': '2-year Treasury yield', 'DGS10': '10-year Treasury yield', 'MORTGAGE30US': '30-year mortgage rate', 'SPY': 'Stock market (S&P 500)' };
export const driverName = (key: string) => short[key] ?? key;

const share = (value: number) => `${(value * 100).toFixed(2)}%`;

// Restates the measured coefficient and its 95% range in everyday terms. Nothing here is a new
// estimate: every figure is b, low or high multiplied by the step above. Unknown drivers get no sentence.
export function describeSensitivity(symbol: string, sensitivity: Sensitivity): string | null {
    const driver = drivers[sensitivity.driver];
    if (!driver)
        return null;
    const values = [sensitivity.b, sensitivity.low, sensitivity.high].map(value => value * driver.step * 100);
    if (!values.every(Number.isFinite) || !Number.isInteger(sensitivity.days))
        return null;
    const [move, low, high] = values;
    const digits = Math.abs(move) < 0.1 ? 3 : 2;
    const signed = (value: number) => `${value < 0 ? '−' : '+'}${Math.abs(value).toFixed(digits)}%`;
    return `${driver.weekly ? 'In weeks' : 'On days'} ${driver.name} rose ${driver.stepText}, ${symbol} ${move < 0 ? 'fell' : 'rose'} ${Math.abs(move).toFixed(digits)}% on average`
        + `${driver.control ? ', after accounting for the overall market' : ''}. `
        + `The 95% range is ${signed(low)} to ${signed(high)}, measured over ${sensitivity.days.toLocaleString('en-US')} ${driver.weekly ? 'weeks' : 'trading days'}.`;
}

// Says which driver matters most for the holding, so a minor link is never read as the main story.
// lead is true when this link's own driver is the holding's most important one.
export function describeImportance(link: HoldingLink): { lead: boolean; text: string } | null {
    const own = link.sensitivity, top = link.lead;
    if (!own || !top || !Number.isFinite(top.typicalEffect))
        return null;
    if (top.driver === own.driver)
        return { lead: true, text: `Most important measured driver for ${link.symbol}: a typical day’s move in it moves ${link.symbol} about ${share(top.typicalEffect)}.` };
    // A weekly driver is measured on a different period, so it is not put on the same scale.
    const comparison = own.typicalEffect !== null && Number.isFinite(own.typicalEffect) && !drivers[own.driver]?.weekly
        ? `, against ${share(own.typicalEffect)} for ${driverName(own.driver).toLowerCase()}` : '';
    return { lead: false, text: `${driverName(top.driver)} matters more for ${link.symbol}: a typical day’s move in it moves ${link.symbol} about ${share(top.typicalEffect)}${comparison}.` };
}

// Restates a Calculated link for a quarter-point move, the usual size of a rate change. The figure
// is the server's per-point amount times 0.25; nothing is estimated here.
export function describeCalculation(link: HoldingLink, money: (value: number) => string): string | null {
    const calculation = link.calculation;
    if (!calculation || !Number.isFinite(calculation.perPointUsd))
        return null;
    const quarter = money(Math.abs(calculation.perPointUsd) * 0.25);
    if (calculation.kind === 'income')
        return `Each 0.25 percentage point change in the rate it earns changes the yearly interest on ${link.symbol} by ${quarter}.`;
    if (calculation.kind === 'payment')
        return `Each 0.25 percentage point change in the mortgage rate changes the yearly interest on ${link.symbol}’s adjustable mortgage by ${quarter}.`;
    return `A 0.25 percentage point rise in its yield lowers the market value of ${link.symbol} by about ${quarter}`
        + `${typeof calculation.duration === 'number' ? ` (modified duration ${calculation.duration.toFixed(2)} years)` : ''}. Held to maturity it still repays its face value.`;
}

// One line for a holding's ranked drivers: the most important first, with the size of each.
export function describeDrivers(ranks: DriverRank[]): string | null {
    if (!ranks.length)
        return null;
    const [top, ...rest] = ranks;
    return `Moves most with ${driverName(top.driver).toLowerCase()} (about ${share(top.typicalEffect)} on a typical day)`
        + (rest.length ? `; then ${rest.map(rank => `${driverName(rank.driver).toLowerCase()} ${share(rank.typicalEffect)}`).join(', ')}` : '') + '.';
}

// The day's biggest driver for the portfolio, with the runner-up for scale.
export function describeLeadMove(moves: DriverMove[], money: (value: number) => string): string | null {
    if (!moves.length)
        return null;
    const [top, next] = moves;
    return `${driverName(top.driver)} mattered most: about ${money(top.contribution)} of your move${next ? `, ahead of ${driverName(next.driver).toLowerCase()} at about ${money(next.contribution)}` : ''}.`;
}
