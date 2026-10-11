# Validation and phase status

## Reach, a daily read-along briefing, the other timeframes and questions about an event (2026-10-10)

All 659 tests and both TypeScript checks pass.

- **Reach.** An event's share now counts only holdings linked by more than a shared topic. With
  the tour portfolio the widest event reads 83.5% (a mortgage-rate event; the house is linked to
  it by its adjustable mortgage) where it read 89.4% for shelter inflation, of which 76.5 points
  were topic links. The Overview's count is 356 events, the number of rows it shows; the ten
  topic-only events are on the Calendar with "Topic link only" and no share.
- **Briefing.** Made once a day and replaced the next day. Checked live: one ElevenLabs request
  of 31 seconds returned audio and timings that matched all ten sentences; the screen marked the
  sentence being spoken at 0.2, 6 and 20 seconds; five sentences link to Moves or an event page.
- **Timeframes.** The 1-hour, 7-day and 30-day records are read by the 24-hour rule from the
  markets already scored. Migration 018 replaces the table's rule that a quote be from the
  minute before the mark, which had refused every such row. The run was still going when this
  was written; see the reply for how far it got.
- **Summaries.** The 49 stopped summaries had all failed the number check by repeating a figure
  from the reporting. Asked for words only, the model spelled figures out ("thirteen point eight
  million"), which the digit check cannot read; that is now refused too, and summaries are asked
  for with no figures at all.
- **Questions.** "What has been reported about oil prices recently?" on an oil event returned an
  answer citing 3 of 5 retrieved sources with its one number matched to the market data; "Why
  might crude supply be tight?" and an unrelated question returned no answer, as intended.
- **History views.** `#track-record/holdings` and `#track-record/calibration` open the views the
  event page links to.

## Screens name the person signed in; an audit of every endpoint (2026-10-10)

All 620 tests and both TypeScript checks pass.

- **Names.** Signed in, the headings and figure lines read "Alex’s exposure map", "What moved
  Alex’s portfolio", "of Alex’s portfolio"; a guest still reads "Your". Checked in a browser as
  a guest and as a throwaway account (since removed) on Add holdings, Overview, Calendar,
  Earnings, Moves, Track record and an event page: no browser errors, and a long name wraps
  inside its heading at phone width with no sideways scroll.
- **Audit.** A script saved the feature-tour portfolio in a guest session, read every endpoint
  and checked the figures against each other: sums and shares on the Overview and the category
  cards, the calendar's window and order, each Moves window (change = end − start, market +
  beyond = change, totals = the rows, odds moves of 3+ points read at or before each close and
  under seven days old, settlements inside the window), earnings (typical move = the average of
  the moves shown, ladders, even odds), track-record accuracy, grades, sorting and filters,
  forecast arithmetic, and that bad input is refused. All of it held.
- **Found, not yet changed.**
  - *Reach counts links the Overview hides.* An event's share counts every linked holding,
    topic links included, while the Overview's rows show only Direct, Calculated and Related.
    With the tour portfolio the widest-reaching event reads 89.4% and its row shows holdings
    worth 12.9%; the rest is a house linked by an unmeasured topic. Ten events sent to the
    Overview have no link it shows, so the "Linked events" count (366) is ten more than its rows.
  - *The briefing is made once per portfolio, not once a day.* Its cache key leaves out the
    date, so an unchanged portfolio keeps its first briefing and "Reload briefing" returns it.
  - *Slow pages.* `/exposure`, `/calendar`, `/event/:ticker` and `/earnings/:symbol` took 4 to 7
    seconds each; the calendar and every event page rebuild the whole exposure map.
  - The event page's "Compare with past events" link names a By holding view the Track record
    page no longer has.

## Odds polling restored after the one-attempt rule stopped it (2026-10-11)

All 613 tests and both TypeScript checks pass. The password-hashing test exceeded its
five-second limit in one of four runs while the machine was busy.

- **What happened.** A merge from origin made every Kalshi request a single attempt and stopped
  a scheduled job for good after one failure. The poller on another backend failed once at
  00:40 UTC and wrote `stopped-job:poll` to the shared database, so no backend on that code
  would poll again until someone resumed it by hand. Kalshi had been answering 429 to plain
  requests from this address earlier in the day.
- **Decision (richie):** Kalshi's data jobs retry; AI, voice and brokerage calls keep the
  one-attempt rule.
- **Now.** A Kalshi request waits and tries again on 429 and 5xx, up to five attempts. `poll`,
  `odds-candles` and the new `track-record` job (the backfill, moved out of the nightly AI job)
  run again at their next schedule and never obey a stop marker. A failed series, page or
  candlestick request keeps its place for the next run and leaves nothing in `job_state`.
- **A second fault on this machine.** This backend had not polled either: the scheduling
  library drops a tick more than a second late, and every five-minute timer here fired 16 to 30
  seconds late (the hourly ones about four minutes), 20 times in 65 minutes, in a Docker
  Desktop virtual machine whose clock is corrected in steps. A tick up to 15 minutes late now
  runs.

## Overview cells show value and share; a letter is not a search for a holding (2026-10-11)

All 497 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors and no sideways page scroll.

- **Overview.** Each of the 2,523 holding cells in the events table shows the holding's value as
  entered and its share of the $425,000 portfolio, such as "GLD, $5,000.00 · 1.2%" and "HOME,
  $300,000.00 · 70.6%". Every share equals the value over the total to one decimal. The cell's
  tooltip, its name for screen readers, the expanded row and the "By holding" headings carry the
  same figures. The table still fits its region at 1440 pixels.
