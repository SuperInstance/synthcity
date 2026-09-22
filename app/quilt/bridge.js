// bridge.js — QuiltBridge: synthcity speaks quilt without its files being
// touched. Every game act is wrapped from OUTSIDE; the creator's modules under
// src/ stay byte-identical. The only upstream edit in this fork is the marked
// <script type="module"> in index.html that boots app/quilt/main.js.
//
// Where the wrap points are (verified against the real tree):
//   window.game            — src/index.js:45 assigns the one global we need
//   game.init()            — builds scene, player, generators; VIEW + lighting
//   game.animate()         — the render loop; TICK every Nth frame, FORGET
//   generator*.add_items() — the actual spawn path for blocks/traffic/lights
//   game.player.update()   — where crash/recover state flips
//
// Generator dispatches through `this.add_items()`, so an own-property on the
// instance shadows the prototype method and intercepts the real spawn path —
// no upstream edit, no rebuild, no second render loop.
//
// Ordering rule: the city acts first, then the ledger says so. Payloads are
// read from post-call state, originals keep their return values.

import { Kernel } from './kernel.js';

const r1 = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const clampStr = (s, n = 48) => (s == null ? null : String(s).slice(0, n));

function countLive(grid) {
  let n = 0;
  for (const row of grid) for (const item of row) if (item != null) n++;
  return n;
}

export class QuiltBridge {
  constructor({ convId, tickEvery = 30, keep = 500 } = {}) {
    this.kernel = new Kernel(convId || 'synthcity');
    this.tickEvery = tickEvery;
    this.keep = keep;
    this.frame = 0;
    this.installed = false;
    this.listeners = new Set();
    this.wraps = [];        // { label, target, method } — what we shadowed
    this.seenItems = new WeakSet();
    this.counts = { blocks: 0, blocksReleased: 0, traffic: 0, lights: 0, crashes: 0 };
    this.lastCrashed = false;
  }

  // target -> Map(method -> original); the detach() half of every wrap
  #stash = new Map();
  #lastBlockLive = 0;

  onCell(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #announce(cell) {
    for (const fn of this.listeners) fn(cell);
  }

