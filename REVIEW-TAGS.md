# Proposed macro links for review

These six mappings were explicitly approved by the user on October 9, 2026 and applied
to the database. Approval applies to every event in the named series. Other AI proposals
remain pending review.

| Series | Observed subject | Proposed tag |
| --- | --- | --- |
| KXCPI | U.S. CPI in September | inflation |
| KXCPIYOY | Inflation in September 2026 (CPI YoY) | inflation |
| KXCPICORE | CPI core in September | inflation |
| KXFEDCUT | Next Fed rate cut | fed-rates |
| KXFEDHIKE | Next Fed rate hike | fed-rates |
| KXSP500WHEN | When the S&P 500 Index will be above a specified level | sp500 |

Measured holding links use historical stock returns, oil returns or Treasury yield changes,
with SPY as a control when appropriate. They describe historical associations with the
driver, not a forecast of what an event outcome would do to a stock.

The fixed company tag catalog now includes the 25 symbols in the larger test portfolio.
New AI tags remain pending review. `npm run job -- review-tags` includes all saved holdings,
not just the original five demo symbols. For a proposed row already present in that output:

```powershell
docker compose exec backend npm run job -- approve-tag SERIES_TICKER TAG
```

Do not approve the entire pending queue blindly. For example, a market about a Fed official
is not necessarily about interest rates, and Greenland acquisition is not a tariffs market.
