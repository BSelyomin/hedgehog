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
