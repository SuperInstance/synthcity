<div align="center">

# synthcity — quilt substrate edition

**An infinite procedural cyberpunk city — now running on a substrate you can watch.**

[![forked from](https://img.shields.io/badge/forked%20from-jeffbeene%2Fsynthcity-blue)](https://github.com/jeffbeene/synthcity)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![tests](https://img.shields.io/badge/tests-23%2F23%20node--test-brightgreen)](tests/quilt.test.mjs)

*Upstream, every car that spawns just spawns. Here, the ledger says so.*

</div>

---

## Play it

Serve the repo root statically and open `index.html` — the city is the same
procedural neon sprawl Jeff Beene shipped, unchanged:

```bash
npx serve .        # or any static file server
```

Pick a mode, hit **Launch**, drive.
**Press `Q` (or the ◈ button) to open the substrate** and watch every act the
city performs become a hash-chained cell while you play.

## The quilt backend (what this fork adds)

Upstream built the city. This fork runs it on the
[Cocapn Fleet](https://github.com/SuperInstance/SuperInstance)'s quilt kernel —
six opcodes, vendored minimal, zero dependencies:

| Game act | Cell |
|---|---|
| Launch builds the scene | `VIEW {scene: "synthcity", world_seed, mode}` |
| The lighting rig comes up | `EFFECT {kind: "lighting", fog_color, sun_color, ambient_color}` |
| A city block spawns ahead of you | `BIND {kind: "block", x, z, cell_size}` |
| A traffic group spawns on a road | `LINK {kind: "road", x, z, cars}` |
| A city light switches on | `EFFECT {kind: "city-light", x, z}` |
| You crash (and recover) | `EFFECT {kind: "crash", x, z}` / `EFFECT {kind: "recover"}` |
| Every 30th frame | `TICK {frame, blocks_live, traffic_live, trimmed_total}` |
| History passes 500 cells | `FORGET {dropped, prev_segment_head}` — the page turn |

There is no rain in synthcity, so there is no rain cell: the weather-adjacent
surface this game actually has is its lighting rig and its city lights, and
those are the `EFFECT`s the bridge records. Block releases are aggregated into
`TICK` counters rather than emitted one cell per despawn — the churn would
drown the chain.

Every cell chains `prev_hash → cell_hash` (FNV-1a-64 over UTF-8 bytes, genesis
`0x0000000000000000`; the fleet canary `café Δ 日本語 → 0x24a555471370b18d`,
verified numerically — the docs' 17-hex-digit spelling carries a stray leading
zero). The **◈ backend pane** shows the live cell tail, opcode counters, chain
length, coherence, and a **⤓ witness.jsonl** export in the exact shape
[`kev-substrate-competition`'s `harness/replay.py`](https://github.com/SuperInstance/kev-substrate-competition/blob/main/harness/replay.py)
consumes: `conv_id, cell_id, tick, state_json, answers_json, prev_hash,
cell_hash` — verbatim strings, replayable by a referee, at coherence 1.0 for
runs of any length.

## How it wraps (touch nothing, wire from outside)

synthcity is a webpack bundle over `src/index.js` + `src/classes/*.js`, and it
hands the world one global: `window.game`. The quilt layer never edits a
creator module — it shadows methods **on the live instances** at the points
where the city actually acts:

| Wrap point (upstream file) | Intercepted by |
|---|---|
| `window.game = new Game()` (`src/index.js:45`) | the one global the bridge waits for |
| `game.init()` — builds scene, player, generators | own property on the instance |
| `game.animate()` — the render loop | own property on the instance |
| `generatorCityBlock.add_items()` — block spawn path | own property on the instance |
| `generatorTraffic.add_items()` — vehicle spawn path | own property on the instance |
| `generatorCityLights.add_items()` — light spawn path | own property on the instance |
| `game.player.update()` — crash state flips | own property on the instance |

`Generator` dispatches through `this.add_items()`, so an own property shadows
the prototype method and sits on the real spawn path — no rebuild, no fork of
the bundler, no second render loop. The originals run first, unchanged, and
their return values pass through; the ledger records what they did. `bridge.detach()`
puts the game back byte-for-byte behaviorally, which is how the tests prove it.

**Byte-identity is enforced, not claimed**: `tests/upstream-manifest.json`
records the sha256 of 25 upstream source files as of the branch this fork
ported from, and a test fails if any of them drifts. `index.html` — the single
permitted upstream edit — carries one clearly-marked `<script type="module">`
block, and a second test proves the file with that block removed hashes equal
to upstream.

## The FORGET page turn (a deliberate improvement over the reference kernel)

[`code-city`](../code-city) trims history by dropping the chain's front and
keeping a 500-cell window whose first cell still points into dropped memory.
That window verifies locally with suffix-aware logic, but exported to
`harness/replay.py` it fails on its very first line — `genesis cell with
non-genesis prev_hash` — collapsing coherence to ~0 for any run long enough to
need trimming. An honest log scored as a forged one.

This port turns a **page** instead: past 500 cells the kernel opens a new
conversation segment whose first cell is the `FORGET` announcement
(`prev_hash` genesis, payload carrying `dropped`, the cumulative
`trimmed_total`, and `prev_segment_head` — the hash the previous segment ended
on), then releases the old segment. Nothing is hidden: the trim is announced
*in* the chain, the dropped count is on the record, and every export replays
at coherence 1.0 for runs of any length. Local history is shorter after a page
turn; that cost is real and accepted.

## Respect for the original

[Jeff Beene](https://github.com/jeffbeene) built synthcity, and this fork
treats that as load-bearing fact:

- Every file under `src/`, `js/`, `css/`, `dist/` — and `package.json`,
  `webpack.config.js`, `LICENSE` — is **byte-identical to upstream**, enforced
  by a regression test against a recorded manifest.
- The MIT license ships intact, and "An interactive audiovisual experience by
  Jeff Beene" still heads the game; a test guards the credit.
- Upstream history and authorship are intact in git; the fork badge points home.
- If upstream wants the substrate, it's one PR — the kernel is vendored, MIT,
  and zero-dependency.

## Tests & CI

```bash
node --test tests/quilt.test.mjs    # 23 tests, zero dependencies
```

Canary byte law (and the code-point-loop failure mode), FNV reference vectors,
genesis chaining, the kev preimage reproduced cell-for-cell by an
independently-written verifier, witness field-for-field harness interop,
tamper → coherence drop with the referee agreeing on the blast radius, the
FORGET page turn, the suffix-aware slice law, wrapper fidelity (originals run,
returns pass through, detach restores), spawn de-duplication, tick cadence,
crash/recover, MIT license intact, upstream credit guarded, and byte-identity
against the recorded manifest. CI runs them on every push
(`.github/workflows/quilt-test.yml`) — no `npm ci`, just Node's built-in
runner; the deploy step is a stub that echoes and exits 0.

## Ecosystem

- [`SuperInstance/SuperInstance`](https://github.com/SuperInstance/SuperInstance) — the profile; the boat that builds itself
- [`SuperInstance/quilt-studio`](https://github.com/SuperInstance/quilt-studio) — the kernel's product face
- [`SuperInstance/code-city`](../code-city) — the reference city×quilt port (play this one today)
- [`SuperInstance/night-city`](../night-city) — the second city (React + zustand, easter-eggs)
- [`SuperInstance/kev-substrate-competition`](https://github.com/SuperInstance/kev-substrate-competition) — where witness logs go to be believed

---

*Upstream README preserved for reference: [jeffbeene/synthcity](https://github.com/jeffbeene/synthcity#readme).*
