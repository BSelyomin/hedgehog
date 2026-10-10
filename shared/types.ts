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
}
export interface ExposureEvent {
    seriesTicker?: string;
    ticker: string;
    title: string;
    category: string;
    closeTime: string;
    /** When the event happens according to Kalshi; the market close when Kalshi gives no later date. */
    eventTime: string;
    eventTimeSource: 'occurrence' | 'strike' | 'expected' | 'close';
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
    headline70: {
        count: number;
        observedRate: number;
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
}
export interface TrackRecordResponse extends Freshness {
    subjects: HistorySubject[];
    categories: CategoryRecord[];
    totalMarkets: number;
    reviewedSeries: number;
    relevantCategories: {category: string; holdings: string[]}[];
    minSettled: number;
}
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
