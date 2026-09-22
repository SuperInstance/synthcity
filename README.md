<div align="center">

# synthcity — quilt substrate edition

**An infinite procedural cyberpunk city, forked onto the fleet's quilt kernel.**

[![forked from](https://img.shields.io/badge/forked%20from-jeffbeene%2Fsynthcity-blue)](https://github.com/jeffbeene/synthcity)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![upstream](https://img.shields.io/badge/upstream-206%20stars-orange)](https://github.com/jeffbeene/synthcity)

</div>

---

## What this fork is

Upstream [jeffbeene/synthcity](https://github.com/jeffbeene/synthcity) generates a
procedural cyberpunk city in the browser — 206 stars' worth of neon sprawl, and
the best possible stage for a substrate you can watch. This fork is part of the
[Cocapn Fleet](https://github.com/SuperInstance/SuperInstance)'s city×quilt
program: three city toys rebuilt so that **the city itself runs on the quilt
kernel** — six opcodes (`BIND / LINK / EFFECT / VIEW / TICK / FORGET`), every
act a hash-chained cell — with a toggle that shows the backend in production
while you play.

The charm is upstream's. The backend is ours. Both are visible, all the time.

## Status

| Layer | State |
|---|---|
| Upstream city (visuals, generation, flight) | **byte-identical to jeffbeene/synthcity @ main** |
| Quilt kernel (vendored minimal) | designed-in, pending port (see `SuperInstance/code-city` for the reference implementation) |
| Backend toggle (`Q`) | pending |
| Witness export (kev harness JSONL) | pending |

This is the big sibling: 134 MB of procedural city, ported last in the program.
The reference pattern lives at [`SuperInstance/code-city`](../code-city) —
kernel, outside-wrapping bridge, phosphor pane, witness export, 10 `node --test`
tests. If you're porting, start there and come uphill.

## Why a city is the right demo for a substrate

A city is the only interface where the backend *is* the scenery. Every light
that turns on, every car that moves, every district that spawns is a cell:
`BIND` the block, `LINK` the road, `EFFECT` the rain, `TICK` the frame. Flip
the toggle and the neon confesses — you are watching the ledger, not the
rendering of it. Procedural generation and chained state were the same idea
all along; this fork just stops pretending otherwise.

## The nod

Forked, not reverse-engineered: upstream's history, authorship, and MIT
license are intact, and the GitHub fork badge points home. jeffbeene built the
city; the fleet built the nervous system underneath it. If upstream wants the
substrate back, it's one PR — the kernel is vendored, MIT, and zero-dependency.

## Ecosystem

- [`SuperInstance/SuperInstance`](https://github.com/SuperInstance/SuperInstance) — the profile; the boat that builds itself
- [`SuperInstance/quilt-studio`](https://github.com/SuperInstance/quilt-studio) — the kernel's product face
- [`SuperInstance/code-city`](../code-city) — the reference city×quilt port (play this one today)
- [`SuperInstance/night-city`](../night-city) — the second city (Three.js easter-eggs)
- [`SuperInstance/kev-substrate-competition`](https://github.com/SuperInstance/kev-substrate-competition) — where witness logs go to be believed (harness/replay.py replays this toy's exports)

---

*Upstream README preserved for reference: [jeffbeene/synthcity](https://github.com/jeffbeene/synthcity#readme).*
