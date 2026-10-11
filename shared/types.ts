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
    unavailableReasons: string[];
    actual: number | null;
    beta: number | null;
    fromMarket: number | null;
    beyondMarket: number | null;
    sourceDate: string | null;
    previousDate: string | null;
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
    /** Effective price session; an explicit request never falls back to another date. */
    date: string;
    requestedDate: string | null;
    notes: string[];
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

export interface ForecastRange { low: number; high: number }
export interface ForecastExclusion { symbol: string; valueUsd: number; reason: string }
export interface ValueForecast {
    horizon: 'next-trading-day';
    method: 'rolling-mean' | 'no-change' | null;
    priceDate: string | null;
    coveredValue: number;
    excluded: ForecastExclusion[];
    predictedValue: number | null;
    changeUsd: number | null;
    /** Point estimate plus the empirical 10th/90th percentiles of held-out errors. */
    estimated80Range: ForecastRange | null;
    observations: number;
    validation: { days: number; rmseUsd: number; noChangeRmseUsd: number } | null;
    notes: string[];
}
export interface ForecastDriver {
    key: string;
    label: string;
    /** User enters percent returns, or percentage-point yield changes. */
    unit: 'percent' | 'percentage-points';
    coveredValue: number;
    holdings: { symbol: string; valueUsd: number; sensitivity: Sensitivity; lead: DriverRank | null }[];
    excluded: ForecastExclusion[];
    historicalChangeRange: ForecastRange | null;
}
export interface ForecastsResponse extends Freshness {
    totalValue: number;
    baseline: ValueForecast;
    drivers: ForecastDriver[];
}
export interface ScenarioRequest { driver: string; change: number }
export interface ScenarioForecast extends Freshness {
    driver: string;
    change: number;
    coveredValue: number;
    predictedValue: number | null;
    changeUsd: number | null;
    /** Envelope of coefficient bounds; NOT a joint confidence or prediction interval. */
    sensitivityBounds: ForecastRange | null;
    holdings: { symbol: string; valueUsd: number; predictedValue: number; changeUsd: number; sensitivity: Sensitivity }[];
    excluded: ForecastExclusion[];
    notes: string[];
}
export interface ForecastMarket extends Freshness {
    ticker: string;
    eventTicker: string;
    title: string;
    eventTitle: string;
    closeTime: string;
    probability: number | null;
    spread: number | null;
    drivers: string[];
    probabilityNote: string;
}
export interface ForecastMarketsResponse extends Freshness { markets: ForecastMarket[] }
export interface EventForecastRequest { marketTicker: string; driver: string; yesChange: number; noChange: number }
export interface EventForecastResponse extends Freshness {
    market: ForecastMarket;
    yes: ScenarioForecast;
    no: ScenarioForecast;
    expectedValue: number | null;
    expectedChangeUsd: number | null;
    notes: string[];
}

