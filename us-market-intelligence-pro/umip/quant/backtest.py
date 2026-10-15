"""Bar-by-bar backtester for underlying-level candidates.

Honesty rules baked in:
- Strategy sees bars[: i+1]; fills are simulated starting at bar i+1 (no
  same-bar look-ahead).
- Entry only if a later bar trades inside the entry zone before the signal
  expires; otherwise the signal is EXPIRED (not a win, not a loss).
- If stop and target are both inside one bar, assume the STOP hit first.
- Costs: per-side slippage in bps plus fixed fee in bps.
- Open trades are closed at the session's last bar (no overnight holding).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from umip.market_data.base import Bar
from umip.quant.strategies import Candidate, Strategy
from umip.timeutil import NY


@dataclass
class Trade:
    candidate: Candidate
    outcome: str  # target1 | target2 | stop | eod | expired
    entry: float | None = None
    exit: float | None = None
    r_multiple: float = 0.0
    ret: float = 0.0  # fractional return on underlying after costs
    mae_r: float = 0.0
    mfe_r: float = 0.0


@dataclass
class Costs:
    slippage_bps: float = 2.0
    fee_bps: float = 0.5

    def adj(self, price: float, side: int) -> float:
        """side=+1 buying, -1 selling."""
        return price * (1 + side * (self.slippage_bps + self.fee_bps) / 1e4)


def simulate(candidate: Candidate, future: list[Bar], costs: Costs) -> Trade:
    c = candidate
    sign = 1 if c.direction == "long" else -1
    deadline = c.detected_at + c.valid_for
    entry = None
    risk = abs((c.entry_low + c.entry_high) / 2 - c.stop)
    mae = mfe = 0.0
    day = c.detected_at.astimezone(NY).date()
    last_px = None
    for b in future:
        if b.ts.astimezone(NY).date() != day:
            break
        last_px = b.close
        if entry is None:
            if b.ts >= deadline:
                return Trade(c, "expired")
            if b.low <= c.entry_high and b.high >= c.entry_low:
                entry = min(max(b.open, c.entry_low), c.entry_high)
            else:
                continue
        adverse = (entry - b.low) if sign > 0 else (b.high - entry)
        favorable = (b.high - entry) if sign > 0 else (entry - b.low)
        mae, mfe = max(mae, adverse / risk), max(mfe, favorable / risk)
        hit_stop = b.low <= c.stop if sign > 0 else b.high >= c.stop
        hit_t2 = b.high >= c.target2 if sign > 0 else b.low <= c.target2
        hit_t1 = b.high >= c.target1 if sign > 0 else b.low <= c.target1
        if hit_stop:
            return _close(c, "stop", entry, c.stop, costs, sign, risk, mae, mfe)
        if hit_t2:
            return _close(c, "target2", entry, c.target2, costs, sign, risk, mae, mfe)
        if hit_t1:
            return _close(c, "target1", entry, c.target1, costs, sign, risk, mae, mfe)
    if entry is None:
        return Trade(c, "expired")
    return _close(c, "eod", entry, last_px, costs, sign, risk, mae, mfe)


def _close(c, outcome, entry, exit_, costs, sign, risk, mae, mfe) -> Trade:
    e = costs.adj(entry, sign)
    x = costs.adj(exit_, -sign)
    ret = sign * (x - e) / e
    return Trade(c, outcome, entry, exit_, sign * (x - e) / risk, ret, mae, mfe)


def run(strategy: Strategy, symbol: str, bars: list[Bar], costs: Costs = Costs()) -> list[Trade]:
    trades: list[Trade] = []
    busy_until = None
    for i in range(len(bars) - 1):
        if busy_until and bars[i].ts < busy_until:
            continue
        cand = strategy.evaluate(symbol, bars[: i + 1])
        if cand is None:
            continue
        t = simulate(cand, bars[i + 1:], costs)
        trades.append(t)
        busy_until = cand.detected_at + cand.valid_for
    return trades


@dataclass
class Metrics:
    n_signals: int
    n_trades: int
    n_expired: int
    win_rate: float
    avg_win_r: float
    avg_loss_r: float
    profit_factor: float
    expectancy_r: float
    max_drawdown_r: float
    total_r: float
    by_outcome: dict = field(default_factory=dict)


def metrics(trades: list[Trade]) -> Metrics:
    filled = [t for t in trades if t.outcome != "expired"]
    wins = [t.r_multiple for t in filled if t.r_multiple > 0]
    losses = [t.r_multiple for t in filled if t.r_multiple <= 0]
    gp, gl = sum(wins), -sum(losses)
    eq = peak = dd = 0.0
    for t in filled:
        eq += t.r_multiple
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
    by = {}
    for t in trades:
        by[t.outcome] = by.get(t.outcome, 0) + 1
    n = len(filled)
    return Metrics(len(trades), n, len(trades) - n, len(wins) / n if n else 0.0,
                   gp / len(wins) if wins else 0.0, -gl / len(losses) if losses else 0.0,
                   gp / gl if gl > 0 else (math.inf if gp > 0 else 0.0),
                   (gp - gl) / n if n else 0.0, dd, gp - gl, by)


@dataclass(frozen=True)
class AcceptanceCriteria:
    min_trades: int = 100
    min_profit_factor: float = 1.2
    min_expectancy_r: float = 0.05
    max_drawdown_r: float = 15.0
    min_oos_to_is_expectancy: float = 0.5  # OOS must retain >= half of IS edge


def walk_forward_splits(n: int, folds: int = 4, train_frac: float = 0.7):
    """Anchored walk-forward: yields (train_slice, test_slice) index ranges."""
    size = n // folds
    for k in range(1, folds + 1):
        end = size * k if k < folds else n
        cut = int(end * train_frac)
        yield slice(0, cut), slice(cut, end)


def acceptance(is_m: Metrics, oos_m: Metrics, crit: AcceptanceCriteria = AcceptanceCriteria()
               ) -> tuple[bool, list[str]]:
    fails = []
    if oos_m.n_trades < crit.min_trades:
        fails.append(f"OOS trades {oos_m.n_trades} < {crit.min_trades}")
    if oos_m.profit_factor < crit.min_profit_factor:
        fails.append(f"OOS PF {oos_m.profit_factor:.2f} < {crit.min_profit_factor}")
    if oos_m.expectancy_r < crit.min_expectancy_r:
        fails.append(f"OOS expectancy {oos_m.expectancy_r:.3f}R < {crit.min_expectancy_r}R")
    if oos_m.max_drawdown_r > crit.max_drawdown_r:
        fails.append(f"OOS max DD {oos_m.max_drawdown_r:.1f}R > {crit.max_drawdown_r}R")
    if is_m.expectancy_r > 0 and oos_m.expectancy_r < crit.min_oos_to_is_expectancy * is_m.expectancy_r:
        fails.append("OOS edge decays vs in-sample (overfit risk)")
    return not fails, fails


def monte_carlo_drawdown(r_multiples: list[float], runs: int = 2000, seed: int = 1,
                         pct: float = 0.95) -> float:
    """Percentile of max drawdown (in R) over reshuffled trade orders."""
    if not r_multiples:
        return 0.0
    rng = random.Random(seed)
    dds = []
    for _ in range(runs):
        seq = r_multiples[:]
        rng.shuffle(seq)
        eq = peak = dd = 0.0
        for r in seq:
            eq += r
            peak = max(peak, eq)
            dd = max(dd, peak - eq)
        dds.append(dd)
    dds.sort()
    return dds[int(pct * (len(dds) - 1))]


def buy_and_hold_r(bars: list[Bar]) -> float:
    """Baseline: session open-to-close return, for comparison."""
    return (bars[-1].close - bars[0].open) / bars[0].open if bars else 0.0

