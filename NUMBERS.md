# Displayed numbers and provenance

| Screen | Number | Source / calculation |
| --- | --- | --- |
| Add holdings | Entered dollar values | User form or symbol,valueUsd CSV, persisted to holdings.value_usd |
| Overview | Portfolio value and holdings count | holdings; backend sums values |
| Overview / Calendar / Event | Linked value and share | Sum of unique linked holdings / total entered holding value |
| Overview / Calendar | Event and market counts | Database events and markets after reviewed-tag matching |
| All data screens | asOf | Max relevant source update timestamp; null means no source data |
| Calendar / Event / Earnings | Event date | First of these still in the future: Kalshi market occurrence_datetime, event strike_date, market expected_expiration_time; otherwise markets.close_time. The screen names the field used and shows the market close beside it |
| Overview / Event | Close date/time | markets.close_time, never guessed report time |
| Event / Overview / Earnings | Probability | odds_snapshots.mid = (yes_bid + yes_ask) / 2 from Kalshi dollar fields |
| Event | One-week chart | odds_snapshots.ts and mid per selected ticker |
| Event / Earnings | Trust and components | config/trust.ts formulas; snapshots spread, volume_24h, open_interest and category calibration |
| Event | Spread cents | (yes_ask - yes_bid) × 100 |
| Event | b, interval, days and measured date | measured_links; revalidated reliability, range b ± 1.96 se; never a forecast from odds |
| Event | Plain-language sensitivity sentence | measured_links b, low and high × a fixed step (1% for oil and SPY, 0.10 percentage points for DGS2) × 100; a restatement, not a new estimate |
| Overview / Event | Typical effect and "moves most with" | measured_links.effect = \|b\| × the sample standard deviation of the driver's daily change, in the holding's return units; drivers ranked by it. Weekly drivers are not ranked against daily ones |
| Event / Overview | Calculated interest per point of rate | Entered cash balance × 0.01 a year; adjustable mortgage balance × 0.01 a year |
| Event / Overview | Calculated bond price change | −modified duration × 0.01 × entered value. Duration from the entered maturity and coupon, discounted at the latest DGS2 (five years or less) or DGS10 yield, or at the coupon when neither is loaded |
| Moves | Driver estimates and "what mattered most" | measured_links b × the driver's change that session × entered holding value, summed over holdings per driver; compared, never added to the total |
| Moves | Value with no daily price | Sum of entered values for cash, bonds held directly and property |
| Moves | Beta | Nightly measured_links SPY regression over available trailing five-year history; reliable range and minimum 60 observations required |
| Moves | Actual dollar move | Aligned daily-close return × entered holding value |
| Moves | Market component | Beta × SPY daily return × entered holding value |
| Moves | Beyond-market component | Actual dollar move minus market component, in integer cents |
| Moves | Portfolio totals | Holding sums in integer cents; beyond-market total = actual total − market total |
| Moves | Odds changes in points | Supported midpoint samples about 24 hours apart; only absolute changes ≥ 3 points |
| Earnings | Normalized bracket probability | Midpoints of a complete exclusive range ladder (buckets and open-ended end caps) divided by their raw sum |
| Earnings | Past report move | earnings_reports.filing_date from SEC EDGAR (8-K with Item 2.02); first prices.close after the filing date ÷ last close before it − 1; unavailable across a gap in price history |
| Earnings | Raw sum | Sum of unnormalized midpoint quotes |
| Track record | Count, Brier, average miss | settled_markets outcomes and bid–ask midpoint from candle at 24 hours before close |
| Track record | Calibration chart | Ten-point buckets; mean probability and observed outcome rate, no dots for empty buckets |
| Track record | 70% headline | Observed rate for 65% ≤ probability < 75%, shown only with observations |
| Briefing | Reach, moves and biggest odds move | Same backend services used by calendar/moves, rounded for template then number-checked |

UI chart axes, trust weights, band thresholds, date windows, introductory step labels and confidence-level labels are fixed method definitions, not market observations. Missing source observations show unavailable text or an empty state. Current event-level asOf is the latest poll snapshot across the database; individual markets carry their own asOf. Dates are shown in the viewer's local timezone. Briefing cache dates use the New York calendar day.
