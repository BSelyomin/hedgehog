export type LinkType = 'Direct' | 'Measured' | 'Related';
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
    symbol: string;
    valueUsd: number;
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
export interface CategoryRecord {
    category: string;
    count: number;
    avgMiss: number;
    brier: number;
    buckets: CalibrationBucket[];
    headline70: {
        count: number;
        observedRate: number;
    } | null;
}
export interface TrackRecordResponse extends Freshness {
    categories: CategoryRecord[];
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
