// quilt.test.mjs — the laws the synthcity quilt port has to hold.
//
//   node --test tests/quilt.test.mjs
//
// No dependencies. Node's built-in runner, node:test. The kev-side verifier
// below is written INDEPENDENTLY of app/quilt/kernel.js (own FNV loop, own
// preimage assembly, own replay) so that kernel↔harness agreement is evidence,
// not a tautology: it mirrors kev-substrate-competition harness/hashutil.py
// (cell_hash = hash16(cell_id + state_json + answers_json + prev_hash)) and
// harness/replay.py (chain + strictly increasing tick per conversation).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  OPS,
  GENESIS_PREV_HASH,
  CANARY_VEC,
  CANARY_EXPECTED,
  fnv1a64,
  hash16,
  canaryOk,
  Kernel,
} from '../app/quilt/kernel.js';
import { QuiltBridge } from '../app/quilt/bridge.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------------------
// kev-side reference: independent of the kernel under test
// --------------------------------------------------------------------------

function kevFnv1a64(s) {
  // harness/hashutil.py: UTF-8 bytes, FNV-1a 64
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(s, 'utf8')) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

const kevHash16 = (s) => '0x' + kevFnv1a64(s).toString(16).padStart(16, '0');

const kevCellHash = (cellId, stateJson, answersJson, prevHash) =>
  kevHash16(cellId + stateJson + answersJson + prevHash);

// harness/replay.py::verify_log, reduced to what a witness producer must satisfy
function kevVerifyLog(cells) {
  const convLast = new Map();
  let verified = 0;
  let firstBreakIndex = null;
  let firstBreakReason = null;
  for (let idx = 0; idx < cells.length; idx++) {
    const c = cells[idx];
    const reasons = [];
    const recomputed = kevCellHash(c.cell_id, c.state_json, c.answers_json, c.prev_hash);
    if (recomputed !== c.cell_hash) reasons.push('cell_hash mismatch (payload tampered)');
    const prior = convLast.get(c.conv_id);
    if (prior === undefined) {
      if (c.prev_hash !== GENESIS_PREV_HASH) reasons.push('genesis cell with non-genesis prev_hash');
    } else {
      if (c.prev_hash !== prior.hash) reasons.push('prev_hash does not chain to prior cell');
      if (c.tick <= prior.tick) reasons.push('tick not increasing (order rewound)');
    }
    if (reasons.length > 0) {
      if (firstBreakIndex === null) {
        firstBreakIndex = idx;
        firstBreakReason = reasons.join('; ');
      }
      continue; // chain state does not advance — the blast radius is the point
    }
    verified++;
    convLast.set(c.conv_id, { hash: c.cell_hash, tick: c.tick });
  }
  return {
    total: cells.length,
    verified,
    coherence: cells.length ? verified / cells.length : 1,
    firstBreakIndex,
    firstBreakReason,
  };
}

// a fake game with the real shapes the bridge wraps (see src/index.js,
// src/classes/Generator.js) — no three.js, no window. The generators mimic
// Generator.js: add_items FILLS the grid with new spawn_obj instances,
// remove_items releases some and nulls their slots.
function fakeGame() {
  const items = (from, n) =>
    Array.from({ length: n }, (_, i) => ({ x: 100 + (from + i) * 152, z: 200 + (from + i) * 152 }));
  const generator = (count) => {
    const gen = {
      cell_size: 152,
      pending: [], // items the next add_items spawns (tests queue lights here)
      grid: [items(0, count)],
    };
    gen.add_items = function () {
      // the real one only fills empty slots; model that by appending new items
      const extra = this.pending.length ? this.pending : items(this.grid[0].length, 2);
      this.pending = [];
      this.grid[0] = this.grid[0].concat(extra);
    };
    gen.remove_items = function () {
      this.grid[0] = this.grid[0].slice(0, Math.max(0, this.grid[0].length - 3));
    };
    return gen;
  };
  const game = {
    initialized: false,
    settings: { mode: 'drive', worldSeed: 9746, renderScaling: 1 },
    environment: {
      name: 'night',
      fog: { color: 0x12122a, end: 2700 },
      sun: { color: 0x8b79ff, intensity: 0.1 },
      ambient: { color: 0x1b2c80 },
      cityLights: true,
      spotLights: true,
    },
    cityBlockSize: 128,
    roadWidth: 24,
    generatorCityBlock: generator(4),
    generatorTraffic: generator(3),
    generatorCityLights: generator(2),
    player: { body: { position: { x: 0, z: 0 } }, crashed: false, updates: 0, update() { this.updates++; return 7; } },
    frames: 0,
    inits: 0,
    init() {
      this.inits++;
      return 'init';
    },
    animate() {
      this.frames++;
      return 'frame';
    },
  };
  return game;
}

