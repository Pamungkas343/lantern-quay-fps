# LANTERN QUAY — 5v5 tactical FPS

[![make.fun](https://img.shields.io/badge/make.fun-threejs--fps--01-blue)](https://make.fun/bounty/threejs-fps-01)
[![three.js](https://img.shields.io/badge/three.js-0.187.0-black)](https://threejs.org)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A round-based tactical FPS in the style Counter-Strike made famous, set on a
night harbour: **EMBER CO-OP** (attackers) vs **HARBOUR WATCH** (defenders),
5v5, plant-and-defuse, buy economy, team bots with radio calls.

- **Map:** Lantern Quay — Site A "Lantern Quay" by the lighthouse, Site B
  "Fish Hall" warehouse, mid "Net Loft" two-storey net warehouse. Three named
  lanes, big diegetic signage, dusk blue + lantern orange.
- **Gunplay:** hitscan with headshots, recoil + spread that punishes firing
  on the move, crouch, acceleration-based movement, map collision.
- **Tactics:** bomb plant (3 s) / defuse (5 s), 35 s charge timer, buy menu
  between rounds, 4 weapons + knife + frag/flash/smoke, bots that follow
  routes, hold sites, react to sight and sound, and call out contacts.
- **Bots:** named teammates and enemies with per-round team plans
  ("PLAN: SPLIT A — YOU: ENTRY") and radio chatter.

## Run it

Serve `game/` with any static server and open `game/index.html` in desktop
Chrome. Click to lock the mouse. `B` opens the buy menu during the buy
phase, `1–5` switch weapons, `6/7/8` throw frag/flash/smoke, `R` reloads, `Ctrl`
crouches, `E` plants/defuses the charge, `Tab` shows the scoreboard.

## Shots

`?shot=cover|buy|plant|end` stages a deterministic scene for screenshots;
`?seed=N` fixes the RNG; `?autotest=1` runs 10 bot-only rounds headlessly
and logs the results.
