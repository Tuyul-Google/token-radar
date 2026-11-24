[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Tuyul-Google/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Tuyul-Google/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Northstar Token Launch Radar — make.fun entry

Entry for the make.fun bounty **"Build the best token launch radar"**
(`token-radar-01`, $1,325 total: 1st $1,000, 2nd–5th $50, 6th–10th $25).
Deadline: **Mon Dec 14, 2026 17:00 WIB** (10:00 UTC).

## What it is

A radar that ranks pre-token protocols by implied launch value, priced from the
sealed DefiLlama snapshot's own figures — never from a hand-kept list of names.

- **Board: 178 rows** — the full 40-protocol watchlist (TVL ≥ $50M, no token)
  plus 138 early finds below the floor. Ranks 1..178, implied values
  $90.4M (Steakhouse Financial) down to $3.0M (Granite).
- **Dashboard** (`dashboard/index.html` + `app.css` + `app.js`, 29,907 bytes):
  sortable/filterable table (search, category, chain, sort), per-protocol
  detail view that recomputes the implied value from the row's own figures
  and checks it against the board, live launched comparables, method tab,
  hash deep links (`#detail=<slug>`, `#category=<name>`).
- **Farm plans**: 6 concrete steps per row, each with a cost and a time.
- **Screenshots**: 3 real renders of the dashboard at 1440×900
  (`screenshots/1-board.png`, `2-detail.png`, `3-filtered.png`),
  ~170 KB each.

## The model ("northstar-1")

Fitted at runtime by OLS on the snapshot's own 128 launched protocols:

```
log(market cap) = 6.96 + 0.52 · log(effective TVL) + category effect
effective TVL   = TVL / (1 + 0.5 · max(0, clamped 7d growth) / 100)
```

- **Power law, not a flat multiple.** Single-variable fits on the launched set
  showed the mcap/TVL multiple falls steeply with size (log-log slope −0.478,
  corr −0.41); a flat multiple is the wrong shape.
- **Growth enters only as a spike discount**: half of a 7-day jump is treated
  as not-yet-stuck TVL. Raw growth has a weak negative link to the multiple
  (slope −0.042), so it does not inflate value.
- **Age does not move the value** (corr ≈ 0.00 in the launched set). Age sets
  the farm plan's hold window instead.
- **Category effect**: median residual per category, shrunk with 4
  pseudo-observations at 0. Survivors: Lending −0.21, Liquid Staking −0.24,
  Canonical Bridge +0.39, Basis Trading +0.25, Bridge +0.09. Categories with
  fewer than 3 launched names get 0.
- **Chain count does nothing** (corr −0.02) and is not in the model.

## Backtest (leave-one-out, computed at runtime, shown on the dashboard)

Each of the 128 launched protocols held out in turn, the fit redone without it,
prediction scored against its real market cap:

| Metric | Northstar | Flat-multiple baseline |
|---|---|---|
| Median \|log10 error\| | **0.54** | 0.71 |
| Predictions within 2× of real mcap | **31.3%** | 28.1% |
| Predictions within 3× | **41.4%** | 35.2% |
| Rank correlation (Spearman) | 0.39 | 0.42 |

The flat baseline is the global median mcap/TVL multiple on raw TVL.
Northstar wins on error magnitude; the flat baseline edges it on rank
correlation alone — the dashboard shows both, honestly.

## How to run

Requires Node 22.18+ (uses only the Node standard library; no installs).

```sh
cd entry
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/`
and `out/dossier.json`. The build is deterministic: two runs produce
byte-identical output (verified with `diff -r`).

## Verification (local gate check, 2026-11-24)

`../analysis/gate-check.js` (`node ../analysis/gate-check.js out`) — all checks
pass: dashboard 3 files / 29,907 bytes (≤400 files, ≤4 MiB), no `http(s)` in
HTML attributes / CSS / JS imports, board 178 rows with ranks 1..178, all slugs
from the snapshot, whole 40-protocol watchlist covered, 178 distinct implied
values, 6 farm steps per row, screenshots 3× 1440×900 PNG ≤512 KiB,
dossier.json 726,509 bytes (≤1.5 MiB) with text 30,174 bytes (≤65,536).

## Files

- `main.ts` — entry point (same CLI contract as the kit starter).
- `lib/model.ts` — the model, board builder, farm plans, runtime LOO backtest,
  board validation. All original work for this entry.
- `vendor/makefun-board.ts` — verbatim kit copy (dossier builder).
- `dashboard/` — index.html, app.css, app.js (all original).
- `screenshots/` — the 3 real dashboard renders.
- `LICENSE` — MIT, from the kit starter.

## How the screenshots were taken

The VM's Chromium (`/opt/meta-chromium/chrome`) refuses to start without a
Hatch WebGL domain policy, and its `--screenshot` / `--dump-dom` flags produce
no output in this build. The working route: a policy file + CDP.

```sh
# policy file (first line is the version marker, then sorted domains, trailing newline)
printf 'hatch-webgl-allowed-domains-v1\nexample.com\n' > webgl-policy.txt
SHA=$(sha256sum webgl-policy.txt | cut -d' ' -f1)
# validate it:
chrome --hatch-validate-webgl-allowed-domains --version \
  --hatch-webgl-allowed-domains-file=webgl-policy.txt \
  --hatch-webgl-allowed-domains-sha256=$SHA
# start headless Chrome with CDP:
chrome --headless=new --disable-gpu --no-sandbox --disable-dev-shm-usage \
  --user-data-dir=/tmp/chrome-prof4 \
  --hatch-webgl-allowed-domains-file=webgl-policy.txt \
  --hatch-webgl-allowed-domains-sha256=$SHA \
  --remote-debugging-port=9222 about:blank
# take shots with the pure-Node CDP driver (global WebSocket, no deps):
node screenshot-cdp.js "file://.../out/dashboard/index.html" 1-board.png png 85 700
node screenshot-cdp.js "file://.../out/dashboard/index.html#detail=steakhouse-financial" 2-detail.png png 85 detail
node screenshot-cdp.js "file://.../out/dashboard/index.html#category=Risk%20Curators" 3-filtered.png png 85 700
```

Driver and policy copies: `../tools/screenshot-cdp.js`,
`../tools/webgl-policy.txt`. (The `#detail=` shot needs the `detail` scroll
mode — the detail panel renders below the board table.)

## Still needed to submit (not done here, by design)

- A GitHub account and a Solana keypair (submission/claim requirements).
- The entry bundled with the kit CLI (`bundle`), which includes the agent
  transcripts that built it — the submitter must bundle from the session
  that did this work.
- No money was spent; no account was created from this side.