// a generator whose add_items installs items carrying a lightIndex (city lights)
// — GeneratorItem_CityLight leaves lightIndex null when it placed no light
function lightItem(x, z, lightIndex) {
  return { x, z, lightIndex };
}

// --------------------------------------------------------------------------

test('canary byte law: fnv1a64 over UTF-8 bytes pins café Δ 日本語', () => {
  assert.equal(canaryOk(), true);
  assert.equal(fnv1a64(CANARY_VEC), CANARY_EXPECTED);
  assert.equal(fnv1a64(CANARY_VEC), 0x24a555471370b18dn);
  // 18 UTF-8 bytes / 10 JS string indices — the pin is a BYTE hash
  assert.equal(Buffer.byteLength(CANARY_VEC, 'utf8'), 18);
  assert.equal(CANARY_VEC.length, 10);
});

test('byte law is byte law: a code-point loop cannot pass the pin', () => {
  // the ord-per-codepoint variant kev/hashutil.py documents as the failure mode
  let h = 0xcbf29ce484222325n;
  for (const ch of CANARY_VEC) {
    h ^= BigInt(ch.codePointAt(0));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  assert.equal(h, 0x77ff2029b867f2b5n); // the documented wrong answer
  assert.notEqual(h, fnv1a64(CANARY_VEC));
});

test('FNV reference vectors and hash16 format law', () => {
  assert.equal(fnv1a64(''), 0xcbf29ce484222325n); // offset basis
  assert.equal(fnv1a64('a'), 0xaf63dc4c8601ec8cn);
  assert.equal(hash16(''), '0xcbf29ce484222325');
  // a vector whose hash actually has a leading zero hex digit: toString(16)
  // alone would emit 15 digits, padStart(16) is what keeps the width honest
  assert.equal(fnv1a64('q0-0'), 0x0c086a0685de4ec1n);
  assert.equal(hash16('q0-0'), '0x0c086a0685de4ec1');
  for (const s of ['', 'a', 'synthcity', CANARY_VEC, 'q0-0']) {
    assert.match(hash16(s), /^0x[0-9a-f]{16}$/);
    assert.equal(BigInt(hash16(s)), fnv1a64(s));
  }
  // the docs' 17-hex-digit spelling carries a stray leading zero; both agree
  // as NUMBERS. String comparison is not the law.
  assert.equal(CANARY_EXPECTED, 0x024a555471370b18dn);
  assert.equal(CANARY_EXPECTED.toString(16), '24a555471370b18d');
});

test('genesis is 0x0000000000000000 and the first cell anchors on it', () => {
  assert.equal(GENESIS_PREV_HASH, '0x0000000000000000');
  const k = new Kernel('t');
  const c0 = k.emit('VIEW', {});
  assert.equal(c0.prev_hash, GENESIS_PREV_HASH);
  assert.equal(c0.cell_hash, hash16(c0.cell_id + c0.state_json + '[]' + GENESIS_PREV_HASH));
});

test('emit chains every cell; unknown opcodes are refused', () => {
  const k = new Kernel('t');
  const cells = [k.emit('BIND', { kind: 'block' }), k.emit('LINK', { kind: 'road' }), k.emit('TICK', {})];
  assert.deepEqual(OPS, ['BIND', 'LINK', 'EFFECT', 'VIEW', 'TICK', 'FORGET']);
  for (let i = 1; i < cells.length; i++) assert.equal(cells[i].prev_hash, cells[i - 1].cell_hash);
  assert.equal(k.lastHash, cells[cells.length - 1].cell_hash);
  assert.throws(() => k.emit('SPAWN', {}), /unknown opcode/);
});

test('preimage law: kev cell_hash(cell_id, state_json, answers_json, prev_hash) reproduces every cell', () => {
  const k = new Kernel('interop');
  k.emit('VIEW', { scene: 'synthcity' });
  k.emit('BIND', { kind: 'block', x: -12, z: 64 });
  k.emit('LINK', { kind: 'road', cars: 2 });
  k.emit('EFFECT', { kind: 'city-light', x: 3.5, z: -7.25 });
  k.emit('TICK', { frame: 30 });
  const witness = k.witness();
  for (const line of witness) {
    const expect = kevCellHash(line.cell_id, line.state_json, line.answers_json, line.prev_hash);
    assert.equal(line.cell_hash, expect, `cell ${line.cell_id} must satisfy the kev preimage`);
  }
  assert.equal(kevVerifyLog(witness).coherence, 1);
});

test('witness lines carry exactly the kev field names, verbatim strings', () => {
  const k = new Kernel('interop');
  k.emit('BIND', { kind: 'block', x: 1, z: 2 });
  const [line] = k.witness();
  assert.deepEqual(
    Object.keys(line).sort(),
    ['answers_json', 'cell_hash', 'cell_id', 'conv_id', 'prev_hash', 'state_json', 'tick'],
  );
  assert.equal(typeof line.state_json, 'string');
  assert.equal(typeof line.answers_json, 'string');
  assert.equal(line.answers_json, '[]');
  assert.deepEqual(JSON.parse(line.state_json), { op: 'BIND', payload: { kind: 'block', x: 1, z: 2 } });
  // witnessJsonl is the same rows, one JSON object per line, newline-terminated
  const jsonl = k.witnessJsonl();
  assert.deepEqual(JSON.parse(jsonl.trim()), line);
  assert.match(jsonl, /\n$/);
});

test('tamper drops local coherence and the referee agrees on the blast radius', () => {
  const k = new Kernel('tamper');
  for (let i = 0; i < 6; i++) k.emit('TICK', { frame: i });
  const witness = k.witness();

  // the retained window, honestly: coherence 1
  assert.equal(k.coherence(), 1);

  // rewrite one cell's payload the way a forger would (leaving hashes alone)
  const tampered = JSON.parse(JSON.stringify(witness));
  tampered[3].state_json = JSON.stringify({ op: 'TICK', payload: { frame: 999 } });
  const local = k.verify();
  assert.equal(local.ok, true); // window itself is untouched

  // kernel-level tamper: mutate a cell in place
  k.cells[3].payload.frame = 999;
  k.cells[3].state_json = JSON.stringify({ op: 'TICK', payload: { frame: 999 } });
  const after = k.verify();
  assert.equal(after.ok, false);
  assert.equal(after.firstBreak.index, 3);
  assert.match(after.firstBreak.reason, /cell_hash mismatch/);
  assert.equal(k.coherence(), 3 / 6); // verified / total, blast radius visible

  // kev replay on the exported log: same verdict, same break point
  const rep = kevVerifyLog(JSON.parse(JSON.stringify(k.witness())));
  assert.equal(rep.firstBreakIndex, 3);
  assert.match(rep.firstBreakReason, /cell_hash mismatch/);
  assert.equal(rep.coherence, 3 / 6);

  // and a chain break (rewired prev_hash) is caught too
  const k2 = new Kernel('rewire');
  k2.emit('VIEW', {});
  k2.emit('BIND', {});
  k2.cells[1].prev_hash = GENESIS_PREV_HASH;
  assert.equal(k2.verify().ok, false);
  assert.match(k2.verify().firstBreak.reason, /does not chain/);
  void witness;
});

test('FORGET turns the page honestly: dropped count is announced in the chain', () => {
  const k = new Kernel('forget');
  for (let i = 0; i < 501; i++) k.emit('TICK', { frame: i });
  const headBefore = k.lastHash;
  const tickBefore = k.tickCount;

  const cell = k.forget(500);
  assert.notEqual(cell, null);
  assert.equal(cell.op, 'FORGET');
  assert.equal(cell.payload.dropped, 501);
  assert.equal(cell.payload.trimmed_total, 501);
  assert.equal(cell.payload.prev_segment_head, headBefore);
  assert.equal(cell.payload.segment, 1);
  // the page turn does not rewind the run's clock
  assert.equal(cell.tick, tickBefore + 1);

  // below the threshold: no cell, no change
  assert.equal(k.forget(500), null);
  assert.equal(k.forget(10), null);
});

test('post-FORGET window verifies strictly and exports a witness the referee replays at 1.0', () => {
  const k = new Kernel('page-turn');
  for (let i = 0; i < 600; i++) k.emit('BIND', { i });
  k.forget(500);

  // the retained window is genesis-anchored, so the STRICT law holds — no
  // special pleading, no "trust me, the prefix existed"
  const v = k.verify();
  assert.equal(v.ok, true, JSON.stringify(v.firstBreak));
  assert.equal(k.coherence(), 1);
  assert.equal(k.cells[0].prev_hash, GENESIS_PREV_HASH);
  assert.equal(k.cells[0].op, 'FORGET');

  // and the referee — the real preimage, the real replay rules — agrees
  const rep = kevVerifyLog(k.witness());
  assert.equal(rep.verified, rep.total);
  assert.equal(rep.coherence, 1);

  // a second page turn keeps both properties
  for (let i = 0; i < 600; i++) k.emit('BIND', { i });
  const totalBefore = k.total;
  k.forget(500);
  assert.equal(k.trimmed, totalBefore); // everything ever emitted is now trimmed
  assert.equal(k.verify().ok, true);
  assert.equal(kevVerifyLog(k.witness()).coherence, 1);
  assert.notEqual(k.convId, k.baseConvId); // segments are distinct conversations
});

test('slice law: a mid-chain slice needs the suffix-aware flag, and it works', () => {
  // regression guard for the known-good fix this port inherited: verifying a
  // slice against GENESIS reports healthy chain as corrupt
  const k = new Kernel('slice');
  for (let i = 0; i < 10; i++) k.emit('VIEW', { i });
  const slice = k.cells.slice(4); // starts mid-chain
  const tamperFree = slice.map((c) => ({ ...c }));
  assert.equal(tamperFree.every((c) => c.prev_hash !== GENESIS_PREV_HASH), true);

  // re-verify through a Kernel-shaped pass so the flag itself is exercised
  const probe = new Kernel('probe');
  probe.cells = tamperFree;
  assert.equal(probe.verify({ genesisAnchored: true }).ok, false);
  const suffix = probe.verify({ genesisAnchored: false });
  assert.equal(suffix.ok, true);
  assert.equal(suffix.verified, tamperFree.length);
});

test('counters survive a page turn (cumulative) while window counters do not', () => {
  const k = new Kernel('counters');
  k.emit('VIEW', {});
  for (let i = 0; i < 300; i++) k.emit('BIND', { i });
  k.forget(100);
  for (let i = 0; i < 50; i++) k.emit('TICK', { i });
  assert.deepEqual(k.counters(), { VIEW: 1, BIND: 300, FORGET: 1, TICK: 50 });
  assert.deepEqual(k.windowCounters(), { FORGET: 1, TICK: 50 });
  assert.equal(k.total, 352);
});

test('wrapper fidelity: originals still run, args and returns pass through, ledger trails the act', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'fidelity', tickEvery: 30, keep: 500 });
  bridge.install(game);

  const seen = [];
  bridge.onCell((cell) => seen.push(cell.op));
  assert.equal(game.init('arg0'), 'init'); // original return value preserved
  assert.equal(game.inits, 1);
  // launch recorded the scene, then its lighting — the city acted first
  assert.deepEqual(seen, ['VIEW', 'EFFECT']);

  assert.equal(game.animate(), 'frame');
  assert.equal(game.frames, 1);
  assert.equal(seen.length, 2, 'frame 1 is below the tick cadence, so no cell');

  // the player's own update is untouched in behavior
  assert.equal(game.player.update(), 7);
  assert.equal(game.player.updates, 1);
  assert.equal(seen.length, 2);
  assert.deepEqual(
    bridge.kernel.cells.filter((c) => c.op === 'EFFECT').map((c) => c.payload.kind),
    ['lighting'],
  );

  // detach: the game object is exactly what upstream shipped
  const wraps = bridge.wraps.map((w) => `${w.label}`);
  assert.ok(wraps.includes('Game.init'));
  assert.ok(wraps.includes('Game.animate'));
  assert.ok(wraps.includes('player.update'));
  const totalBeforeDetach = bridge.kernel.total;
  bridge.detach();
  assert.equal(bridge.wraps.length, 0);
  assert.equal(game.init(), 'init');
  assert.equal(bridge.kernel.total, totalBeforeDetach, 'no ledger activity after detach');
});

