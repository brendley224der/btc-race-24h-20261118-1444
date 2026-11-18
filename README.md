# btc-race-24h-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/brendley224der/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/brendley224der/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A dip-and-recover trading bot for Coinbase Wrapped BTC (cbBTC) against USDC. It buys sharp 15-minute plunges of 2% or more with its full $1,000 of paper money and rides the recovery (take profit +3%, stop -2%, hold up to 480 bars), and scalps milder 30-minute dips of 0.5% for a quick +0.5% bounce. It never buys rips: on this race's dev window, sharp 15-minute rises reverted hard. Simulation only — no real money ever moves.

## Run it

Requires Node 22 or later. No dependencies, nothing to install.

```sh
node main.ts
```

`main.ts` is the bot: it reads one JSON line per minute (a 1-minute cbBTC bar) on stdin and answers buy/sell orders on stdout, following the agent-fun/bars-replay/v1 protocol via the vendored `vendor/makefun-bars.ts` SDK shim. Grade it on the frozen dev window with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

Dev grade on this race's frozen 24-hour window: net PnL +19.90 USDC, 8 fills (4 round trips), win rate 0.75, max drawdown 1.50%, 0 rejected, guardrails met. At 2x fees the net PnL is still +16.66 USDC. Buy-and-hold on the same window lost $28.00.

---

Entered on [make.fun](https://make.fun/?ref=amsc6jjj&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards
