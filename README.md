# Penalty Nations 2026

A portrait-first, mobile-web-first HTML5 penalty-shootout game wrapped in a full
2026-format World Cup tournament (48 teams, 12 groups, Round of 32 → Final).
Vanilla JS, single page, no build step. **Every match is a penalty shootout.**

> Session 2: two-sided play (shoot on attack, dive on defence), clearer shot
> feedback, tunable difficulty, upgraded keeper/ball art, and the rename to
> Penalty Nations 2026. Audio pass and final GD submission prep continue next.

## Run it

No build step. Serve the folder over HTTP (flags + fonts load from CDNs):

```bash
npm start          # npx serve -l 8080  -> http://localhost:8080
```

Open `http://localhost:8080` on a phone or a narrow browser window.

## Test the rules (headless)

All tournament logic lives in a single pure module, `js/tournament.js`, with no
DOM/SDK dependencies, so the rules run and test headlessly:

```bash
npm test           # node tests/tournament.test.js
```

The suite covers the locked shootout rules: knockout early termination
(3-0 after 3 pairs, mid-pair decision), no extra kicks after a decision,
sudden death ending on the first unequal pair, group matches always taking 5
kicks with draws allowed, tiebreakers, qualification (12 + 12 + 8 = 32) and
bracket seeding.

## Rules (locked)

- **Group matches** — exactly 5 kicks each, **no** sudden death. Level after 5
  is a draw (1 pt each); a win is 3 pts. Goals for/against are the real shootout
  scores.
- **Knockout matches** — best of 5 with strict early termination (stop the
  instant the result is mathematically decided), then sudden death decided after
  each *completed* pair of kicks (IFAB).
- **AI-vs-AI** matches are simulated as strength-weighted shootout scores.
- **Qualification** — top 2 per group + 8 best third-placed → Round of 32.
  Tiebreakers: points, goal difference, goals for, then rating.

## Gameplay

Each shootout is two-sided:

- **Attack** — drag from the ball to set direction and power, release to shoot.
  Placement maps to a continuous goal area (no discrete zones); the mouth is read
  as Left/Centre/Right thirds. A trajectory arrow + power bar preview the swipe.
  Corner shots beat the keeper; you only miss (wide/over) on genuinely extreme
  swipes. Clear outcome labels read the result ("GOAL!", "SAVED!", "MISS — WIDE",
  "MISS — OVER THE BAR", "OFF THE POST!") with a brief freeze.
- **Defence** — when the opponent kicks, you pick which way your keeper dives
  (tap left/centre/right, or drag) against a short timer. A save needs the right
  third plus your keeper's rating.

The keeper rating is a function of team strength, round depth, and the team's
results so far, shown on the match preview as a badge (Average / Good / Elite /
World-class). Scoring is the default outcome of a decent shot (~70-80% for
well-aimed shots in early rounds), scaling harder by round and opponent strength.

### Tuning difficulty

All conversion / keeper-reach / miss thresholds live in `Config.TUNING` in
`js/config.js`, each commented, so the balance can be adjusted by feel without
touching game logic.

## Draw

Two modes from the menu:

- **Official draw** — the verified real FIFA World Cup 2026 final draw
  (Washington D.C., 5 December 2025).
- **Random draw** — pot-seeded random (one team per pot per group).

Real flags via the [flag-icons](https://github.com/lipis/flag-icons) SVG
library. No FIFA marks, federation crests, or player names.

## Monetization (wired behind a flag)

All ad/SDK calls go through one adapter, `js/ads.js`, with a single interface:
`showInterstitial()`, `showRewarded(cb)`, `gameplayStart()`, `gameplayStop()`.
Three implementations are selected by `Config.BUILD_TARGET`:

| target  | SDK                                   | use                       |
|---------|---------------------------------------|---------------------------|
| `gd`    | GameDistribution HTML5 SDK            | GameDistribution build    |
| `crazy` | CrazyGames HTML5 SDK v3 (incl. gameplay start/stop) | CrazyGames build |
| `none`  | none (fake ads)                       | itch.io / local debug     |

No SDK is referenced anywhere else in the codebase. An interstitial plays on
hub return between rounds; a rewarded ad grants one retake of a failed kick per
match. `Config.GD_GAME_ID` is set to the production GameDistribution id.

## Project layout

```
index.html            single page; loads modules in order
css/styles.css         dark pitch-night theme, gold accents, Archivo fonts
js/config.js           build target, GD_GAME_ID, feature flags, TUNING
js/tournament.js       PURE engine: shootout rules, standings, bracket, sim
js/teams.js            48 teams (ratings, pots, ISO flag codes)
js/draw.js             official + pot-seeded random draw
js/keeper.js           keeper rating + third-based save model + AI dive
js/ads.js              ad adapter (gd / crazy / none)
js/game.js             two-sided shootout (swipe attack + dive defence, canvas)
js/ui.js               DOM render helpers (tables, bracket, badges)
js/main.js             app/state machine + tournament orchestration
js/audio.js            placeholder WebAudio sounds
tests/tournament.test.js  headless unit tests
```

## Configuration

Edit `js/config.js`:

- `BUILD_TARGET`: `'gd'` | `'crazy'` | `'none'`
- `GD_GAME_ID`: the GameDistribution game id
- `ADS_ENABLED`, `ADS_DEBUG_FAKE`, `DEBUG`
- `TUNING`: gameplay balance constants (conversion, keeper save chances, miss
  thresholds, dive timer) — each commented
