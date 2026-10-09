# Market mapping reviews and generation

These six mappings were explicitly approved by the user on October 9, 2026 and applied
to the database. Approval applies to every event in the named series. Other AI proposals
were left pending at that stage; subsequent bulk approval is recorded below.

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

The fixed tag catalog contains 308 tags: 201 topics and 107 stock/fund symbols, including
all 25 symbols in the larger test portfolio. Topics cover economics, politics, taxes,
regulation, energy, commodities, weather, culture, technology, healthcare and corporate activity.
New AI tags remain pending review. `npm run job -- review-tags` includes all saved holdings,
not just the original five demo symbols. For a proposed row already present in that output:

```powershell
docker compose exec backend npm run job -- approve-tag SERIES_TICKER TAG
```

Do not approve the entire pending queue blindly. For example, a market about a Fed official
is not necessarily about interest rates, and Greenland acquisition is not a tariffs market.
Bank of America sponsoring a NASCAR race does not make that race a BAC company event;
American Airlines or Alaska Air metrics do not describe Delta. Adding a topic to the fixed
catalog does not automatically link it to every holding. Holding-topic links still require
filing evidence, a reviewed sector mapping or the existing measured drivers. New topics
do not acquire numerical sensitivities simply because they have been tagged.

Changing the allowed catalog invalidates the series-classification cache. The next bootstrap
or hourly enrichment run proposes tags for the expanded catalog; existing review states and
provenance are preserved. Source category is also supplied to Cortex and included in the
cache fingerprint. Closed markets are excluded from new classification work. The four
measured driver tags remain oil, fed-rates, inflation and
sp500. All other new topics are qualitative unless a separately validated measurement is added.

## Company coverage review — October 9, 2026

The user explicitly approved these 20 mappings on October 9, 2026. All 20 were applied
to the database in one transaction, preserving their Snowflake provenance. Live service
verification found 20 companies with direct links and 41 total linked events for the
25-holding test portfolio. NVIDIA's earnings-call event returned 19 outcome markets.
Other proposals were left pending at that stage, including the incorrect NASCAR/BAC and
American Airlines or Alaska Air/DAL suggestions. The later bulk approval below supersedes
that pending status.

These mappings were checked against active event titles in the local Kalshi catalog.
They cover 20 companies, including the two previously shown in Earnings. Each series
below concerns the named company; general sports sponsorships, competitors and an
executive's unrelated activities are excluded.

| Series | Observed subject | Company tag |
| --- | --- | --- |
| KXEARNINGSMENTIONAAPL | Apple earnings call | AAPL |
| KXEARNINGSMENTIONAMZN | Amazon earnings call | AMZN |
| KXEARNINGSMENTIONBAC | Bank of America earnings call | BAC |
| KXEARNINGSMENTIONCOST | Costco earnings call | COST |
| KXCVXCC | Chevron credit card spend | CVX |
| KXCEODAL | Delta CEO departure | DAL |
| KXEARNINGSMENTIONGOOGL | Google earnings call | GOOGL |
| KXEARNINGSMENTIONGS | Goldman Sachs earnings call | GS |
| KXEARNINGSMENTIONJPM | JPMorgan earnings call | JPM |
| KXEARNINGSMENTIONMA | Mastercard earnings call | MA |
| KXMETA | Meta ad impressions growth | META |
| KXMSFTMENTION | Microsoft Ignite keynote | MSFT |
| KXEARNINGSMENTIONNFLX | Netflix earnings call | NFLX |
| KXEARNINGSMENTIONNVDA | NVIDIA earnings call | NVDA |
| KXORCLA | Oracle headcount | ORCL |
| KXEARNINGSMENTIONTSLA | Tesla earnings call | TSLA |
| KXEARNINGSMENTIONUAL | United Airlines earnings call | UAL |
| KXVISADEBIT | Visa debit antitrust case | V |
| KXWMT | Walmart comparable sales growth | WMT |
| KXEXXONCC | ExxonMobil credit card spend | XOM |

Company markets include earnings-call topics, business metrics and company-specific events;
they are not all earnings reports. No company is added merely because it shares an industry.

## Bulk approval and additional generation — October 9, 2026

The user requested at least 1,000 additional mappings, then explicitly instructed:
"approve all mappings" after being told the existing queue included incorrect links.
At the generation baseline there were 7,189 unique series/tag mappings, of which 30 had
been approved. All 7,159 pending mappings were then approved, bringing the approved
total to 7,189. This is bulk authorization, not an assertion that every mapping was
individually verified. Known incorrect candidates were included as requested.

The additional run expands the fixed catalog by 74 specific topics, including election
types, business metrics, named sports, entertainment subjects and weather measures.
The classifier only proposes supported tags; the requested quantity is not included in
its prompt. New inserts retain `source = 'snowflake'`; duplicates do not count as additions
and existing provenance is preserved. The user also authorized approval of this additional
batch. Future scheduled classifications still default to `reviewed = false`.

Topic mappings classify market subjects. They are not automatically stock connections,
and a larger catalog does not imply that every portfolio has 1,000 linked events.

The completed pass processed 4,599 active series and inserted **3,196 distinct new
series/tag mappings**, exceeding the requested 1,000 additions. All 3,196 additions
were approved in the final transaction. The resulting catalog has **10,385 approved
mappings**. The audit checked that all 7,189 baseline mappings remained present and
retained their original provenance.

The full additions and per-tag counts are recorded in
[`reports/mappings-2026-10-09-expanded.json`](reports/mappings-2026-10-09-expanded.json).
The largest additions are soccer (552), American football (310), basketball (221),
US Senate elections (130), US House elections (119) and sports awards (99).

Validation: 107 tests passed, backend build and type check passed, and a browser check
rendered the 622-event approved dataset with working search, filter reset, Earnings
selection and mobile layout. Bulk approval does not validate each AI classification;
the known incorrect links described above remain approved as requested.
