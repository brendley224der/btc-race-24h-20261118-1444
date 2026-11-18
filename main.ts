// Dip-and-recover cbBTC bot for make.fun's "Race a BTC trading bot live for 24 hours"
// (competition btc-race-24h-20261118-1444).
//
// Strategy (long only, one position, full size, deterministic):
//   This race's frozen dev window (24h, 17-18 Nov 2026) falls -280 bps overall,
//   so buy-and-hold loses $28.00 and the previous race's -1% 45-minute dip
//   trigger loses money here (its dips keep falling: after a 45-minute drop of
//   -1%, the next 60 minutes average -17 bps). What does work on this window:
//     * a sharp 15-minute plunge of -2% or more snaps back: buying it and
//       holding up to 480 bars banked +$19.73 on its own;
//     * milder 30-minute dips of -0.5% scalp a quick +0.5% bounce: six such
//       trades made +$5.57 with 4 wins and a 1.24% max drawdown.
//   Combined (sharp first, no cooldown on the sharp trigger so a scalp's
//   cooldown can never block the plunge buy) the backtest gives +$17.02,
//   4 trades, 3 wins, max drawdown 1.50%; at 2x fees it is still +$13.79.
//   Sharp 15-minute rises, by contrast, revert on this window, so this bot
//   NEVER buys a rip.
//
//   - SHARP: the 15-bar return falls to -2% or worse -> buy 100% of cash,
//     hold up to 480 bars, take profit at +3% over cost, stop out at -2%.
//     No cooldown: a plunge is rare and must never be blocked by a scalp.
//   - MILD: the 30-bar return falls to -0.5% or worse -> buy 100% of cash,
//     hold up to 240 bars, take profit at +0.5% over cost, stop out at -2%.
//     30-bar cooldown after an exit, so a stop-out is not immediately
//     re-bought into the same falling move.
//   - FALLBACK: if no buy has ever been sent and the window is past bar 1200,
//     a milder 60-bar dip of -1% also buys (hold 60, stop -1%, take
//     profit +2%), so the bot still meets the race's minimum of 1 trade on
//     a quiet window.
//
//   A full-size round trip costs about 32 bps in fee, slippage and price
//   impact, so the mild scalp's +0.5% take profit still clears it, and the
//   +3% sharp take profit banks a recovery spike and frees cash for the next
//   dip. Orders fill at the next bar's open; max_slippage_bps is 200 (2%
//   past the latest close) so a normal fill is never rejected for slippage.
//
//   Verified on this race's frozen dev window with the kit's own grader
//   (grade-local, process driver, two executions, byte-for-byte replay):
//   net PnL +19.903875 USDC, 8 fills (4 round trips), win rate 0.75,
//   max drawdown 1.50%, fees 3.253101 USDC, 0 rejected, guardrails met.
//   At 2x fees the net PnL is still +16.66 USDC. Buy-and-hold on the
//   same window: -28.00 USDC.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 200;

// Sharp plunge: 15-bar return <= -2%, hold 480, TP +3%, stop -2%, no cooldown.
const SHARP_LOOK = 15;
const SHARP_THRESH_BPS = -200;
const SHARP_HOLD = 480;
const SHARP_STOP_BPS = 200;
const SHARP_TP_BPS = 300;

// Mild dip scalp: 30-bar return <= -0.5%, hold 240, TP +0.5%, stop -2%.
const MILD_LOOK = 30;
const MILD_THRESH_BPS = -50;
const MILD_HOLD = 240;
const MILD_STOP_BPS = 200;
const MILD_TP_BPS = 50;
const MILD_COOLDOWN = 30; // bars after an exit before a mild entry

// Fallback: only after this bar, and only if never traded.
const FALLBACK_BAR = 1200;
const FALLBACK_LOOK = 60;
const FALLBACK_THRESH_BPS = -100; // -1%
const FALLBACK_HOLD = 60;
const FALLBACK_STOP_BPS = 100; // 1% under cost
const FALLBACK_TP_BPS = 200; // 2% over cost

const closes: number[] = []; // closes as floats, oldest first
let entryCost = 0n; // quote units spent on the open position (0 when flat)
let entryBar = -1; // seq of the bar the position was decided on
let holdBars = 0; // bars to hold the open position
let stopBps = 0; // stop, in bps under entryCost
let tpBps = 0; // take profit, in bps over entryCost
let lastExitBar = -1_000_000_000;
let everBought = false;

/** Return over the last n bars, in bps, truncated toward zero; null without n bars. */
function retBps(n: number): number | null {
  if (closes.length <= n) return null;
  const now = closes[closes.length - 1];
  const then = closes[closes.length - 1 - n];
  if (then <= 0) return null;
  return Math.trunc(((now - then) * 10000) / then);
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      // Exit: hold expired, stop hit, or take profit reached.
      if (state.seq - entryBar >= holdBars) {
        lastExitBar = state.seq;
        entryCost = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      const value = state.value(SYMBOL, held.qty);
      if (value * 10000n <= entryCost * BigInt(10000 - stopBps)) {
        lastExitBar = state.seq;
        entryCost = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      if (value * 10000n >= entryCost * BigInt(10000 + tpBps)) {
        lastExitBar = state.seq;
        entryCost = 0n;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];

    // Sharp plunge first: it ignores the cooldown, a plunge must never be blocked.
    const r15 = retBps(SHARP_LOOK);
    if (r15 !== null && r15 <= SHARP_THRESH_BPS) {
      entryCost = cash;
      entryBar = state.seq;
      holdBars = SHARP_HOLD;
      stopBps = SHARP_STOP_BPS;
      tpBps = SHARP_TP_BPS;
      everBought = true;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    if (state.seq - lastExitBar < MILD_COOLDOWN) return [];

    const r30 = retBps(MILD_LOOK);
    if (r30 !== null && r30 <= MILD_THRESH_BPS) {
      entryCost = cash;
      entryBar = state.seq;
      holdBars = MILD_HOLD;
      stopBps = MILD_STOP_BPS;
      tpBps = MILD_TP_BPS;
      everBought = true;
      return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
    }

    if (!everBought && state.seq >= FALLBACK_BAR) {
      const r60 = retBps(FALLBACK_LOOK);
      if (r60 !== null && r60 <= FALLBACK_THRESH_BPS) {
        entryCost = cash;
        entryBar = state.seq;
        holdBars = FALLBACK_HOLD;
        stopBps = FALLBACK_STOP_BPS;
        tpBps = FALLBACK_TP_BPS;
        everBought = true;
        return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
    }

    return [];
  },
});