test('city init emits VIEW then the lighting EFFECT, with real scene facts', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'init' });
  bridge.install(game);
  game.init();

  const [view, lighting] = bridge.kernel.cells;
  assert.equal(view.op, 'VIEW');
  assert.deepEqual(view.payload, {
    scene: 'synthcity',
    environment: 'night',
    mode: 'drive',
    world_seed: 9746,
    city_block_size: 128,
    road_width: 24,
    render_scaling: 1,
  });
  assert.equal(lighting.op, 'EFFECT');
  assert.equal(lighting.payload.kind, 'lighting');
  assert.equal(lighting.payload.fog_color, '#12122a');
  assert.equal(lighting.payload.sun_color, '#8b79ff');
  assert.equal(lighting.payload.ambient_color, '#1b2c80');
  assert.equal(lighting.payload.city_lights, true);
});

test('spawn points: blocks BIND, roads/vehicles LINK, releases are aggregated', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'spawn' });
  bridge.install(game);
  game.init(); // wraps the generators, grid already populated (Generator's
  // constructor calls add_items before the bridge ever sees it)

  bridge.kernel.cells.length = 0; // isolate the spawn acts

  // first spawn after install: the 4 pre-existing blocks are new to the ledger
  // too, and each live block gets exactly ONE BIND (WeakSet de-dupes)
  game.generatorCityBlock.add_items();
  let binds = bridge.kernel.cells.filter((c) => c.op === 'BIND');
  assert.equal(binds.length, 6);
  assert.equal(binds[0].payload.kind, 'block');
  assert.equal(binds[0].payload.cell_size, 152);
  assert.equal(typeof binds[0].payload.x, 'number');

  // the next spawn only announces the genuinely new blocks
  game.generatorCityBlock.add_items();
  binds = bridge.kernel.cells.filter((c) => c.op === 'BIND');
  assert.equal(binds.length, 8);

  game.generatorTraffic.add_items();
  const links = bridge.kernel.cells.filter((c) => c.op === 'LINK');
  assert.ok(links.length >= 2);
  assert.equal(links[0].payload.kind, 'road');

  game.generatorCityBlock.remove_items(); // release is aggregated, not a cell
  const extra = bridge.kernel.cells.filter((c) => c.op !== 'BIND' && c.op !== 'LINK');
  assert.equal(extra.length, 0);
  assert.ok(bridge.counts.blocksReleased > 0);
});

