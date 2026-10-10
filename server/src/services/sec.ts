// SEC EDGAR public APIs. Contracts consulted: SOURCES.md.
// SEC's fair-access policy requires a User-Agent that identifies the requester, for example
// "Hedgehog you@example.com". Without SEC_USER_AGENT no request is sent.
export interface SecCompany {
    cik_str: number;
    ticker: string;
    title: string;
}
// Filing lists are parallel arrays: index i of every array describes the same filing.
export interface FilingPage {
    accessionNumber: string[];
    filingDate: string[];
    reportDate?: string[];
    form: string[];
    items: string[];
}
export interface Submissions {
    filings: {
        recent: FilingPage;
        files?: { name: string; filingFrom: string; filingTo: string }[];
    };
}
export interface ResultsFiling {
    accession: string;
    filingDate: string;
    reportDate: string | null;
}

export function secConfigured(): boolean {
    return Boolean(process.env.SEC_USER_AGENT?.trim());
}

export async function sec<T>(url: string): Promise<T> {
    if (!secConfigured())
        throw new Error('Set SEC_USER_AGENT');
    const response = await fetch(url, { headers: { 'User-Agent': process.env.SEC_USER_AGENT!.trim(), Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok)
        throw new Error(`SEC HTTP ${response.status}`);
    return await response.json() as T;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));

// EDGAR writes share classes with a dash (BRK-B); brokers often use a dot.
export function companyFor(companies: SecCompany[], symbol: string): SecCompany | null {
    const ticker = symbol.replace('.', '-').toUpperCase();
    return companies.find(company => company?.ticker === ticker) ?? null;
}
export function cikFor(companies: SecCompany[], symbol: string): string | null {
    const match = companyFor(companies, symbol);
    return match && Number.isInteger(match.cik_str) && match.cik_str > 0 ? String(match.cik_str).padStart(10, '0') : null;
}

// A results announcement is an 8-K carrying Item 2.02, "Results of Operations and Financial
// Condition". Amendments (8-K/A) are not separate announcements and are left out.
export function resultsFilings(page: FilingPage): ResultsFiling[] {
    if (![page?.accessionNumber, page?.filingDate, page?.form, page?.items].every(Array.isArray))
        throw new Error('Invalid SEC filing list');
    return page.accessionNumber.flatMap((accession, i) => {
        const items = typeof page.items[i] === 'string' ? page.items[i].split(',').map(item => item.trim()) : [];
        const filingDate = page.filingDate[i], reportDate = page.reportDate?.[i];
        return page.form[i] === '8-K' && items.includes('2.02') && /^\d{10}-\d{2}-\d{6}$/.test(accession) && isDate(filingDate)
            ? [{ accession, filingDate, reportDate: isDate(reportDate) ? reportDate : null }] : [];
    });
}

export const filingUrl = (cik: string, accession: string) =>
    `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}-index.htm`;