- **Moves.** SAVINGS still appeared whenever the search box held any letter in its name: typing
  "s" to find SPY listed it. A holding with no daily price now gets a row only for its own
  name. "s", "a", "sa" and "o" list securities alone and name the hidden ones in the note; "sav",
  "savings", "hom" and "tno" list SAVINGS, HOME and TNOTE-2036; "2036" does not. Picking SAVINGS
  no longer gives it a row either: the screen says above the table that it has no move and
  what it is worth.

## Moves table: only what has a move, and only the picked holding (2026-10-11)

All 494 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors and no sideways page scroll.

- **No move, no row.** The table lists the 13 securities. CORP-2031, HOME, SAVINGS and
  TNOTE-2036, which have no daily price, are named in one line under the search box and not
  given rows. Searching "sav" lists SAVINGS; searching "o" lists the three of them that match
  beside USO and XOM. With the Cash class chosen the table says nothing in view has a daily
  price.
- **Picking filters.** Picking USO in the table, or TSLA in the dropdown, leaves that one row,
  with "Showing only USO, the holding you picked" and a button back to all holdings. Before,
  every row stayed and the picked one was only marked. HOME, picked, is listed although it has
  no move, since it was asked for.

## Track record filters and layout; Moves paging and section bar (2026-10-10)

All 488 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors, no sideways page scroll, no control under 44 pixels.

- **Track record, linked holdings.** Opened, a theme's holdings run the full width of its card
  (1,295 of 1,345 pixels) as tiles, four across at 1440 and one at 390, with no scrolling box
  inside. The fund tab no longer says "Related to 1 of your holdings" of a fund that is the
  holding: TLT reads "You hold this fund: $10,000.00 · 2.4% of portfolio" and the S&P 500
  benchmark "Tracked by SPY, which you hold".
- **Track record, order and filters.** Ordered by highest accuracy the themes run Stock market
  99.1%, Oil 95.8%, Fed rates 95.7%, Direct company markets 93.6%, Inflation 90.8%, Treasury
  yields 90.0%. Grade B alone leaves Treasury yields, and on the Companies tab Alphabet, Tesla
  and Amazon. "Only records with history" leaves ten companies and two funds. Clearing returns
  to the default order.
- **Moves, paging.** Over the week, 40 settled events show five to a page over eight pages and
  112 with odds that moved over 23, each with "Showing 1 to 5 of 112". Turning a page returns
  to the top of that list. A driver's events inside a row page their two lists separately (six
  pages of odds and two of settled events for USO through oil). Nothing says "Show more".
- **Moves, section bar.** The bar stays at the top while the page scrolls and marks the
  section in view. Each jump lands the section 76 pixels down, below the 61-pixel bar, and
  "Top" returns to the window controls. At 390 pixels it stays one line and scrolls sideways.

## Track record page reads the history that exists (2026-10-10)

All 480 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors and no sideways page scroll.

- **What was wrong.** After the track-record merge the page showed "No history yet" for every
  theme. It read a store of its own (`track_markets`, `track_quotes`) that only its own collector
  filled, and that collector is off unless switched on. All of its tables were empty on the
  shared database, beside 19,658 scored markets in `settled_markets`.
- **Now, at 24 hours,** it reads `settled_markets`: Direct company markets 93.6% of 9,489
  questions (A), Oil 95.8% of 3,844 (A), Inflation 90.8% of 3,079 (A), Treasury yields 90.0% of
  1,634 (B), Fed rates 95.7% of 928 (A), Stock market 99.1% of 116 (A). Companies are rated from
  their reviewed ticker tags (Netflix 98.0% of 6,204, Tesla 82.7% of 208, Apple 88.9% of 117
  with too few event IDs for a grade); looking up a company not held works (Nvidia 90.0% of
  361). Funds: TLT 90.0% of 1,550; the S&P 500 benchmark 41 of 41 across four event IDs, which
  is "Limited history". Exactly even quotes are left out (53 across the six themes).
- **The 1-hour, 7-day and 30-day timeframes are still empty.** They read
  `forecast_observations`, which has no rows here; its collector keeps only a quote from the
  exact minute before the mark. The nightly job now gives it 300 markets a night and runs it
  after the summaries and briefings. Unbounded, as merged, it would have asked Kalshi for up to
  four quotes for each of about 109,000 settled markets while holding the nightly lock.
- **Tables.** Of the nine added by the merge, five had no use left and were dropped by migration
  017, all empty when dropped: `track_markets`, `track_quotes` and `track_sync` (a second copy of
  the history), `track_company_series` (series matched to companies by name without review) and
  `track_benchmark_series` (six rows mirroring a list now in the code). Four stay:
  `track_entities` (names 106 of the 107 tickers in the tag list, 48 of which nothing else
  named), `forecast_observations`, `backfill_skips` and `event_releases` (eight verified CPI
  release times).
- **Speed.** The page took about 5 s to load, 4.5 s of it matching 4,499 reviewed series to
  the holdings by searching the full tag and event lists again for each series. Grouped once,
  and with the latest-yields read bounded to 30 days, a load takes 1.5 to 1.8 s.
- **Not checked against Kalshi's site:** the percentages are what the stored readings give. A
  release time is known for eight events only, so a quote taken a day before close is not
  proof that it preceded the public result; none of the stored 24-hour quotes fell after one of
  those eight releases.

## Track-record backfill: the full pass, and very large series (2026-10-10)

All 430 tests and both TypeScript checks pass.

