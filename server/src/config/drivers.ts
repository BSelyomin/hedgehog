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
    /** Verified markets measuring this exact level. Topic tags alone never establish this. */
    levelSeries?: string[];
    /** Index returns can be used as an explicitly labelled proxy for measured SPY beta. */
    levelReference?: { symbol: string; label: string; url: string; unit: 'points'; proxy: boolean };
}
// Every non-market driver is measured with the stock market held fixed.
export const CONTROL = 'SPY';
export const DRIVERS: Driver[] = [
    { key: 'SPY', source: 'yahoo', change: 'return', period: 'day', family: 'market', tags: ['sp500'],
        // Verified S&P 500 level markets; each close keeps its own scenario within one group.
        // https://kalshi.com/markets/kxinx/sp-500-range/kxinx-26sep29h1600
        levelSeries: ['KXINX', 'KXINXU', 'KXINXDUD'],
        levelReference: { symbol: '^GSPC', label: 'S&P 500 index', url: 'https://finance.yahoo.com/quote/%5EGSPC/history/', unit: 'points', proxy: true } },
    { key: 'CL=F', source: 'yahoo', change: 'return', period: 'day', family: 'oil', tags: ['oil'] },
    // Kalshi's KXUST2AD/KXUST10AD rules specify the corresponding US Treasury par yield.
    // FRED DGS2/DGS10 publish Treasury constant-maturity yields in percent. Do not substitute
    // policy rates, yield maxima/minima, spreads, PYTH intraday yields or crude futures here.
    // Rules: https://kalshi.com/markets/kxust2ad/ust-2-year-daily/kxust2ad-26sep30
    // https://kalshi.com/markets/kxust10ad/ust-10-year-daily/kxust10ad-26oct06
    { key: 'DGS2', source: 'fred', change: 'difference', period: 'day', family: 'rates', tags: ['fed-rates', 'inflation'], levelSeries: ['KXUST2AD'] },
    { key: 'DGS10', source: 'fred', change: 'difference', period: 'day', family: 'rates', tags: ['treasury-yields'], levelSeries: ['KXUST10AD'] },
    { key: 'MORTGAGE30US', source: 'fred', change: 'difference', period: 'week', family: 'rates', tags: ['mortgage-rates'] },
];
export const driverFor = (key: string) => DRIVERS.find(driver => driver.key === key);
// A typical effect under one basis point per period is numerical noise, not a relationship:
// the range can exclude zero only because the fit is almost exact (an index fund against SPY).
export const MIN_TYPICAL_EFFECT = 0.0001;