export interface ForecastResultSummary {
    marketTicker: string;
    label: string;
    driver: string | null;
    targetLevel: number | null;
    reference: { value: number; date: string; url: string; unit?: 'percent' | 'points'; label?: string } | null;
    coveredValue: number;
    changeUsd: number | null;
    /** Includes other holdings at their CURRENT values, an explicit scenario assumption. */
    portfolioValueAssumingOthersFlat: number | null;
    gainingStocks: string[];
    losingStocks: string[];
    reason: string | null;
    unavailableReason?: 'outcome-mapping' | 'missing-strike' | 'missing-reference' | 'scenario-range' | 'no-measurement';
    basis?: 'market-level' | 'user-assumption' | 'ai-assumption';
    assumption?: ScenarioRequest;
    /** Snowflake's self-rating, 0–100. Uncalibrated; never an event probability. */
    confidence?: number;
    /** Reproducible inputs to the measured dollar calculation, never AI coefficients. */
    evidence?: { driver: string; change: number; unit: 'percent' | 'percentage-points';
        observations: number; measuredAt: string; referenceUrl: string | null };
}
export interface RankedForecastOutcome extends ForecastMarket {
    result: ForecastResultSummary;
    /** Stored contract terms, retained for joint comparison without parsing titles. */
    seriesTicker?: string;
    strike?: { type: string | null; floor: number | null; cap: number | null };
    /** Reviewed portfolio symbols for THIS contract, before grouping. */
    linkedSymbols?: string[];
}
export interface RankedForecastEvent {
    ticker: string;
    title: string;
    category: string;
    eventTime: string;
    eventTimeSource: ExposureEvent['eventTimeSource'];
    closeTime: string;
    linkedValue: number;
    share: number;
    /** Sum of |b| × typical daily driver change × value; NOT an event-return forecast. */
    dailySensitivityUsd: number | null;
    driver: string | null;
    driverLabel: string | null;
    measuredSymbols: string[];
    unmeasuredSymbols: string[];
    outcomes: RankedForecastOutcome[];
    preferredMarketTicker: string | null;
    /** One underlying across multiple resolution times shares one entry. */
    groupKey?: string;
    sourceEvents?: { ticker: string; seriesTicker: string; title: string; url: string; closeTime?: string }[];
    timeRange?: { from: string; to: string };
    prices?: { symbol: string; value: number; date: string; url: string }[];
}
export interface RankedForecastsResponse extends Freshness {
    totalValue: number;
    candidateEvents: number;
    events: RankedForecastEvent[];
    groupedEvents?: number;
    notes: string[];
}
export interface StockResultPrediction {
    symbol: string;
    currentValue: number;
    predictedValue: number;
    changeUsd: number;
    returnEstimate: number;
    direction: 'up' | 'down' | 'unchanged';
    sensitivity: Sensitivity;
    lead: DriverRank | null;
}
export interface ForecastResultResponse extends Freshness {
    market: ForecastMarket;
    totalValue: number;
    result: ForecastResultSummary;
    scenario: ScenarioForecast | null;
    stocks: StockResultPrediction[];
    notes: string[];
    /** Only drivers with reliable measurements for reviewed event-linked holdings. */
    scenarioDrivers?: Pick<ForecastDriver, 'key' | 'label' | 'unit' | 'coveredValue'>[];
}
export interface ForecastAssessmentResponse extends Freshness {
    status: 'pending' | 'ready' | 'unavailable';
    selectedMarketTicker: string | null;
    summary: Summary | null;
    generatedAt: string | null;
    reason: string | null;
    assumptions?: AIForecastAssumption[];
    /** Valid quantitative estimates can remain ready while rejected AI prose is hidden. */
    explanationStatus?: 'ready' | 'hidden';
    /** Legacy field; forecast assessments now stop after failure and never emit a retry time. */
    retryAt?: string;
    /** Current measured coefficients/holding values applied to cached AI assumptions. */
    predictions?: ForecastResultResponse[];
    /** One AI driver assumption informed by the whole family, not a sum of scenarios. */
    jointPrediction?: ForecastGroupPrediction;
}
export interface AIForecastGroupAssumption extends ScenarioRequest {
    horizonMarketTicker: string;
    evidenceMarketTickers: string[];
    confidence: number;
}
export interface ForecastGroupPrediction extends Pick<ForecastResultResponse, 'totalValue' | 'result' | 'scenario' | 'stocks' | 'notes' | 'asOf'> {
    horizon: { marketTicker: string; closeTime: string };
    evidenceMarketTickers: string[];
    contextContracts: number;
    contextTimes: number;
}
export interface AIForecastAssumption extends ScenarioRequest {
    marketTicker: string;
    /** Integer 0–100 model self-rating; not calibrated against realized outcomes. */
    confidence: number;
}
export interface ForecastAssessmentsResponse extends Freshness {
    assessments: { eventTicker: string; assessment: ForecastAssessmentResponse }[];
}
