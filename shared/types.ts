export type LinkType = 'Direct' | 'Measured' | 'Related';
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
    symbol: string;
    valueUsd: number;
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
}
export interface HoldingLink extends Holding {
    type: LinkType;
    evidence: string;
    sensitivity: Sensitivity | null;
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
    history: null;
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