- **Coverage.** The full pass looked at 510 series. The track record now holds 19,658 settled
  markets in 282 series and 1,913 events, up from 127 markets before the backfill was rebuilt:
  Economics 6,536, Entertainment 6,291, Financials 3,199, Mentions 1,764, Commodities 750,
  Politics 444, Climate and Weather 435, Science and Technology 226, Companies 13. The table
  is 5.6 MB. 342 series have recorded how far they got, so a later run reads only what settled
  since.
- **Very large series.** KXINXU settles tens of thousands of hourly markets. Naming all of them
  in one statement ran past the database's 25-second limit 248 s into the series. Statements
  now carry 5,000 markets each, and the same series got 1,172 s in, past every database step.
- **Two series are not finished: KXINXU and KXWTI.** Both stop at Kalshi's retry limit. Asked
  one request at a time, Kalshi answered `429 too_many_requests` with no `Retry-After` header
  while the poller and candlestick job were also running from this address, so this is rate
  limiting and not a fault in a request. Three others that failed in the pass went through
  when retried alone (KXAAAGASW 990 markets scored, KXNETFLIXRANKSHOWRUNNERUP 537, KXWTIMAX
  153). The two keep their place and are tried again on the next run.

## One-hour forecast timing (2026-10-10)

Added the one-hour option alongside default 24 hours, seven days and 30 days before trading close. Migration 013 expands the observation/exclusion constraints without changing stored quotes. All 256 tests, lint and production build pass in Node 24. The live one-hour endpoint returns 200 with an empty record; no backfill was run and no grade thresholds were introduced. The existing trust score is unchanged.

## Track Record views and historical horizons (2026-10-10)

All 256 tests, strict TypeScript checks and the Next.js production build pass in the Node 24 Docker validation container. The existing merge conflicts were resolved with both branches preserved; the earnings screen and asset support remain intact.

Added By Market and By Holding views, exact reviewed holding relevance, historical examples before optional statistics, and independent 24/168/720-hour forecast horizons before trading close. No horizon borrows or interpolates another horizon's probability. Added migration 012 for raw bid/ask observations and per-horizon exclusions; the migration was exercised in a disposable Timescale database, including wrong-window and crossed-quote rejection. Existing category trust scoring remains at 24 hours.

Live API validation returned 200 for all supported horizons and 400 for an unsupported horizon. The configured database retains 127 legacy 24-hour observations. A bounded ten-market KXCPI check produced one real 30-day observation and no usable seven-day observations; it recorded missing quotes separately for each horizon. This was a small coverage check, not a full backfill or an independent validation of all outcomes. The 30-day example retains its actual 62% bid / 97% ask rather than treating the midpoint as a precise forecast.

Limitations: sparse longer-horizon samples, incomplete official release timing, correlated contracts and overlapping event identifiers, current rather than historical holding relationships, and Kalshi-reported rather than independently reverified settlements. Browser checks verified By Market / By Holding navigation, the real 30-day CPI example with bid/ask and outcome, and the empty seven-day state with ten recorded exclusions. The browser guest has no holdings; relevance for the existing 25-holding portfolio was checked through the service and individual stock/ETF filtering through tests. Themes with no data show missing-history states. Price changes remain optional context from the existing 24-hour history and do not score investment performance.

## Holdings-linked event history (2026-10-10)

All 144 Vitest tests, strict TypeScript checks and the Next.js production build pass in the Node 24 container.

Added a separate current-holdings history tab, grouped contract outcomes, verified release sources, aligned holding/SPY close comparisons, explicit missing-data states and event-page navigation. Tests cover return arithmetic, pre-open timing across DST/weekends, incomplete/future/intraday windows, missing benchmark/stock dates, session ownership, unowned-symbol filters, subject matching, post-release quote labeling and unsupported market hours. The original calibration and trust paths remain unchanged.

Live validation of the 25-holding portfolio found 49 linked inflation event identifiers; the newest twelve include eight supported comparisons across three BLS release dates. The September 11 example uses September 10 and September 11 closes for both TLT and SPY. Migration 005 and release seeding completed without changing settled probabilities or outcomes. Broader release-time discovery and exchange holiday calendars remain future work.

## Moves: column help and events inside the row (2026-10-10)

All 430 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors, no sideways page scroll, no control under 44 pixels.

- **Column help.** Each of the eight column names has an "i" button (30 by 44 pixels around a
  17-pixel mark). Its explanation opens on hover and on keyboard focus, closes on leaving and on
  Escape, and stays inside the window at both widths.
- **A driver's events open in its row.** For USO over the week, "See all 47 events" opens 36
  whose odds moved and 11 that settled, linked through crude oil, under the row; the page does
  not scroll, opening another row closes the first, and the same list opens under a bar of
  "What mattered most". Six of each show at first.
- **No Data availability column.** Every row said the same thing. A row now carries a note only
  for what it alone lacks. For a week ending 2026-09-18 the reason the market split is missing
  is said once above the table instead of in 13 rows, and it is now the real reason (the stored
  measurement includes later prices) and not the one for a holding short of history.

## Moves over a window, for the portfolio, a category or one holding (2026-10-10)

All 420 tests and both TypeScript checks pass. Checked in a headless browser at 1440 and 390
pixels with the feature-tour portfolio in a temporary guest session, cleared afterwards: no
browser errors, no sideways page scroll, no control under 44 pixels.

- **Windows.** For the latest session (2026-10-09) the windows open on 10-08, 10-02, 09-09 and
  07-09. On the 13 listed securities ($90,000 now): +$152.27, +$651.70, −$870.78 and +$140.82.
  In each, the rows add up to the totals, change = value at the last close − value at the first,
  and market + beyond = change, to the cent.
