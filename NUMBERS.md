# Displayed numbers and provenance

| Screen | Number | Source / calculation |
| --- | --- | --- |
| Add holdings | Entered dollar values | User form or symbol,valueUsd CSV, persisted to holdings.value_usd |
| Overview | Portfolio value and holdings count | holdings; backend sums values |
| Overview / Calendar / Event | Linked value and share | Sum of unique linked holdings / total entered holding value |
| Overview / Calendar | Event and market counts | Database events and markets after reviewed-tag matching |
| All data screens | asOf | Max relevant source update timestamp; null means no source data |
| Calendar / Event | Close date/time | markets.close_time, never guessed report time |
| Event / Overview / Earnings | Probability | odds_snapshots.mid = (yes_bid + yes_ask) / 2 from Kalshi dollar fields |
| Event | One-week chart | odds_snapshots.ts and mid per selected ticker |
| Event / Earnings | Trust and components | config/trust.ts formulas; snapshots spread, volume_24h, open_interest and category calibration |
| Event | Spread cents | (yes_ask - yes_bid) × 100 |
| Event | b, interval, days and measured date | measured_links; revalidated reliability, range b ± 1.96 se; never a forecast from odds |
| Moves | Beta | Nightly measured_links SPY regression over available trailing five-year history; reliable range and minimum 60 observations required |
| Moves | Actual dollar move | Aligned daily-close return × entered holding value |
| Moves | Market component | Beta × SPY daily return × entered holding value |
| Moves | Beyond-market component | Actual dollar move minus market component, in integer cents |
| Moves | Portfolio totals | Holding sums in integer cents; beyond-market total = actual total − market total |
| Moves | Odds changes in points | Supported midpoint samples about 24 hours apart; only absolute changes ≥ 3 points |
| Earnings | Normalized bracket probability | Complete exclusive bracket midpoints divided by their raw sum |
| Earnings | Raw sum | Sum of unnormalized midpoint quotes |
| Track record | Count, Brier, average miss | settled_markets outcomes and bid–ask midpoint from candle at 24 hours before close |
| Track record | Calibration chart | Ten-point buckets; mean probability and observed outcome rate, no dots for empty buckets |
| Track record | 70% headline | Observed rate for 65% ≤ probability < 75%, shown only with observations |
| Briefing | Reach, moves and biggest odds move | Same backend services used by calendar/moves, rounded for template then number-checked |

UI chart axes, trust weights, band thresholds, date windows, introductory step labels and confidence-level labels are fixed method definitions, not market observations. Missing source observations show unavailable text or an empty state. Current event-level asOf is the latest poll snapshot across the database; individual markets carry their own asOf. Dates are shown in the viewer's local timezone. Briefing cache dates are UTC.
