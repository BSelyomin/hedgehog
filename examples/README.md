# Fictional test portfolio

Import `fake-portfolio.csv` from the Add holdings screen, then select **Map my exposure**.
The five positions total **$100,000**. `valueUsd` is each position's fictional total dollar
value, not a share count or live stock price. These tickers match the existing demo symbols
and fixed company tags: AAPL, JPM, DAL, XOM and TLT.

This file is test input, not an investment recommendation. Imported holdings replace the
holdings displayed in the form; saving replaces holdings for that browser's anonymous session.
Links and measured sensitivities still require real market/price data and reviewed series tags.
Importing the file does not fabricate market data or guarantee summaries will be available.

## Larger import test

`fake-portfolio-large.csv` has 25 unique tickers at $10,000 each, totaling **$250,000**.
All amounts are fictional. It includes the original five symbols plus 20 additional stocks
and an ETF to exercise a longer holdings list and missing-data states.
The additional symbols are not added to the fixed tag list by importing this file.
They need price history for Moves and reviewed mappings for event links.

Use **Clear portfolio** on Add holdings to immediately remove saved holdings for the current
browser session. This also clears its cached briefing; market history and other sessions remain.

## Feature tour

`feature-tour.csv` has 17 fictional holdings totaling **$425,000**, chosen so that each one
shows a different case. It uses the optional columns, in this order:

```
symbol,valueUsd,type,maturity,couponRate,state,adjustableMortgage,rental
```

A stock or fund needs only the first two. `type` is `cash`, `treasury`, `bond` or `property`;
a Treasury or bond needs `maturity` (YYYY-MM-DD) and `couponRate` (percent a year); a property
needs `state`, and may give an adjustable mortgage balance and `yes` if it is rented out.

What each row showed on the running app on 2026-10-10. The figures are measured or calculated
from live data, so they will drift.

| Holding | Where to look | What it shows |
| --- | --- | --- |
| XOM | Overview, By holding | Crude oil outranks the stock market: 0.78% on a typical day against 0.42% |
| USO | Overview, By holding | An oil fund: crude oil 2.07%, far ahead of everything else |
| DAL, UAL | Overview; an oil event | Oil works against them (negative), but the stock market matters far more. An oil event says so |
| TLT | Overview; a Treasury-yield event | The 10-year yield is the main driver (0.84%); the stock market barely registers (0.09%) |
| JPM | Overview; Moves on 2026-10-08 | Yields help a bank (positive). On Oct 8 the 10-year yield mattered more than the market |
| ITB | A mortgage-rate event | A homebuilder fund with a measured weekly link to the 30-year mortgage rate |
| VNQ | Overview, By holding | A real-estate fund: the stock market first, then the 10-year yield (negative) |
| GLD | Overview, By holding | Gold is not a measured driver. The fund ranks Treasury yields first and falls when they rise |
| AAPL | Earnings | Call after the close; lead card reads headcount, even odds between 168,000 and 170,000 |
| NFLX | Earnings | Kalshi gives the call's day only, so no time of day is shown |
| TSLA | Earnings | Many results metrics: one leads, seven more in the table |
| UAL | Earnings | Lead card reads passengers flown, between 186 million and 188 million |
| SPY | Overview, By holding | The market itself: beta 1 and no links to oil or rates |
| SAVINGS | A Fed-rate event | Calculated: $200 a year per point of rate on $20,000 of cash |
| TNOTE-2036 | A Treasury-yield event | Calculated from maturity and coupon: about $803 per point of yield, duration 8.0 years |
| CORP-2031 | A Treasury-yield event | The same for a shorter bond: about $202 per point, duration 4.0 years |
| HOME | A mortgage-rate event; Overview | Calculated mortgage interest ($1,500 a year per point) and a topic link to the Florida hurricane market |

Also worth opening:

- **Moves** opens on the latest completed session and leaves the $335,000 with no daily price
  out of the totals. On 2026-10-08 stocks fell while oil rose: crude oil leads for XOM and USO,
  the 10-year yield for TLT, JPM and ITB.
- **Earnings** lists only JPM, UAL, NFLX, TSLA and AAPL: the five holdings whose next earnings
  call Kalshi has dated. XOM and DAL have company markets but no dated call, so they are absent.

Tickers new to the database need prices and measurements before their links appear. They load
each night and at backend startup, or at once with:

```powershell
docker compose exec backend npm run job -- prices
docker compose exec backend npm run job -- measure
```