- **The value entered is read as of the latest close.** This replaces return × entered value: on
  a 10% rise a $1,000 holding was worth $909.09 before and gained $90.91, not $100. The two
  agree to within the square of the return, so a day's figures move by cents.
- **One holding.** XOM over the week: $9,708.18 to $10,000.00 (+$291.82), $43.74 from the stock
  market, $20.97 the estimate through crude oil (+0.81%); 25 settled events and 91 with odds
  that moved are linked to it.
- **Wide quotes are not compared.** Before the rule, the day's biggest "moves" were a MacBook
  price market at 96% to 45% and a mortgage-rate market at 4.5% to 57.5%: one side of an empty
  book stepping back. Over one day of our own snapshots, 10 of 3,952 markets quoted within ten
  cents at both ends moved 20 points or more, against 95 of 1,966 with a wider quote at either
  end. With the rule the day lists 84 events (203 markets) instead of 160 (802), led by diesel,
  WTI and CPI markets.
- **Candlestick spreads.** Migration 014 adds the column; the job refetched every stored
  candlestick with its spread in about four minutes (420,766 hourly, 406,460 daily, none left
  without). Hourly closes are now kept twelve days, and the four extra days were fetched once
  (192,615 readings), so a week's first reading is the 4:00 pm close and not the midnight
  before. The database grew from 459 MB to 510 MB.
- **Settled odds are not filtered by spread** (the backfill keeps only the midpoint). Across
  the 12,539 settled markets they are well calibrated at the extremes: 13 of 5,362 given 3% or
  less happened, and 1,775 of 1,788 given 97% or more did.
- **Speed.** A request takes 0.6 to 0.8 s once connections are warm, most of it the odds
  lookup. Bounding each close lookup to 30 days cut the price query from about 1 s to 0.045 s:
  the prices table has 523 weekly chunks and an unbounded lookup opened all of them. The
  response is 108 kB for a day and 571 kB for three months (382 settled events).
- **Not available.** The 2-year and 10-year yields for 10-09 are not published yet, so rate
  links show no estimate for windows ending that day. For a window that ends before the latest
  session the market split is unavailable, as before: measurements that include later prices
  are not used.

## Link floor at a tenth, and job locks that cannot be left behind (2026-10-10)

All 378 tests and both TypeScript checks pass. The password-hashing test again exceeded its
five-second limit once while the stack was busy and passed on the next run.

- **Floor lowered from a fifth to a tenth**, by decision. On the stored portfolio the Oil theme
  is now TLT, XOM, DAL, GLD, ITB, UAL and USO, naming XOM and USO as the holdings it matters
  most to; JPM, at 6%, stays out. Measured links rose from 1,419 to 2,316 and a typical
  Overview row holds seven holdings. Three links sit within a point of the line (ITB to oil,
  NFLX to each Treasury yield), so they can come and go as measurements refresh; the evidence
  shows the share to one decimal so that 9.8% does not read as the 10% floor.
- **Job locks.** Against the live database, a session holding a test lock with a four-second
  idle timeout was ended by the server and its lock freed within seven seconds; one sending a
  statement every 1.5 seconds kept its lock for nine. With the new code running, the sessions
  holding the poll and price-history locks each sent their heartbeat within a 38-second watch,
  odds kept being stored, and no pooled connection was dropped. A backend still running older
  code can leave a lock behind as before.
- **Backfill.** Interrupted twice by rebuilds and resumed each time; it had finished 146 of
  515 series before the first. Five series failed once and are retried on the next pass.

## Empty books, the link floor and the track-record backfill (2026-10-10)

All 374 tests and both TypeScript checks pass; the stack was rebuilt on each change. One run
had a password-hashing test exceed its five-second limit while the stack's jobs were busy; the
next run passed and the test is unrelated to these changes.

- **Empty order books.** Of 894 markets with a recent reading, 56 had no bid and no offer and
  were shown at 50%. After the change the stored portfolio's 4,813 linked markets include 151
  with no probability; the 31 still at exactly 50% have real two-sided quotes.
- **Link floor.** Of 30 lesser measured links across held tickers, none fell between 16% and
  22% of its holding's biggest, so the floor is 20%. On the stored portfolio the Oil theme went
  from eight holdings to two (XOM, USO), Fed rates from 13 to 9, and a typical Overview row from
  about ten holdings to six. 1,352 links are now Topic links whose evidence states the measured
  share, for example "DAL: a typical move in CL=F moves DAL about 11% as much as a typical move
  in SPY". A browser run showed the Oil choice as 2 of 17 holdings on the Overview, Calendar and
  Moves alike, and no browser errors.
- **Stored portfolio.** Its SAVINGS, TNOTE-2036, CORP-2031 and HOME rows had been saved as
  stocks by an import made before the CSV carried asset types. It was re-saved from
  `examples/feature-tour.csv` through the server's own validation, after checking that the
  stored symbols and values matched the file: 13 securities and 4 others, same $425,000.
- **Backfill.** Still running when this was written. After 85 of 515 series it had raised the
  track record from 127 settled markets, none with a series, to 1,209, of which 1,082 carry
  their series (30 series, 103 events; table size 368 kB). The quote read at the 24-hour mark
  was a median of 1.0 hour old and 21 hours at the 90th percentile. Whole series of daily
  markets were skipped as listed for under a day. Final counts are not yet known.

During this work no odds were stored between 17:57 and about 18:58 UTC: a backend that started
at 17:57 took the shared poll lock and stopped, and its database session stayed open, so every
other backend skipped polling. The session was dropped without intervention and polling resumed.
Nothing in the code prevents a recurrence.

