"""
Hedgehog math: turning Kalshi prices into dollar gains/losses for a portfolio.

Inputs you get from Kalshi (prices in dollars, 0.00-1.00):
  - live quote: GET /markets/{ticker} -> yes_bid_dollars, yes_ask_dollars
  - history:    GET /series/{series}/markets/{ticker}/candlesticks (or batch GET /markets/candlesticks)
Inputs you get elsewhere: daily stock closes (e.g. yfinance), including SPY.

Two kinds of numbers come out of this file:
  EXACT     - anything about the Kalshi contract itself (cost, payout, fee, P&L)
  ESTIMATED - anything about how a stock reacts to the event (needs a sensitivity)
"""
import math
import numpy as np


# ---------- EXACT: the contract ----------

def implied_prob(yes_bid, yes_ask):
    """Market's probability = midpoint. A wide spread means the number is less trustworthy."""
    return (yes_bid + yes_ask) / 2, yes_ask - yes_bid


def kalshi_fee(contracts, price, rate=0.07):
    """General taker fee: round_up(0.07 * C * P * (1 - P)) to the next cent.
    Some products have their own schedule; check the market before trusting this."""
    raw = rate * contracts * price * (1 - price)
    return math.ceil(round(raw * 100, 6)) / 100


def contract_outcomes(contracts, price, side="yes"):
    """Dollar result of buying `contracts` at `price` (dollars), after the entry fee."""
    fee = kalshi_fee(contracts, price)
    win = contracts * (1 - price) - fee   # contract settles at $1.00
    lose = -contracts * price - fee       # contract settles at $0.00
    if side == "yes":
        return {"cost": contracts * price + fee, "if_yes": win, "if_no": lose, "fee": fee}
    return {"cost": contracts * price + fee, "if_yes": lose, "if_no": win, "fee": fee}


def mark_to_market(contracts, entry_price, yes_bid_now):
    """What the position is worth vs. what you paid, if you sold at the current bid (exit fee not included)."""
    return contracts * (yes_bid_now - entry_price)


# ---------- ESTIMATED: how a stock reacts ----------

def estimate_sensitivity(stock_returns, prob_changes, market_returns=None):
    """Regress daily stock returns on daily changes in the market's probability.
    Returns (b, standard_error). b = stock return per +1.00 change in probability.
    Pass SPY returns as market_returns so b isn't just 'the whole market moved'."""
    y = np.asarray(stock_returns, dtype=float)
    cols = [np.ones_like(y), np.asarray(prob_changes, dtype=float)]
    if market_returns is not None:
        cols.append(np.asarray(market_returns, dtype=float))
    X = np.column_stack(cols)
    coef, *_ = np.linalg.lstsq(X, y, rcond=None)
    resid = y - X @ coef
    dof = max(len(y) - X.shape[1], 1)
    cov = (resid @ resid / dof) * np.linalg.inv(X.T @ X)
    return coef[1], math.sqrt(cov[1, 1])


def check_sensitivity(b, se, days, min_days=60):
    """Turn a regression result into something safe to show users.
    reliable = enough history AND the 95% range doesn't cross zero.
    If not reliable, the app shows 'no measurable link', never a dollar number."""
    low, high = sorted((b - 1.96 * se, b + 1.96 * se))
    return {"b": b, "low": low, "high": high, "days": days,
            "reliable": days >= min_days and (low > 0 or high < 0)}


def scenario_range(D_low, D_high, p):
    """Dollar range for each outcome, from the low and high ends of the sensitivity."""
    return {"if_yes": sorted((D_low * (1 - p), D_high * (1 - p))),
            "if_no": sorted((-D_low * p, -D_high * p))}


def dollar_sensitivity(holdings):
    """holdings: list of (position_value_dollars, b). Returns $ change per +1.00 in probability."""
    return sum(value * b for value, b in holdings)


def scenarios(D, p):
    """The stock price already reflects today's probability p, so only the *surprise* moves it.
    If YES the probability jumps from p to 1; if NO it drops from p to 0."""
    return {
        "if_yes": D * (1 - p),
        "if_no": D * (0 - p),
        "odds_weighted": p * D * (1 - p) + (1 - p) * D * (0 - p),  # always 0: already priced in
        "typical_swing": abs(D) * math.sqrt(p * (1 - p)),           # one standard deviation, in $
    }


def full_hedge(D):
    """One Kalshi contract changes value by $1 per +1.00 in probability, so it hedges $1 of D.
    D < 0 (you lose if YES): buy YES. D > 0 (you lose if NO): buy NO."""
    return ("yes" if D < 0 else "no"), round(abs(D))


if __name__ == "__main__":
    p, spread = implied_prob(0.37, 0.39)                     # oil > $90 market
    # ILLUSTRATIVE ONLY. In the app every b comes from estimate_sensitivity on real
    # history and must pass check_sensitivity before any dollar number is shown.
    holdings = [(4000, -0.10), (3600, +0.08)]                # DAL, XOM
    D = dollar_sensitivity(holdings)
    s = scenarios(D, p)
    side, n = full_hedge(D)
    h = contract_outcomes(n, 0.39 if side == "yes" else 1 - 0.37, side)  # buy at the ask

    print(f"probability {p:.2f} (spread {spread:.2f})")
    print(f"dollar sensitivity D = {D:+.2f} per +1.00 probability ({D/10:+.2f} per 10 pts)")
    print(f"today's 16-pt move cost you about {D*0.16:+.2f}")
    print(f"if YES {s['if_yes']:+.2f} | if NO {s['if_no']:+.2f} | odds-weighted {s['odds_weighted']:+.2f} | typical swing ±{s['typical_swing']:.2f}")
    print(f"hedge: buy {n} {side.upper()} -> cost {h['cost']:.2f} (fee {h['fee']:.2f})")
    print(f"with hedge: if YES {s['if_yes'] + h['if_yes']:+.2f} | if NO {s['if_no'] + h['if_no']:+.2f}")
