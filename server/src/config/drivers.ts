// The measurable drivers. Each is one price or yield series plus the fixed topic tags whose
// markets it stands behind. The price loader, the nightly regression and matching all read this
// list, so adding a driver here is the only code change a new one needs.
export interface Driver {
    /** Key in the prices table: a Yahoo symbol or a FRED series id. */
    key: string;
    source: 'yahoo' | 'fred';
    /** How one period's change is taken: a return for prices, a difference in percentage points for yields. */
    change: 'return' | 'difference';
    /** Weekly series are regressed on weekly changes and are not ranked against daily drivers. */
    period: 'day' | 'week';
    /** Series in one family move together, so a holding's sensitivities to them describe the same thing. */
    family: 'market' | 'oil' | 'rates';
    tags: string[];
}
// Every non-market driver is measured with the stock market held fixed.
export const CONTROL = 'SPY';
export const DRIVERS: Driver[] = [
    { key: 'SPY', source: 'yahoo', change: 'return', period: 'day', family: 'market', tags: ['sp500'] },
    { key: 'CL=F', source: 'yahoo', change: 'return', period: 'day', family: 'oil', tags: ['oil'] },
    { key: 'DGS2', source: 'fred', change: 'difference', period: 'day', family: 'rates', tags: ['fed-rates', 'inflation'] },
    { key: 'DGS10', source: 'fred', change: 'difference', period: 'day', family: 'rates', tags: ['treasury-yields'] },
    { key: 'MORTGAGE30US', source: 'fred', change: 'difference', period: 'week', family: 'rates', tags: ['mortgage-rates'] },
];
export const driverFor = (key: string) => DRIVERS.find(driver => driver.key === key);
// A typical effect under one basis point per period is numerical noise, not a relationship:
// the range can exclude zero only because the fit is almost exact (an index fund against SPY).
export const MIN_TYPICAL_EFFECT = 0.0001;