  #emit(op, payload) {
    const cell = this.kernel.emit(op, payload);
    this.#announce(cell);
    return cell;
  }

  // Shadow target[method] with wrapped, keeping the original for detach().
  // Every wrapped callback ends in `return result` — the city's own return
  // value reaches its caller untouched.
  #wrap(label, target, method, wrapped) {
    if (!target || typeof target[method] !== 'function') return false;
    if (!this.#stash.has(target)) this.#stash.set(target, new Map());
    const stash = this.#stash.get(target);
    if (stash.has(method)) return false; // never double-wrap
    const original = target[method];
    stash.set(method, original);
    target[method] = function (...args) {
      const result = original.apply(this, args);
      return wrapped.call(this, args, result);
    };
    this.wraps.push({ label, target, method });
    return true;
  }

  // Detach every wrap, restoring the originals. Fidelity is testable: after
  // detach() the game objects behave exactly as upstream wrote them.
  detach() {
    for (const [target, stash] of this.#stash) {
      for (const [method, original] of stash) target[method] = original;
    }
    this.#stash.clear();
    this.wraps.length = 0;
    this.installed = false;
  }

  install(game) {
    if (this.installed || !game) return this;
    this.installed = true;
    this.game = game;

    // 1. launch path — the city is assembled here
    this.#wrap('Game.init', game, 'init', (_args, result) => {
      this.#onCityInit();
      return result;
    });

    // 2. render loop — TICK cadence + honest FORGET
    this.#wrap('Game.animate', game, 'animate', (_args, result) => {
      this.#onFrame();
      return result;
    });

    // generators only exist after init(); cover the already-running case too
    if (game.initialized) this.#wrapGenerators(game);

    return this;
  }

  #wrapGenerators(game) {
    const blocks = game.generatorCityBlock;
    const lights = game.generatorCityLights;
    const traffic = game.generatorTraffic;

    // district/block spawn — BIND per new block, aggregate the releases
    if (blocks) {
      this.#wrap('Generator[cityBlock].add_items', blocks, 'add_items', (_args, result) => {
        for (const item of this.#freshItems(blocks)) {
          this.counts.blocks++;
          this.#emit('BIND', {
            kind: 'block',
            x: r1(item.x),
            z: r1(item.z),
            cell_size: r1(blocks.cell_size),
          });
        }
        // releases are measured against the last observed live count, so a
        // spawn must refresh it too or the delta goes stale
        this.#lastBlockLive = countLive(blocks.grid);
        return result;
      });
      this.#wrap('Generator[cityBlock].remove_items', blocks, 'remove_items', (_args, result) => {
        const live = countLive(blocks.grid);
        if (live < this.#lastBlockLive) {
          this.counts.blocksReleased += this.#lastBlockLive - live;
        }
        this.#lastBlockLive = live;
        return result;
      });
      this.#lastBlockLive = countLive(blocks.grid);
    }

    // road/vehicle spawn — LINK
    if (traffic) {
      this.#wrap('Generator[traffic].add_items', traffic, 'add_items', (_args, result) => {
        for (const item of this.#freshItems(traffic)) {
          this.counts.traffic++;
          this.#emit('LINK', {
            kind: 'road',
            x: r1(item.x),
            z: r1(item.z),
            cars: Array.isArray(item.cars) ? item.cars.length : null,
          });
        }
        return result;
      });
    }

    // light spawn — EFFECT (this city has no rain; its lighting is these)
    if (lights) {
      this.#wrap('Generator[cityLights].add_items', lights, 'add_items', (_args, result) => {
        for (const item of this.#freshItems(lights)) {
          if (item.lightIndex === null || item.lightIndex === undefined) continue;
          this.counts.lights++;
          this.#emit('EFFECT', { kind: 'city-light', x: r1(item.x), z: r1(item.z) });
        }
        return result;
      });
    }

    // crash/recover — EFFECT, observed after the player's own update ran
    if (game.player && typeof game.player.update === 'function') {
      this.#wrap('player.update', game.player, 'update', (_args, result) => {
        const crashed = game.player.crashed === true;
        if (crashed !== this.lastCrashed) {
          this.lastCrashed = crashed;
          if (crashed) {
            this.counts.crashes++;
            this.#emit('EFFECT', {
              kind: 'crash',
              x: r1(game.player.body?.position?.x),
              z: r1(game.player.body?.position?.z),
            });
          } else {
            this.#emit('EFFECT', { kind: 'recover' });
          }
        }
        return result;
      });
    }
  }

  // Items this bridge has not seen yet (WeakSet survives despawn/respawn).
  #freshItems(gen) {
    const fresh = [];
    for (const row of gen.grid) {
      for (const item of row) {
        if (item == null) continue;
        if (this.seenItems.has(item)) continue;
        this.seenItems.add(item);
        fresh.push(item);
      }
    }
    return fresh;
  }

  #onCityInit() {
    const g = this.game;
    const env = g.environment || {};
    const hex = (c) => (typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : null);
    this.#emit('VIEW', {
      scene: 'synthcity',
      environment: clampStr(env.name),
      mode: clampStr(g.settings?.mode),
      world_seed: g.settings?.worldSeed ?? null,
      city_block_size: r1(g.cityBlockSize),
      road_width: r1(g.roadWidth),
      render_scaling: g.settings?.renderScaling ?? null,
    });
    // lighting/weather EFFECT — the real, static-ish lighting rig of the city
    this.#emit('EFFECT', {
      kind: 'lighting',
      environment: clampStr(env.name),
      fog_color: hex(env.fog?.color),
      fog_end: env.fog?.end ?? null,
      sun_color: hex(env.sun?.color),
      sun_intensity: env.sun?.intensity ?? null,
      ambient_color: hex(env.ambient?.color),
      city_lights: env.cityLights === true,
      spot_lights: env.spotLights === true,
    });
    this.#wrapGenerators(g);
  }

  #onFrame() {
    this.frame++;
    if (this.frame % this.tickEvery !== 0) return;
    const g = this.game;
    const cell = this.#emit('TICK', {
      frame: this.frame,
      blocks_live: g.generatorCityBlock ? countLive(g.generatorCityBlock.grid) : null,
      traffic_live: g.generatorTraffic ? countLive(g.generatorTraffic.grid) : null,
      lights: this.counts.lights,
      crashes: this.counts.crashes,
      trimmed_total: this.kernel.trimmed,
    });
    this.kernel.forget(this.keep);
    return cell;
  }

  stats() {
    return {
      frames: this.frame,
      cells: this.kernel.cells.length,
      total: this.kernel.total,
      trimmed: this.kernel.trimmed,
      coherence: +this.kernel.coherence().toFixed(4),
      counters: this.kernel.counters(),
      head: this.kernel.lastHash,
      wraps: this.wraps.map((w) => w.label),
    };
  }
}
