-- Dates of past results announcements, from SEC EDGAR 8-K filings carrying Item 2.02.
CREATE TABLE earnings_reports (symbol text NOT NULL, accession text NOT NULL, filing_date date NOT NULL, report_date date, source_url text NOT NULL, loaded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(symbol,accession));
CREATE INDEX ON earnings_reports(symbol,filing_date DESC);