## Categories, link explanations and the merge with brokerage sync (2026-10-10)

Local main was merged with origin/main (brokerage sync, AI cache, reload buttons, hourly price
job). Five files conflicted and each kept both sides; the merged code passed 327 tests and both
TypeScript checks before anything else was added.

On top of the merge: holdings are grouped by asset class and by event theme, the Overview shows
the groups as cards in one row that scrolls sideways, one category choice is shared by the
Overview, Calendar and Moves, and a chip naming a link type opens an explanation beside it.
All 361 tests, both TypeScript checks and the production build pass.

Live checks used the feature-tour portfolio in a temporary guest session, cleared afterwards,
in headless Edge at 1440 and 390 pixels:

- Asset classes: Property $300,000 (70.6%), Stocks $70,000 (16.5%, ten holdings), Bonds
  $25,000, Cash $20,000, Commodities $10,000 (GLD, USO). Shares add up to 1.000000. Each
  holding's basis came from Yahoo (XOM Energy, TLT Long Government fund, USO Commodities Focused
  fund, SPY Large Blend fund) or from the type entered.
- Event themes: seven groups. Oil holds eight holdings worth $55,000 and names XOM and USO as
  the ones it matters most to; Mortgage rates names HOME; Fed rates names the cash and bonds.
  The Bonds card's next event is a Treasury-yield market, not the sooner diesel-price market
  TLT is only faintly tied to.
- The cards sit in one row (same top edge for all); arrows and the note "scroll sideways for
  more" appear only when cards are off to a side, and the arrow moved the row.
- Choosing Oil on the Overview narrowed its table to 124 of 366 events and 8 of 17 holdings,
  and the Calendar and Moves opened with the same choice and the same summary ($55,000, 12.9%).
  On Moves the chosen holdings' move, $125.46, equals the sum of the eight rows shown, as do
  its market ($214.09) and beyond-market (-$88.63) parts.
- Pointing at Direct, Calculated and Related each opened one explanation below the chip,
  wholly inside the window; keyboard focus opened it too. No browser errors; no sideways page
  scroll at 390 pixels.

One run made during the minute after a backend restart showed the Oil group with four, five
and then six holdings on successive screens: the measurement job was rewriting its rows at
that moment. A run after it finished showed eight on all three screens.

Not verified: brokerage sync itself (no SnapTrade credentials are configured here), and
holdings that arrive through it, which are classified by the same rule but were not exercised.

## Paginated outcomes and expandable history (2026-10-10)

Event details show five outcomes per page. Each outcome independently opens its own history
chart; opening or closing one does not close the others. Expansion choices are remembered
while paging within the event. Each visible chart has independent range controls and a unique
SVG gradient identifier. A link to a specific market opens that market on the correct page.
The trust breakdown names the outcome it describes.

All 254 tests, both workspace TypeScript checks and the frontend production build pass.
The frontend was rebuilt and recreated. Live Chrome checks used an isolated AAPL guest
portfolio, cleared afterwards: a 17-outcome S&P event produced four pages (5/5/5/2), two
charts stayed open together with different ranges, closing one preserved the other, expansion
survived paging away and back, and a direct link selected the final market on page four.
Screenshots were inspected at desktop and 320-pixel width; checks at 390 and 320 pixels found
no horizontal page overflow or browser JavaScript errors. API probabilities are unchanged.

## Event history, frontend checks and storage (2026-10-10)

The event chart now reads one selected market through `/odds/:ticker`, with day, week,
month and all-time ranges. Migration 012 and the first candle backfill are present in the
running database. All 254 tests and both workspace TypeScript checks pass in Node 24;
the frontend production image builds successfully.

### Browser checks

Checked the rebuilt, running frontend in Chrome against the real API using an isolated
guest session, then cleared its holdings. Importing `examples/feature-tour.csv` saved all
17 positions (13 securities and four other asset types), totaling $425,000.

- The overview renders the imported portfolio and wrapping holding tiles.
- Earnings lists five dated calls (JPM, UAL, NFLX, TSLA and AAPL). Company search, outcome
  search and pagination work. Apple's 23 outcomes span three pages at ten per page;
  searching for iPhone reduces them to one. The page fits at 390 pixels wide.
- The Apple monopoly event (`APPLEUS-29DEC31`) returns 93 day, 101 week, 31 month and
  775 all-time readings. Its longest history starts March 27, 2024. The displayed latest
  probability matches the response (26.5% at this check) on all four ranges. Paths use
  horizontal/vertical steps, and pointer tooltips render.
- Switching outcomes on the JPM CEO event loads the newly selected market's history.
- Event details fit at 1440, 390 and 320 pixels wide, without horizontal page overflow.
  A minimum chart canvas width had shrunk axis labels and offset hover coordinates on
  the narrowest screen; it now follows the actual available width. After rebuilding and
  recreating the frontend, its 238-pixel plot uses a 238-pixel canvas at a 320-pixel viewport.
- No browser JavaScript errors occurred. Screenshots were inspected; temporary browser
  artifacts stay in ignored `.cache/ui-tests`.

### Measured storage

Read-only queries against Tiger Data at **15:10 UTC on October 10** measured allocated
table and index space, not a cloud bill. MiB means 1,048,576 bytes.

| Data | Rows | Allocated storage, including indexes |
| --- | ---: | ---: |
| Hourly and daily candles (`odds_candles`) | 820,371 | 129.77 MiB |
| Candle collection progress (`candle_progress`) | 15,818 | 2.15 MiB |
| Five-minute snapshots, including all Timescale chunks | 540,526 | 142.86 MiB |
| Whole database, including the tables above | — | 428.95 MiB |