test('city lights only record when a light actually placed (lightIndex law)', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'lights' });
  bridge.install(game);
  game.init();
  bridge.kernel.cells.length = 0;
  bridge.seenItems = new WeakSet();
  game.generatorCityLights.grid[0] = [];

  // GeneratorItem_CityLight leaves lightIndex null when every light is taken:
  // a spawn that placed no light is not a lighting cell
  game.generatorCityLights.pending = [lightItem(9, 9, null)];
  game.generatorCityLights.add_items();
  assert.equal(bridge.kernel.cells.length, 0);

  game.generatorCityLights.pending = [lightItem(5, 6, 0)];
  game.generatorCityLights.add_items();
  const effects = bridge.kernel.cells.filter((c) => c.op === 'EFFECT');
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].payload, { kind: 'city-light', x: 5, z: 6 });
});

test('tick cadence: exactly one TICK every Nth frame, and FORGET rides the loop', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'cadence', tickEvery: 30, keep: 500 });
  bridge.install(game);

  for (let i = 0; i < 90; i++) game.animate();
  const ticks = bridge.kernel.cells.filter((c) => c.op === 'TICK');
  assert.equal(ticks.length, 3);
  assert.deepEqual(
    ticks.map((c) => c.payload.frame),
    [30, 60, 90],
  );

  // a bridge with a small keep trims inside the loop and says so
  const game2 = fakeGame();
  const small = new QuiltBridge({ convId: 'cadence-trim', tickEvery: 5, keep: 10 });
  small.install(game2);
  for (let i = 0; i < 100; i++) game2.animate();
  const forgets = small.kernel.cells.filter((c) => c.op === 'FORGET');
  assert.ok(forgets.length >= 1);
  assert.ok(small.kernel.trimmed > 0);
  assert.equal(small.kernel.verify().ok, true);
  assert.equal(kevVerifyLog(small.kernel.witness()).coherence, 1);
});

