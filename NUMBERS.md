# Displayed numbers and provenance

| Screen | Number | Source / calculation |
| --- | --- | --- |
| Add holdings | Entered dollar values and terms | User form or CSV (symbol,valueUsd, plus optional type, maturity, coupon, state, mortgage, rental), persisted to holdings |
| Overview | Portfolio value and holdings count | holdings; backend sums values |
| Overview / Calendar / Event | Linked value and share | Sum of unique linked holdings / total entered holding value |
| Overview / Calendar / Event | Which measurements become Related links | Reliable (at least 60 observations, 95% range excludes zero, typical effect at least one basis point) and typical effect at least 10% of the holding's largest daily typical effect (config/drivers.ts MATERIAL_SHARE). A weekly driver counts when a daily driver of its family passes. Below the floor the link is a Topic link; its evidence states the measured share |
| Overview | Category value and share | Sum of the values of the holdings in the group, each counted once / total holding value. Asset classes add up to 100%; event themes overlap and do not |
| Overview | Category basis (sector, fund category) | security_profiles from Yahoo quoteSummary: assetProfile.sector, fundProfile.categoryName; or the asset type the user entered |
| Overview | Category linked events and next event | Open events with a Direct, Calculated or Measured link to a holding in the group (for a theme, through that theme). Next is the soonest reached by a Direct or Calculated link or through a holding's most important measured driver; with none, the soonest linked event |
| Overview / Calendar / Moves | Category filter summary | Count and summed value of the chosen holdings / total holding value |
| Moves | Figures for a category or one holding | Sum, in whole cents, of the rows in view: value at each close, change, from market, beyond market, and each driver's estimate. Withheld when a security in view lacks the figure |
| Overview / Calendar | Event and market counts | Database events and markets after reviewed-tag matching |
| All data screens | asOf | Max relevant source update timestamp; null means no source data |
| Calendar / Event / Earnings | Event date | A date Kalshi states in the event subtitle ("On Oct 29, 2026") wins, with a precise time only when one falls on that day. Otherwise the first of these still in the future: Kalshi market occurrence_datetime, event strike_date, market expected_expiration_time; otherwise markets.close_time. The screen names the field used and shows the market close beside it |
| Overview / Event | Close date/time | markets.close_time, never guessed report time |
| Event / Overview / Earnings | Probability | odds_snapshots.mid = (yes_bid + yes_ask) / 2 from Kalshi dollar fields. Unavailable when the latest reading has no bid and no offer (yes_bid 0 and yes_ask 1): that is an empty book, not a 50% quote |
| Event | Odds chart (1 day, 1 week, 1 month, all time) | Each point is a stored reading for the selected ticker: odds_snapshots.mid, or odds_candles.mid = midpoint of a Kalshi candlestick's closing bid and ask at the end of its hour or day. 1 day: every snapshot plus hourly closes; 1 week: hourly closes plus the last snapshot of each hour; 1 month and all time: daily closes plus the latest snapshot. Readings with no bid and no offer are left out. The line is stepped and holds each reading until the next; nothing is interpolated |
| Event | Chart start, low, high, latest | First, minimum, maximum and last of the readings drawn in the selected range |
| Event | Chart probability axis | Round levels enclosing the readings drawn, at least ten points apart end to end, within 0% to 100%; a display scale, not data |
| Event | Listed date | markets.open_time from Kalshi's open_time |
| Event / Earnings | Trust and components | config/trust.ts formulas; snapshots spread, volume_24h, open_interest and category calibration |
| Event | Spread cents | (yes_ask - yes_bid) × 100 |
| Event | b, interval, days and measured date | measured_links; revalidated reliability, range b ± 1.96 se; never a forecast from odds |
| Event | Plain-language sensitivity sentence | measured_links b, low and high × a fixed step (1% for oil and SPY, 0.10 percentage points for DGS2) × 100; a restatement, not a new estimate |
| Overview / Event | Typical effect and "moves most with" | measured_links.effect = \|b\| × the sample standard deviation of the driver's daily change, in the holding's return units; drivers ranked by it. Weekly drivers are not ranked against daily ones |
| Event / Overview | Calculated interest per point of rate | Entered cash balance × 0.01 a year; adjustable mortgage balance × 0.01 a year |
| Event / Overview | Calculated bond price change | −modified duration × 0.01 × entered value. Duration from the entered maturity and coupon, discounted at the latest DGS2 (five years or less) or DGS10 yield, or at the coupon when neither is loaded |
| Moves | Driver estimates and "what mattered most" | measured_links b × the driver's change over the window × the holding's value at the first close, summed over holdings per driver; compared, never added to the total. A sensitivity under the link floor gives none |
| Moves | A driver's own change | Close on the window's last session against its close on the first: a return for SPY and crude oil, a difference in percentage points for yields. Named as missing when either reading is unpublished |
| Moves | Value with no daily price | Sum of entered values for cash, bonds held directly and property |
| Moves | Beta | Nightly measured_links SPY regression over available trailing five-year history; reliable range and minimum 60 observations required |
| Moves | Value at each close | Entered value × that close ÷ the latest stored close (the amount held now, held throughout), in whole cents |
| Moves | Change over the window | Value at the last close − value at the first close; needs the holding's own close on both sessions |
| Moves | Market component | Beta × SPY's return over the window × value at the first close |
| Moves | Beyond-market component | Actual dollar move minus market component, in integer cents |
| Moves | Portfolio totals | Holding sums in integer cents; beyond-market total = actual total − market total |
| Moves | Odds changes in points | Midpoint of the quote standing at the window's last close − that at its first (4:00 pm New York): the newest odds_candles close or odds_snapshots reading at or before each, at most 7 days old. Only quotes no wider than 10 cents at both ends, markets open at the last close, and absolute changes ≥ 3 points |
| Moves | Settled results and odds a day before | settled_markets.outcome and prob_24h_before for markets whose close fell inside the window; each event ordered by \|outcome − odds\| |
| Moves | Estimate beside an event | The Measured link's driver: that driver's change over the window and the linked holdings' estimates for it, summed in whole cents |
| Earnings | Normalized bracket probability | Midpoints of a complete exclusive range ladder (buckets and open-ended end caps) divided by their raw sum |
| Earnings / Calendar | Call date and countdown | The date Kalshi states in the call event's subtitle. The time, and before the open / after the close by the New York clock, only when the market's occurrence_datetime falls on that day and is not Kalshi's 10:00 am default |
| Earnings | Position and share of portfolio | Entered holding value; value ÷ total entered value |
| Earnings | Chance of each level | odds_snapshots.mid of each "above X" market, ordered by Kalshi's floor_strike; not scaled |
| Earnings | Where even odds fall | The highest level whose bid (midpoint − half the spread) is at least 50% and the lowest whose ask is at most 50%; no interpolation; omitted when no level is clearly on a side or they are out of order |
| Earnings | "No firm quote" | Shown instead of a chance when a level's bid and ask are more than 50 points apart |
| Earnings | Group trust | Median trust score of the markets in the group |
| Earnings | Call topics | odds_snapshots.mid of each word market for the next earnings call |
| Earnings | Typical move | Mean absolute move over the last 8 reports with a move (at least 4); × entered holding value for dollars |
| Earnings | Past report move | earnings_reports.filing_date from SEC EDGAR (8-K with Item 2.02); first prices.close after the filing date ÷ last close before it − 1; unavailable across a gap in price history |
| Earnings | Raw sum | Sum of unnormalized midpoint quotes |
| Track record | Count, Brier, average miss | settled_markets outcomes and the bid–ask midpoint standing 24 hours before close: the close of the last hourly Kalshi candlestick at or before that mark, no more than seven days older (odds_time records when). Markets listed for under a day, and markets whose book was empty at the mark, are not counted |
| Track record | Calibration chart | Ten-point buckets; mean probability and observed outcome rate, no dots for empty buckets |
| Track record | 70% headline | Observed rate for 65% ≤ probability < 75%, shown only with observations |
| Briefing | Reach, moves and biggest odds move | Same backend services used by calendar/moves, rounded for template then number-checked |

UI chart axes, trust weights, band thresholds, date windows, introductory step labels and confidence-level labels are fixed method definitions, not market observations. Missing source observations show unavailable text or an empty state. Current event-level asOf is the latest snapshot among the linked market rows; individual markets carry their own asOf. Dates are shown in the viewer's local timezone. Briefing snapshot dates use the New York calendar day; cache keys use holdings and voice configuration, excluding dates and market changes.