The candle table contains **413,911 hourly readings** across 7,186 markets and **406,460
daily readings** across 7,008 markets. Daily history reaches October 24, 2023. All 7,909
currently eligible markets have collection progress for both intervals; some return no
usable quotes. The table itself occupies 60.30 MiB and its primary-key index 69.47 MiB.

This is mainly an initial history load. Hourly readings roll off after eight days. Daily
readings stay while a market remains eligible; cleanup allows a day after market close.
The latest complete daily period contributed 5,966 readings. At the current allocated
average of about 166 bytes per candle including its index, that is approximately **0.94
MiB per day** of additional daily history before cleanup, or **1.25 MiB per day** if every
one of the current 7,909 markets produced a daily candle. These are planning estimates,
not measured net disk growth: new listings, quote activity, index occupancy, vacuum and
reusable space can change the result. Deleting expired rows does not immediately shrink
PostgreSQL's allocated files. No Tiger Data dollar price is inferred from these sizes.

Sizes came from `pg_database_size`, `pg_table_size`, `pg_indexes_size`, and
`pg_total_relation_size`. Snapshot storage used `hypertable_detailed_size('odds_snapshots')`
so its chunks were included rather than just its small parent table.

## Earnings screen rebuilt to the design (2026-10-10)

All 221 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migration 011 applied; one poll filled strike values for 75,638 markets.

Checked against the running app with the 25-holding example portfolio in a temporary guest session, cleared afterwards:

- **Who is listed.** 12 of 25 holdings have an earnings call Kalshi has dated, soonest first: JPM and GS on Oct 13 through COST on Dec 10. Holdings without one, such as XOM, are not listed.
- **Call dates.** Netflix, Mastercard and United now show Kalshi's stated days (Oct 20, Oct 29, Oct 14) instead of the occurrence times they carried (Nov 4, Nov 13, March 31, 2027). JPM reads "before the market opens" and AAPL "after the close"; Tesla, Amazon and Alphabet, which carry Kalshi's default 10:00 am, show the day only.
- **Lead metric.** Apple headcount in 2026: levels at 92%, 86%, 67%, 44%, 15%, 17%, with even odds between 168,000 and 170,000. United passengers flown in 2026: between 186 million and 188 million. Netflix headcount skips the 17,500 level, whose quote straddles 50%.
- **Results only.** Apple shows two events, its earnings call and headcount; its product, lawsuit and price markets are no longer on this screen.
- **Call topics.** Apple: 17 words, led by "iPhone 18" at 92.5%.
- **Past moves.** Apple's typical move over its last eight reports is 3.1%, which is $310.82 on a $10,000 position.

Browser validation was completed in the event-history checks above. Not built, as agreed:
year-ago values from filings.

## Full database, read-only mode and odds storage (2026-10-10)

The shared Tiger Data service reached 2,965 MB and turned read-only; 2,815 MB of it was 17 hours of odds history (9.9 million rows, about 141,000 per poll). The backend then crash-looped at startup because applying migrations writes.

- **Read-only mode.** The backend now starts on a read-only database, serves stored data and reports it. Checked live: `/health` returned `readOnly: true`, pages loaded, and an attempted save returned "The database is read-only right now, so changes cannot be saved."
- **Cleanup, approved by the user.** In one transaction, the 500,993 rows for the 8,137 markets in linkable series were kept, 9,424,657 others were deleted, and migration 010 was applied. The database is 282 MB. The kept history covers its full original range.
- **Guard.** A rolled-back test insert was accepted for a linked market and rejected for an unlinked one. The first poll afterwards stored 7,906 odds rows while updating details for all 148,908 markets.
- **Dropped connections.** When Tiger Data lifted the read-only flag it closed open connections and the server exited on the unhandled pool error. Docker restarted it; a pool error listener now keeps it running.

All 191 tests and strict TypeScript checks pass. Not yet observed: the compression and retention policies acting on a chunk, which happens after a day and after eight days.

## Asset types, rate drivers and "what matters most" (2026-10-10)

All 188 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migrations 008 and 009 applied to the shared database.

Checked against the running app with a temporary guest portfolio of ten holdings (AAPL, XOM, TLT, SPY, an oil fund, a real-estate fund, cash, a Treasury note, a corporate bond and a Florida property), cleared afterwards:

- **Drivers ranked.** TLT moves 15.7% per point of the 10-year yield, close to its duration, and that yield ranks first for it (typical daily effect 0.84% against 0.09% for the stock market). Crude oil ranks ahead of the stock market for XOM (0.78% against 0.42%) and for the oil fund (2.07% against 0.15%). AAPL has only the stock market.
- **Measurement fixes.** With the negative crude close of 2020-04-20 excluded, XOM's oil coefficient is 0.266. SPY no longer carries links to oil or rates.
- **Calculated figures.** $50,000 of cash: $500 a year per point of rate. A $10,000 4% note maturing 2036: modified duration 7.85 years at the 5.22% 10-year yield, so $785.44 per point. A $200,000 adjustable mortgage: $2,000 a year per point. An invalid maturity is rejected.
- **Property.** The Florida property linked to 15 events: mortgage-rate markets (calculated) and national housing markets (no number). It did not link to Canadian or other states' housing markets.
- **Moves.** Opens on the latest completed session. Totals reconcile (176.66 = 209.83 − 33.17), state the $470,000 with no daily price, and name the two yields FRED had not yet published. On 2026-10-07 crude oil (−$121.26) outweighed the stock market (−$84.01).
- **Speed.** The snapshot lookup was running for every market in the table. Filtering first cut the exposure request from about 31 seconds to 3, and Moves from timing out to under 5.

