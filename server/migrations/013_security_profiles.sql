-- What kind of security each held ticker is, as Yahoo's quote summary describes it: its type
-- (EQUITY, ETF, MUTUALFUND, MONEYMARKET, CRYPTOCURRENCY), a company's sector and industry, a
-- fund's category. The category filters group holdings by asset class from these; a ticker with
-- no row, or a fund category that is not mapped, stays Unclassified.
CREATE TABLE security_profiles (
    symbol text PRIMARY KEY,
    quote_type text NOT NULL,
    name text,
    sector text,
    industry text,
    fund_category text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
