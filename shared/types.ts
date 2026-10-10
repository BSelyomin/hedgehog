export type LinkType = 'Direct' | 'Calculated' | 'Measured' | 'Related';
/** A listed security has a ticker and a price history. The others are described by their own terms. */
export type AssetType = 'security' | 'cash' | 'treasury' | 'bond' | 'property';
/** Terms entered for a holding without a ticker. Which fields apply depends on the asset type. */
export interface HoldingDetails {
    /** Treasury or bond: maturity date (YYYY-MM-DD) and yearly coupon rate in percent. */
    maturity?: string;
    couponRate?: number;
    /** Property: the US state it is in, used to find markets that name it. */
    state?: string;
    /** Property: outstanding adjustable-rate mortgage balance in dollars. */
    adjustableMortgage?: number;
    /** Property: let to tenants, so rent markets apply. */
    rental?: boolean;
}
/** A figure worked out exactly from a holding's own terms, not measured from price history. */
export interface Calculation {
    /** What changes: yearly interest earned, market price, or yearly mortgage interest paid. */
    kind: 'income' | 'price' | 'payment';
    /** Dollar change for a one percentage point rise in the rate named by `rate`. */
    perPointUsd: number;
    rate: string;
    /** Modified duration in years, for a price calculation. */
    duration?: number;
}
export interface Freshness {
    asOf: string | null;
}
export interface AccountUser {
    id: string;
    email: string;
    name: string;
    createdAt: string;
}
export interface SessionResponse extends Freshness {
    user: AccountUser | null;
    /** Non-secret identifier used to reject writes from an outdated browser tab. */
    sessionKey: string;
    expiresAt: string | null;
}
export interface SignUpRequest {
    name: string;
    email: string;
    password: string;
    saveGuestHoldings: boolean;
}
export interface SignInRequest {
    email: string;
    password: string;
}
export interface ChangePasswordRequest {
    currentPassword: string;
    newPassword: string;
}
export interface Holding {
    /** A ticker for a listed security; otherwise a short name chosen by the user. */
    symbol: string;
    valueUsd: number;
    /** Absent means a listed security. */
    assetType?: AssetType;
    details?: HoldingDetails;
}
export interface HoldingsResponse extends Freshness {
    holdings: Holding[];
}
export interface HoldingsRequest {
    holdings: Holding[];
}
export interface Sensitivity {
    b: number;
    low: number;
    high: number;
    days: number;
    driver: string;
    computedAt: string;
    /** How far the holding typically moves with this driver in one period: |b| times the driver's typical change. */
    typicalEffect: number | null;
}
/** One of a holding's measured drivers with its typical daily effect, so drivers can be compared. */
export interface DriverRank {
    driver: string;
    typicalEffect: number;
}
/** One driver's estimated part of a holding's or the portfolio's move on a day, in dollars. */
export interface DriverMove {
    driver: string;
    contribution: number;
}
export interface HoldingLink extends Holding {
    type: LinkType;
    evidence: string;
    sensitivity: Sensitivity | null;
    /** The holding's most important measured driver, which may differ from this link's driver. */
    lead?: DriverRank | null;
    /** Present on Calculated links. */
    calculation?: Calculation | null;
}
export interface Trust {
    total: number | null;
    band: 'High' | 'Medium' | 'Low' | null;
    spread: number | null;
    activity: number | null;
    depth: number | null;
    trackRecord: number | null;
    categoryCount: number;
    spreadCents: number | null;
}
export interface Market {
    ticker: string;
    title: string;
    subtitle: string;
    probability: number | null;
    spread: number | null;
    trust: Trust;
    asOf: string | null;
    kind: 'bracket' | 'kpi' | 'mention';
    /** Kalshi's level for an "above X" market, so a ladder of them can be read in order. */
    floorStrike?: number | null;
}
export interface ExposureEvent {
    seriesTicker?: string;
    ticker: string;
    title: string;
    category: string;
    closeTime: string;
    /** When the event happens according to Kalshi; the market close when Kalshi gives no later date. */
    eventTime: string;
    /** 'stated' is a date Kalshi gives by day only; its time of day is not known. */
    eventTimeSource: 'occurrence' | 'stated' | 'strike' | 'expected' | 'close';
    linkedValue: number;
    share: number;
    links: HoldingLink[];
    markets: Market[];
    mutuallyExclusive: boolean;
}
export interface ExposureResponse extends Freshness {
    holdings: Holding[];
    totalValue: number;
    byHolding: {
        symbol: string;
        events: {
            ticker: string;
            title: string;
            type: LinkType;
        }[];
        /** Reliable daily drivers of this holding, most important first. */
        drivers: DriverRank[];
    }[];
    events: ExposureEvent[];
}
export interface CalendarResponse extends Freshness {
    days: number;
    events: ExposureEvent[];
}
export interface OddsPoint {
    ts: string;
    ticker: string;
    probability: number;
}
export interface Summary {
    text: string;
    sources: {
        title: string;
        url: string;
    }[];
}
export interface EventResponse extends Freshness {
    event: ExposureEvent;
    history: OddsPoint[];
    summary: Summary | null;
}
export interface CalibrationBucket {
    low: number;
    high: number;
    count: number;
    meanProb: number | null;
    observedRate: number | null;
}
export interface SettledExample {
    ticker: string;
    title: string;
    probability: number;
    outcome: number;
    closeTime: string;
    oddsTime: string;
    eventTicker?: string | null;
    release?: { at: string; sourceUrl: string } | null;
    bid?: number | null;
    ask?: number | null;
}
export interface CategoryRecord {
    category: string;
    count: number;
    avgMiss: number;
    brier: number;
    buckets: CalibrationBucket[];
    firstClose: string | null;
    lastClose: string | null;
    eligibleForTrust: boolean;
    relevantHoldings: string[];
    examples: SettledExample[];
    // Settled markets in this sample that could not be scored, by reason.
    coverage: {scored: number; noQuote: number; outcomeKnown: number};
    // Distinct Kalshi events behind `count`; contracts in one event are not independent.
    eventCount: number;
    knownReleaseCount?: number;
    marketsWithRelease?: number;
    // Brier score of always predicting this sample's own Yes rate; the score to beat.
    baseRateBrier: number;
    headline70: {
        count: number;
        // null when too few markets to report a rate.
        observedRate: number | null;
        low: number | null;
        high: number | null;
    } | null;
}
export interface HistorySubject {
    id: string;
    title: string;
    seriesTickers: string[];
    record: CategoryRecord | null;
    eventCount: number;
    unknownEventMarkets: number;
    kalshiCategories: string[];
    linkedHoldings?: { symbol: string; type: LinkType; evidence: string }[];
    coverage?: CategoryRecord['coverage'];
}
export interface TrackRecordResponse extends Freshness {
    horizonHours?: number;
    subjects: HistorySubject[];
    categories: CategoryRecord[];
    totalMarkets: number;
    reviewedSeries: number;
    relevantCategories: {category: string; holdings: string[]}[];
    minSettled: number;
    // Trust-score weights and bands, read from server config so this page cannot drift from the formula.
    trustScoring: {spread: number; activity: number; depth: number; trackRecord: number; high: number; medium: number};
}
export const FORECAST_HORIZONS = [
    { hours: 720, label: '30 days' },
    { hours: 168, label: '7 days' },
    { hours: 24, label: '24 hours' },
] as const;
export interface HoldingMove extends Holding {
    actual: number | null;
    beta: number | null;
    fromMarket: number | null;
    beyondMarket: number | null;
    sourceDate: string | null;
    /** Each measured driver's estimated part of the day's move, largest first. They overlap and do not add up to the move. */
    drivers: DriverMove[];
}
export interface OddsMove {
    ticker: string;
    title: string;
    changePoints: number;
    links: HoldingLink[];
}
export interface MovesResponse extends Freshness {
    date: string;
    spyReturn: number | null;
    holdings: HoldingMove[];
    total: number | null;
    fromMarket: number | null;
    beyondMarket: number | null;
    oddsMoves: OddsMove[];
    /** Driver estimates summed over holdings, largest first; the first is what mattered most that day. */
    drivers: DriverMove[];
    /** Daily drivers with no published change for this date yet, so they could not be compared. */
    missingDrivers: string[];
    /** Value of holdings with no daily price (cash, bonds held directly, property); the totals leave them out. */
    unpricedValue: number;
}
/** The stock's move across one past results announcement. Null fields mean the closes were not available. */
export interface EarningsReportMove {
    /** SEC filing date (YYYY-MM-DD) of the 8-K carrying Item 2.02. */
    filingDate: string;
    sourceUrl: string;
    beforeDate: string | null;
    closeBefore: number | null;
    afterDate: string | null;
    closeAfter: number | null;
    move: number | null;
}
/** One trust figure for a group of markets: the median of their scores. */
export interface TrustSummary {
    total: number;
    band: 'High' | 'Medium' | 'Low';
    markets: number;
}
export interface EarningsThreshold {
    ticker: string;
    label: string;
    strike: number;
    probability: number | null;
    /** Bid and ask behind the midpoint; null without a quote. */
    bid: number | null;
    ask: number | null;
}
/** A reported metric for a period, such as headcount in 2026, read from its "above X" markets. */
export interface EarningsMetric {
    eventTicker: string;
    title: string;
    eventTime: string;
    eventTimeSource: ExposureEvent['eventTimeSource'];
    /** In order of level. Empty when the metric is not a ladder of "above X" markets. */
    thresholds: EarningsThreshold[];
    /** The highest level whose bid is at least 50% and the lowest whose ask is at most 50%. Null when no level is clearly on either side or the two are out of order. */
    evenOdds: { above: EarningsThreshold | null; below: EarningsThreshold | null } | null;
    trust: TrustSummary | null;
}
/** The next earnings call Kalshi lists, with the chance each word is said on it. */
export interface EarningsCall {
    eventTicker: string;
    time: string;
    /** Null when Kalshi gives only the day, or its default time rather than the call's own. */
    session: 'before-open' | 'market-hours' | 'after-close' | null;
    topics: { ticker: string; word: string; probability: number | null }[];
    trust: TrustSummary | null;
}
export interface EarningsCompany {
    symbol: string;
    name: string | null;
    valueUsd: number;
    callTime: string;
    session: EarningsCall['session'];
    /** Markets about this company's results: call topics plus metric levels. */
    markets: number;
}
export interface EarningsListResponse extends Freshness {
    /** Held companies with an earnings call Kalshi has dated, soonest first. */
    companies: EarningsCompany[];
    /** Listed securities held, including those without a dated call. */
    holdings: number;
}
export interface EarningsResponse extends Freshness {
    symbol: string;
    events: ExposureEvent[];
    ladders: {
        eventTicker: string;
        rawSum: number;
        outcomes: {
            ticker: string;
            title: string;
            probability: number;
        }[];
    }[];
    history: EarningsReportMove[] | null;
    historyNote: string;
    name: string | null;
    position: { valueUsd: number; share: number } | null;
    call: EarningsCall | null;
    /** The metric to lead with: the best-supported one whose odds give a clear reading. */
    featured: EarningsMetric | null;
    metrics: EarningsMetric[];
    /** Average size of the move across past reports, and the same in dollars on the holding. */
    typicalMove: { percent: number; usd: number; reports: number } | null;
}
export interface BriefingResponse extends Freshness {
    date: string;
    text: string | null;
    audioUrl: string | null;
}
export interface ErrorResponse extends Freshness {
    error: string;
}
export interface HealthResponse extends Freshness {
    status: 'ok';
    /** The database is accepting reads only: stored data is shown, odds are not updating and nothing can be saved. */
    readOnly: boolean;
}