Not verified: the screens in a browser. Driver estimates on Moves overlap and are compared, not summed; the page says so.

## Earnings filters, link accuracy, event dates and report dates (2026-10-10)

All 156 tests and strict TypeScript checks pass in a Node 24 container, and the Next.js production build succeeds. Migrations 004 to 007 applied to the shared database on restart.

Checked against the running app with the 25-holding example portfolio in a temporary guest session:

- Withdrawing 103 incorrect mappings reduced linked events from 622 to 425. DAL, BAC and XOM each keep one company event (previously 23, 5 and 25).
- Apple's 17 earnings-call outcomes are classified as call mentions (none were before). Two S&P 500 range ladders now qualify for scaling; the first has 27 outcomes with a raw midpoint sum of 101.5%.
- 421 of 425 linked events carry a Kalshi event date. The 14-day calendar holds 73 events by event date against 70 by market close.
- With `SEC_USER_AGENT` unset, the earnings response returns no history and says why. With it set, the earnings-dates job loaded report dates from live EDGAR for 23 of the 25 holdings (SPY and TLT file none). Apple's and JPMorgan's last eight match their results days, and each move reconciles with the stored closes. XOM has one report because its ticker now maps to a new registrant (see SOURCES.md).

Not verified: the screens in a browser. `git fetch` could not authenticate from the agent's shell, so the merge used the local copy of origin/main at a5b17b3.

Known issues found in review and not changed here: the Moves market split is unavailable for completed sessions, one extreme crude-oil return in April 2020 distorts oil coefficients, and each poll stores about 140,000 odds rows with no retention policy.

## Subject evidence and event context (2026-10-09)

All 122 tests, strict TypeScript checks and the production build pass. Migration 004 applied locally and identity recovery verified all 127 stored observations: 126 inflation contracts across 49 event identifiers and one interest-rate contract in one event. Company and stock-market subject views correctly report no verified history. Stored probabilities and outcomes are not changed by identity recovery.

Added subject-level comparisons using reviewed series tags, while preserving category-level trust calculations. A known-answer test verifies inflation and Fed observations stay in their matching views and two contracts in one event count as one identified event. Identity recovery is tested to update only metadata and ignore unrequested markets. The UI keeps the existing chart and calculation details, adds subject selection and a focused portfolio event with explicit stored link evidence.


## Plain-language track-record view (2026-10-09)

The default view leads with evidence size and average probability/outcome gap, an around-70% comparison with a small-sample warning, four actual outcomes, and relevant current portfolio events. Chart, Brier score, bucket counts and full observation timestamps are collapsed under details. Category filter wording and an all-categories-relevant message explain identical filtered views. The rendering check verifies the comparison, outcome labels and closed detail sections. No forecasting math or source observations changed.


## Track-record evidence feature (2026-10-09)

The page now explains forecasting history separately from portfolio returns, exposes category sample sizes and date ranges, renders calibration-group counts and recent settled observations, and filters categories using session-scoped reviewed portfolio tags. Added known-answer aggregation and rendering tests cover absent history, portfolio relevance, a two-market Brier score of 0.29, the 30-market eligibility threshold, twelve-example limits and evidence timestamps. The expanded CSV reuses the repository’s 25-symbol demo allocation.

Live database initially contains no settled observations. A backfill of the three approved company series returned no usable exact 24-hour quotes for the settled ExxonMobil sample. No synthetic history was inserted.


## Base merge for morning briefing (2026-10-09)

Merged origin/main at dee8f81 into feature/morning-briefing. Briefing routes now live in createApp alongside account middleware; authenticated and guest portfolio ownership and write protections are preserved. Session cleanup remains scheduled alongside independent morning briefing retries. All 116 tests, TypeScript checks and the production build pass, including briefing-specific account isolation and cross-site/stale-session write rejection.


## Focused briefing and refresh (2026-10-09)

The spoken script prioritizes the completed-session takeaway and one event. A session-scoped refresh endpoint and overview button regenerate the current day while retaining cached audio after failures. Audio browser caching is disabled. All 80 tests, TypeScript checks and the production build pass, including explicit refresh before the scheduled time and bypassing the daily cache.


## Conversational briefing update (2026-10-09)

The script now uses an opening takeaway, explanatory transitions, holding-specific watchlist context, spoken dates/times and directional dollar amounts. Existing tests verify the completed-session amounts, omission of stale quotes, missing data and numeric validation with the new wording. All 79 tests, TypeScript checks and the production build pass.

## Morning briefing feature (2026-10-09)

The morning briefing uses the latest stored SPY session before today's New York date, explicitly dates the move, selects this week's top linked events with a nearest-upcoming fallback, and omits stale single-outcome odds. Generation begins at 8 a.m. New York with independent hourly retries and startup catch-up. Per-session/day advisory locks prevent overlapping voice requests. Existing daily audio remains cached. Text and audio endpoints share the New York date.

Validation: 79 Vitest tests pass, including six content/timezone tests and four job tests for prior-session selection, the morning cutoff, cached audio, concurrent generation and retry after a voice failure. Strict TypeScript checks and the Next.js production build pass in an isolated Node 24 container using the project's installed dependencies. No new dependencies or migrations are required.

