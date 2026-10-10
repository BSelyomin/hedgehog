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
export interface ApiErrorResponse extends Freshness { error: string }
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
    manualHoldings?: Holding[];
    brokerageHoldings?: Holding[];
    sandbox?: boolean;
}
export type BrokerageMode = 'sandbox' | 'live';
export interface BrokeragePosition {
    symbol: string;
    kind: string;
    units: string | null;
    price: string | null;
    currency: string | null;
    valueUsd: number | null;
    excludedReason: string | null;
}
export interface BrokerageAccount extends Freshness {
    id: string;
    connectionId: string;
    name: string;
    institution: string;
    numberMask: string;
    included: boolean;
    available: boolean;
    positions: BrokeragePosition[];
    syncError: string | null;
}
export interface BrokerageConnection {
    id: string;
    name: string;
    disabled: boolean;
}
export interface BrokeragesResponse extends Freshness {
    configured: boolean;
    mode: BrokerageMode;
    message: string | null;
    connections: BrokerageConnection[];
    accounts: BrokerageAccount[];
    checkedAt: string | null;
}
export interface BrokerageConnectRequest { reconnect?: string }
export interface BrokerageConnectResponse extends Freshness { portalUrl: string }
export interface BrokerageAccountRequest { included: boolean }
/** Historical activity reported by SnapTrade, never an instruction to place a trade. */
export interface BrokerageActivity {
    id: string;
    type: string;
    symbol: string | null;
    quantity: number | null;
    price: number | null;
    amount: number | null;
    currency: string | null;
    fee: number | null;
    tradeDate: string | null;
    settlementDate: string | null;
    description: string | null;
}
export interface BrokerageActivitiesResponse extends Freshness {
    accountId: string;
    source: 'SnapTrade';
    mode: BrokerageMode;
    fetchedAt: string;
    /** The provider supplies no source freshness timestamp for this endpoint. */
    activities: BrokerageActivity[];
    pagination: { offset: number; limit: number; total: number };
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
/** One driver's estimated part of a holding's or the portfolio's move over a window, in dollars. */
export interface DriverMove {
    driver: string;
    contribution: number;
}
/** How far a driver itself moved over a window: a return for prices, percentage points for yields. */
export interface DriverChange {
    driver: string;
    kind: 'return' | 'difference';
    change: number;
}
export interface HoldingLink extends Holding {
    type: LinkType;
    evidence: string;
    sensitivity: Sensitivity | null;
    /** The holding's most important measured driver, which may differ from this link's driver. */
    lead?: DriverRank | null;
    /** Present on Calculated links. */
    calculation?: Calculation | null;
    /** The themes this link holds through (see Categories). Empty for an unmeasured topic link. */
    themes?: string[];
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
    /** Every theme one of its links holds through. */
    themes?: string[];
}
/** What a holding is. Each holding has exactly one class. */
export type AssetClass = 'stocks' | 'bonds' | 'cash' | 'property' | 'commodities' | 'crypto' | 'mixed' | 'unclassified';
export interface HoldingCategory {
    symbol: string;
    valueUsd: number;
    assetClass: AssetClass;
    /** What the class rests on: a company's sector or a fund's category from Yahoo, or the type the user entered. Null when unknown. */
    detail: string | null;
    /** Themes with an open event linked to this holding by a Direct, Calculated or Measured link. */
    themes: string[];
}
export interface CategoryGroup {
    key: string;
    label: string;
    /** Holdings in the group, largest first. Each is counted once. */
    symbols: string[];
    valueUsd: number;
    /** valueUsd as a share of the whole portfolio. Theme groups overlap, so their shares do not add up to 100%. */
    share: number;
    /** Open events linked to a holding in the group; for a theme, through that theme. Unmeasured topic links are not counted. */
    events: number;
    /** The soonest of those events. */
    next: Pick<ExposureEvent, 'ticker' | 'title' | 'eventTime' | 'eventTimeSource'> | null;
    /** Theme groups: the holdings the theme matters most to, largest first. A holding linked by a Calculated link, or a security whose most important measured driver stands behind the theme. */
    lead: string[];
}
/** The portfolio grouped two ways, for the category cards and the filters every screen shares. */
export interface Categories {
    totalValue: number;
    holdings: HoldingCategory[];
    /** What you own. Every holding is in exactly one. */
    assetClasses: CategoryGroup[];
    /** What kind of event is linked to it. A holding can be in several. */
    themes: CategoryGroup[];
}
export interface ExposureResponse extends Freshness {
    holdings: Holding[];
    totalValue: number;
    categories: Categories;
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
    categories: Categories;
}
/** How far back the event chart looks. */
export type OddsRange = 'day' | 'week' | 'month' | 'all';
/** A bid–ask midpoint at one moment: a reading Hedgehog stored or the close of a Kalshi candlestick. */
export interface OddsReading {
    ts: string;
    probability: number;
}
export interface OddsHistoryResponse extends Freshness {
    ticker: string;
    range: OddsRange;
    /** Start of the range. For 'all' it is when Kalshi listed the market, or the first reading if that is unknown. */
    from: string | null;
    to: string;
    /** When Kalshi opened the market, if known. */
    listed: string | null;
    points: OddsReading[];
}
export interface Summary {
    /** Original AI snapshot time, independent of current Kalshi quotes. */
    generatedAt?: string;
    text: string;
    sources: {
        title: string;
        url: string;
    }[];
}
export interface EventResponse extends Freshness {
    event: ExposureEvent;
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
/** How far back a Moves window opens from its last close. */
export type MoveRange = 'day' | 'week' | 'month' | 'quarter';
export interface HoldingMove extends Holding {
    unavailableReasons: string[];
    /** What the holding was worth at the window's first and last close, holding today's amount throughout. */
    startValue: number | null;
    endValue: number | null;
    /** endValue − startValue. */
    actual: number | null;
    beta: number | null;
    fromMarket: number | null;
    beyondMarket: number | null;
    sourceDate: string | null;
    previousDate: string | null;
    /** Each measured driver's estimated part of the window's move, largest first. They overlap and do not add up to the move. */
    drivers: DriverMove[];
}
/** A holding's link to an event on the Moves screen, without the evidence the event page carries. */
export interface MoveLink {
    symbol: string;
    type: LinkType;
    /** For a Measured link, the driver under which the holding's estimate for the window is listed. */
    driver: string | null;
    /** The themes this link holds through (see Categories). Empty for an unmeasured topic link. */
    themes: string[];
}
/** One market's odds at the two ends of a window. Each is a reading from a source, with its time. */
export interface OddsMove {
    ticker: string;
    title: string;
    from: number;
    to: number;
    fromTime: string;
    toTime: string;
    changePoints: number;
}
/** An event with at least one market whose odds moved three points or more over the window. */
export interface MovedEvent {
    ticker: string;
    title: string;
    links: MoveLink[];
    /** The markets that moved most, biggest first; `moved` counts all that moved. */
    markets: OddsMove[];
    moved: number;
}
export interface SettledMarket {
    ticker: string;
    title: string;
    outcome: 0 | 1;
    /** Kalshi's odds 24 hours before the market closed (see Track record). */
    probabilityBefore: number;
    closeTime: string;
}
/** An event whose markets closed inside the window and have settled. */
export interface SettledEvent {
    ticker: string;
    /** Kalshi's event title when we hold it; otherwise the markets' own questions say what it was. */
    title: string | null;
    closeTime: string;
    links: MoveLink[];
    /** The markets furthest from what Kalshi expected, first; `settled` and `yes` count all of them. */
    markets: SettledMarket[];
    settled: number;
    yes: number;
}
export interface MovesResponse extends Freshness {
    /** Effective price session, the window's last close; an explicit request never falls back to another date. */
    date: string;
    requestedDate: string | null;
    range: MoveRange;
    /** Session of the window's first close; null when no earlier close is stored. */
    startDate: string | null;
    notes: string[];
    spyReturn: number | null;
    holdings: HoldingMove[];
    /** Listed securities at the window's first and last close, and the difference. */
    startValue: number | null;
    endValue: number | null;
    total: number | null;
    fromMarket: number | null;
    beyondMarket: number | null;
    /** The instants Kalshi's odds are compared at: 4:00 pm New York on the two sessions. */
    oddsWindow: { from: string; to: string } | null;
    movedEvents: MovedEvent[];
    settledEvents: SettledEvent[];
    /** Driver estimates summed over holdings, largest first; the first is what mattered most over the window. */
    drivers: DriverMove[];
    /** How far each compared driver itself moved over the window. */
    driverChanges: DriverChange[];
    /** Daily drivers with no published reading at both ends of the window, so they could not be compared. */
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
    generatedAt: string | null;
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