export interface HistoricalPriceMove {
    beforeDate: string;
    afterDate: string;
    beforeClose: number;
    afterClose: number;
    change: number;
}
export interface HoldingEventHistory {
    eventTicker: string;
    seriesTicker: string;
    title: string;
    subjects: string[];
    release: {at: string;sourceUrl: string} | null;
    windowNote: string | null;
    spyMove: HistoricalPriceMove | null;
    predictions: {ticker: string;title: string;probability: number;outcome: number;quoteAt: string;closeAt: string;predatesRelease: boolean | null}[];
    outcome: {
        contracts: number;
        yes: number;
        // The contract whose earlier midpoint was furthest from what happened; null when only quotes taken at or after the release exist.
        biggestMiss: {title: string;probability: number;outcome: number} | null;
    };
    holdings: {symbol: string;type: LinkType;evidence: string;measuredAt: string | null;moveNote: string | null;move: HistoricalPriceMove | null;
        // Holding change minus SPY change over the same dates, as a plain difference in return.
        vsSpy: number | null}[];
}
export interface HoldingsHistoryResponse extends Freshness {
    holdings: string[];
    totalLinkedEvents: number;
    displayedEvents: number;
    // Displayed events with a verified release time and at least one holding price comparison.
    comparableEvents: number;
    currentHoldings: true;
    events: HoldingEventHistory[];
}
