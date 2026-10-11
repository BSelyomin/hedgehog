import { query } from '../db.ts';
import { cikFor, companyFor, filingUrl, resultsFilings, sec, secConfigured } from '../services/sec.ts';
import type { FilingPage, ResultsFiling, SecCompany, Submissions } from '../services/sec.ts';
import { runWithoutRetry } from '../services/no-retry.ts';

const WANTED = 8, KEPT = 12, YEARS = 3;
// SEC allows ten requests a second; stay well under it.
const pause = () => new Promise(resolve => setTimeout(resolve, 250));

export async function loadResultsFilings(cik: string, cutoff: string): Promise<ResultsFiling[]> {
    const first = await sec<Submissions>(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const found = resultsFilings(first.filings.recent);
    // Frequent filers such as banks keep only a few weeks in `recent`; older filings sit in
    // separate files, which hold the same arrays without the `filings.recent` wrapper.
    const older = [...(first.filings.files ?? [])].sort((a, b) => b.filingTo.localeCompare(a.filingTo));
    for (const file of older) {
        if (found.length >= WANTED || file.filingTo < cutoff)
            break;
        await pause();
        found.push(...resultsFilings(await sec<FilingPage>(`https://data.sec.gov/submissions/${encodeURIComponent(file.name)}`)));
    }
    return found.sort((a, b) => b.filingDate.localeCompare(a.filingDate)).slice(0, KEPT);
}

// Loads the dates of past results announcements for every held symbol from SEC EDGAR.
export async function earningsDates() {
    if (!secConfigured()) {
        console.warn('SEC_USER_AGENT missing; earnings report dates unavailable');
        return;
    }
    const symbols = (await query<{ symbol: string }>("SELECT DISTINCT symbol FROM portfolio_holdings WHERE asset_type='security'")).map(row => row.symbol);
    if (!symbols.length)
        return;
    const companies = Object.values(await sec<Record<string, SecCompany>>('https://www.sec.gov/files/company_tickers.json'));
    const cutoff = new Date();
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - YEARS);
    for (const symbol of symbols) {
        const cik = cikFor(companies, symbol);
        if (!cik) {
            console.warn('No SEC registrant found for symbol', symbol);
            continue;
        }
        try {
            // The same file names the registrant; the earnings screen shows it beside the ticker.
            const name = companyFor(companies, symbol)?.title;
            if (typeof name === 'string' && name.trim())
                await query('INSERT INTO companies(symbol,name) VALUES($1,$2) ON CONFLICT(symbol) DO UPDATE SET name=excluded.name,loaded_at=now()', [symbol, name.trim()]);
            await pause();
            const filings = await runWithoutRetry(`earnings-dates:${symbol}`, () => loadResultsFilings(cik, cutoff.toISOString().slice(0, 10)));
            if (!filings) continue;
            for (const filing of filings)
                await query(`INSERT INTO earnings_reports(symbol,accession,filing_date,report_date,source_url) VALUES($1,$2,$3,$4,$5)
                    ON CONFLICT(symbol,accession) DO UPDATE SET filing_date=excluded.filing_date,report_date=excluded.report_date,source_url=excluded.source_url,loaded_at=now()`,
                [symbol, filing.accession, filing.filingDate, filing.reportDate, filingUrl(cik, filing.accession)]);
            console.log('Earnings report dates loaded', symbol, filings.length);
        }
        catch {
            console.warn('Earnings report dates unavailable', symbol);
        }
    }
}