test('crash and recover are EFFECT cells observed after the player acts', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'crash' });
  bridge.install(game);
  game.init();
  bridge.kernel.cells.length = 0;

  game.player.update(); // still upright
  assert.equal(bridge.kernel.cells.length, 0);

  game.player.crashed = true;
  game.player.update();
  const crash = bridge.kernel.cells[0];
  assert.deepEqual(crash.payload, { kind: 'crash', x: 0, z: 0 });

  game.player.crashed = false;
  game.player.update();
  assert.deepEqual(bridge.kernel.cells[1].payload, { kind: 'recover' });
  assert.equal(bridge.counts.crashes, 1);

  // no duplicate while the state holds
  game.player.update();
  assert.equal(bridge.kernel.cells.length, 2);
});

test('bridge stats report the chain a pane needs', () => {
  const game = fakeGame();
  const bridge = new QuiltBridge({ convId: 'stats' });
  bridge.install(game);
  game.init();
  game.animate();
  const s = bridge.stats();
  assert.equal(s.coherence, 1);
  assert.match(s.head, /^0x[0-9a-f]{16}$/);
  assert.equal(s.cells, bridge.kernel.cells.length);
  assert.ok(Array.isArray(s.wraps) && s.wraps.length > 0);
});

// --------------------------------------------------------------------------
// repository law: upstream untouched, credit intact
// --------------------------------------------------------------------------