Snowflake tagging, expanded company/sector coverage, continuous hosting and historical earnings-report moves are outside this feature. Current briefings honestly report unavailable prices or market associations; this change does not certify those separate integrations.


## Current migration: Snowflake Cortex (2026-10-09)

Gemini has been replaced with Snowflake Cortex REST completions for series tagging and supplied
filing risk factors. Optional Cortex Search supplies source passages for summaries. No Snowflake
account credentials have been supplied, so live AI authentication, model availability and index
queries remain unverified. Tiger Data/PostgreSQL remains the application database.

The 45-test Vitest suite passes, including provider request/response contracts, configuration,
sanitized failures, malformed output, fixed tags, batch isolation, filing caching, retrieved
citations and the existing numeric guard. Tests use mocked Snowflake responses, not live calls.
The rebuilt images pass backend/frontend TypeScript checks, the core accuracy checks and the
Next.js production build. Migration `002_snowflake_tags.sql` applied successfully; a rolled-back
temporary-table check verified that legacy Gemini/manual tags retain their review flags and new
Snowflake tags are accepted. The rebuilt frontend and proxied database health endpoint return HTTP
200. The private `.env` stays ignored by Git. Docker now installs the committed lockfile with `npm ci`.

Yahoo history loading worked locally before this change. Kalshi connections reset from both Windows
and Docker. `npm ci` reports five dependency vulnerabilities in the current lockfile; this migration
does not upgrade unrelated dependencies or certify production security.

The original phase log below describes the earlier offline build environment. Its npm, Docker
and Git blockers are historical, not the current local setup. References to Gemini describe
the superseded provider; `DEPLOY.md` contains current credentials and integration instructions.

## Original phase log

Checked before creating app files: AGENTS.md, message.txt, hedgehog_math.py, the eleven-page Hack Knight build-plan PDF, and all seven design PNGs. Read the full text and inspected every design. Original inputs are preserved.

## Checks that passed

- `npm run check:core`: executable assertions cover valid/invalid dollar midpoints, missing quotes, reliable and unreliable ranges, Brier 0.25, calibration buckets including p=1 and weighted misses, trust edge cases and rescaling, missing-data trust, source URL filtering, AI numeric validation, fixed tag filtering, link downgrading, date alignment and cent-based move reconciliation.
- Strict TypeScript check of the frontend and shared types with a recovered cached TypeScript 5.9.3 compiler and cached React/Node type packages. This was a manual compiler invocation, not a successful npm installation or Next build.
- Server rendering smoke checks with recovered cached React/ReactDOM: all seven screen components render their initial states, display a heading, include no fabricated market data, and the shell includes the required footer. This is not browser interaction, responsive screenshot validation or a test of populated live screens.
- TypeScript syntax transpilation of app source files completed without syntax diagnostics. The final backend compiler attempt reports only missing SDK/math/scheduler dependencies; their APIs cannot be fully type-checked until installed.

Temporary recovered tools stayed in /tmp; they are not vendored into this repository.

## Checks blocked

- `npm install`: EAI_AGAIN for registry.npmjs.org in this shell. Retried with a writable cache and zero fetch retries; no dependency lockfile could be generated.
- `npm test`: Vitest unavailable. Known-answer synthetic regression tests are written but not executed. They must pass before using measured links in a live demo.
- `npm run lint` and `npm run build`: workspace TypeScript binaries unavailable through npm; Next and backend SDKs are not installed. The manual frontend check does not certify either build.
- Docker CLI: Docker Desktop WSL integration is unavailable. Compose images, migrations and service health checks have not run here.
- Live data: no configured DATABASE_URL or private API credentials. No honest three-market sample, ten-year-history count, reliable/unreliable live link, grounded Gemini summary or ElevenLabs playback can be demonstrated yet.
- Git: the supplied .git is not a functioning repository and is protected by the environment. No phase commits were created.

## Phase inventory

| Phase | Code prepared | Finish line still to verify |
| --- | --- | --- |
| 1 Foundation | Workspaces, migrations, Timescale hypertables, idempotent price upserts, five-minute/startup poller, scheduler | Installed dependencies, migrated database, populated ten-year series, three stored quote samples |
| 2 Matching | Response types, restricted Gemini tags, review/approve commands, human sector seed, holdings/session API, exposure and both views | Human sector table and tag review; five live tickers linked correctly |
| 3 Events/trust | Trust formula/edge tests, calendar, event distribution/history, grounded summaries with guards | SDK compatibility and live source-linked summaries/trust |
| 4 History/math | Math port, required Vitest tests, resumable settled backfill, category statistics, nightly reliable regressions | Regression tests first, then real category sample and hand-checkable live links |
| 5 Moves/earnings | Cent-reconciled move split, source-backed daily odds moves, normalized exclusive brackets, views | Real close history; free past report-date source remains unresolved |
| 6 Voice/portability | Exact template, numeric guard, official SDK MP3 cache, player, Docker/Compose, deploy guide | Voice credentials/audio validation and Docker execution; public deployment not performed |
| 7 Accuracy | Fail-closed empty states, no UI fixture data, NUMBERS.md and core guards | Full live data and browser audit |
| 8 Submission | README and cautious submission draft | Human editing, eligibility/track decisions, demo recording and publication |

Implementation proceeded sequentially through the planned code areas, but infrastructure-blocked finish lines were not treated as passed. Questions and assumptions are in questions.txt. Sector mappings are intentionally empty because the supplied instructions assign that judgment to a person. Automatic filing acquisition and optional AI briefing smoothing are not implemented. The two-panel design layout and tokens are used throughout; unavailable report histories and reminder functionality are not represented as working features.