test('MIT LICENSE ships intact', () => {
  const license = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License\n/);
  assert.match(license, /Copyright \(c\) 2024 Jeff Beene/);
  assert.match(license, /Permission is hereby granted, free of charge/);
  // the fork's own additions are MIT too, and say whose work is whose
  const kernel = readFileSync(join(ROOT, 'app/quilt/kernel.js'), 'utf8');
  assert.match(kernel, /Port of SuperInstance\/code-city's app\/quilt\/kernel.mjs \(MIT\)/);
});

test('upstream credit survives the fork: README and the game itself still say whose city this is', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  assert.match(readme, /jeffbeene\/synthcity/);
  assert.match(readme, /Jeff Beene/);
  assert.match(readme, /MIT/);
  assert.match(readme, /byte-identical/i);

  // index.html is the creator's own boot screen; its credit lines are load-bearing
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /<title>SynthCity<\/title>/);
  assert.match(html, /An interactive audiovisual experience by Jeff Beene/);
});

test('byte-identity: every upstream file is exactly the bytes this fork branched from', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tests/upstream-manifest.json'), 'utf8'));
  const files = Object.keys(manifest.files);
  assert.ok(files.length >= 20, `manifest should guard the source tree, found ${files.length}`);
  assert.ok(!('README.md' in manifest.files), 'README is intentionally rebuilt, not guarded');

  // index.html is the ONE permitted upstream edit; its exact delta is asserted
  // by the next test, so it is excluded from the wholesale check here
  const drifted = [];
  for (const rel of files) {
    if (rel === 'index.html') continue;
    const bytes = readFileSync(join(ROOT, rel));
    const got = createHash('sha256').update(bytes).digest('hex');
    if (got !== manifest.files[rel]) drifted.push(rel);
  }
  assert.deepEqual(drifted, [], `upstream files modified: ${drifted.join(', ')}`);
});

test('index.html delta is the marked quilt block and nothing else', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'tests/upstream-manifest.json'), 'utf8'));
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

  const BEGIN = '<!-- BEGIN quilt substrate';
  const END = '<!-- END quilt substrate -->';
  // the block is appended after the last upstream script tag plus one blank
  // line, so removing "\n\n" + BEGIN…END inclusive restores the upstream bytes
  const begin = html.indexOf('\n\n    ' + BEGIN);
  const end = html.indexOf(END);
  assert.ok(begin !== -1, 'quilt block is marked');
  assert.ok(end > begin, 'quilt block is closed');

  const restored = html.slice(0, begin) + html.slice(end + END.length);
  const got = createHash('sha256').update(Buffer.from(restored, 'utf8')).digest('hex');
  assert.equal(
    got,
    manifest.files['index.html'],
    'index.html changed outside the marked quilt block',
  );

  // the block itself does the one thing it is allowed to do
  const block = html.slice(begin, end);
  assert.match(block, /<script type="module" src="app\/quilt\/main.js"><\/script>/);
});
