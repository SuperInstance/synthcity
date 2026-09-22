// kernel.js — the quilt 6-opcode kernel, vendored minimal for synthcity.
// Port of SuperInstance/code-city's app/quilt/kernel.mjs (MIT), reconciled
// against kev-substrate-competition's harness/hashutil.py.
//
// BIND   entity comes into being (city block, traffic group, light)
// LINK   relationship between bound entities (road/vehicle, block release)
// EFFECT something happens to an entity (city light, crash, lighting)
// VIEW   the scene is (re)presented
// TICK   time advances; aggregate counters flow
// FORGET history is trimmed honestly — dormancy is not costume either.
//
// Hash law (byte-aligned with kev harness/hashutil.py):
//   fnv1a64  — FNV-1a 64 over UTF-8 BYTES (TextEncoder), BigInt, BigInt(b) per byte
//   hash16   — "0x" + h.toString(16).padStart(16, "0")
//   genesis  — "0x0000000000000000"
//   cell_hash— hash16(cell_id + state_json + answers_json + prev_hash)
// The preimage order is the harness's, not a local invention: run 1 of this
// port tried prev_hash + state_json and was discarded for it. state_json is
// serialized ONCE and reused verbatim by witness() — re-serializing is where
// interop goes to die (harness/witness.py requires the verbatim wire strings).
//
// Numeric comparison is law. The docs' 17-hex-digit canary spelling carries a
// stray leading zero; format/toString never emits one, and both spellings agree
// as numbers. Never string-compare hashes.
//
// Loaded by the browser as a native ES module (index.html) and by
// `node --test tests/quilt.test.mjs`. The sibling package.json declaring
// "type": "module" scopes that to this directory only; upstream package.json
// is untouched.

export const OPS = Object.freeze(['BIND', 'LINK', 'EFFECT', 'VIEW', 'TICK', 'FORGET']);

export const GENESIS_PREV_HASH = '0x' + '0'.repeat(16);

export const CANARY_VEC = 'café Δ 日本語';
// 18 UTF-8 bytes / 10 JS string indices. Numeric law, never string-compare.
export const CANARY_EXPECTED = 0x24a555471370b18dn;

export function fnv1a64(str) {
  // UTF-8 BYTES, not code points — the fleet canary is a byte hash.
  const bytes = new TextEncoder().encode(str);
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

export function hash16(str) {
  return '0x' + fnv1a64(str).toString(16).padStart(16, '0');
}

export function canaryOk() {
  return fnv1a64(CANARY_VEC) === CANARY_EXPECTED;
}

export const ANSWERS_JSON = '[]';

export function stateJson(op, payload) {
  // The exact wire string whose bytes the preimage digests.
  return JSON.stringify({ op, payload });
}

export function cellHash(cellId, stateJsonStr, answersJson, prevHash) {
  // kev harness/hashutil.py::cell_hash — argument order IS the contract.
  return hash16(cellId + stateJsonStr + answersJson + prevHash);
}

let CELL_SEQ = 0;

export class Kernel {
  constructor(convId = 'synthcity') {
    this.baseConvId = convId;
    this.convId = convId;
    this.segment = 0;
    this.cells = [];      // retained window: always genesis-anchored (see forget)
    this.lastHash = GENESIS_PREV_HASH;
    this.tickCount = 0;   // cells emitted (opcode TICK is a different thing)
    this.trimmed = 0;     // honest dropped count, ever
    this.total = 0;       // cells ever emitted, retained + trimmed
    this.totals = {};     // cumulative per-opcode counts, across page turns
  }

  emit(op, payload = {}) {
    if (!OPS.includes(op)) throw new Error(`unknown opcode: ${op}`);
    this.tickCount++;
    this.total++;
    this.totals[op] = (this.totals[op] || 0) + 1;
    const cell = {
      conv_id: this.convId,
      cell_id: `cell-${CELL_SEQ++}`,
      tick: this.tickCount,
      op,
      payload,
      prev_hash: this.lastHash,
      // kept on the cell so witness() replays the exact digested string
      state_json: stateJson(op, payload),
    };
    cell.cell_hash = cellHash(cell.cell_id, cell.state_json, ANSWERS_JSON, cell.prev_hash);
    this.cells.push(cell);
    this.lastHash = cell.cell_hash;
    return cell;
  }

  // History is trimmed honestly — and in a shape the referee can still replay.
  //
  // A page turn, not a silent truncation: when the window passes `keep`, the
  // kernel opens a new conversation segment whose FIRST cell is the FORGET
  // announcement (prev_hash GENESIS, payload carrying dropped count, the
  // cumulative trimmed_total, and prev_segment_head — the hash the previous
  // segment ended on). The old segment's cells are then released.
  //
  // Why not the simpler prefix-trim (code-city's kernel trims the front and
  // keeps a 500-cell window whose first cell points into dropped memory)?
  // Because kev harness/replay.py requires a conversation's first cell to
  // anchor on GENESIS: that window exports as a log whose very first line is
  // "genesis cell with non-genesis prev_hash", collapsing coherence to ~0 for
  // any run long enough to need trimming — an honest log scored as a forged
  // one. Here every export is genesis-anchored and replays at coherence 1.0
  // for runs of any length, and the trim is announced IN the chain instead of
  // leaving a dangling pointer. Local history is shorter after a page turn;
  // that cost is real and accepted — the ledger visibly turns a page.
  forget(keep = 500) {
    if (this.cells.length <= keep) return null;
    const dropping = this.cells.length;
    const prevHead = this.lastHash;
    this.trimmed += dropping;
    this.segment++;
    this.convId = `${this.baseConvId}#${this.segment}`;
    this.lastHash = GENESIS_PREV_HASH;
    const cell = this.emit('FORGET', {
      dropped: dropping,
      trimmed_total: this.trimmed,
      prev_segment_head: prevHead,
      segment: this.segment,
    });
    this.cells = [cell];
    return cell;
  }

  // Cumulative for the whole run — the pane's counters survive a page turn.
  counters() {
    return { ...this.totals };
  }

  // Counts over the retained window only.
  windowCounters() {
    const c = {};
    for (const cell of this.cells) c[cell.op] = (c[cell.op] || 0) + 1;
    return c;
  }

  // Local re-verification of the retained window. Not a substitute for
  // kev harness/replay.py — the harness replays the exported witness.
  //
  // genesisAnchored: set false when verifying a SLICE that starts mid-chain —
  // its first prev_hash points at a cell the slice doesn't contain. Verifying
  // such a slice against GENESIS reports a healthy chain as corrupt: a false
  // coherence drop, exactly the dishonesty FORGET exists to avoid. Default
  // true (strict). forget() keeps the retained window genesis-anchored, so the
  // strict default is the law for whole windows; the flag exists for slices
  // and is regression-guarded by the tests.
  verify({ genesisAnchored = true } = {}) {
    let expected = genesisAnchored ? GENESIS_PREV_HASH : null;
    let verified = 0;
    let firstBreak = null;
    for (const cell of this.cells) {
      const recomputed = cellHash(cell.cell_id, cell.state_json, ANSWERS_JSON, cell.prev_hash);
      if (expected !== null && cell.prev_hash !== expected) {
        if (firstBreak === null) {
          firstBreak = { index: verified, reason: 'prev_hash does not chain' };
        }
        break;
      }
      if (recomputed !== cell.cell_hash) {
        if (firstBreak === null) {
          firstBreak = { index: verified, reason: 'cell_hash mismatch (payload tampered)' };
        }
        break;
      }
      verified++;
      expected = cell.cell_hash;
    }
    return { ok: firstBreak === null, verified, firstBreak };
  }

  coherence() {
    if (this.cells.length === 0) return 1;
    const { verified } = this.verify({ genesisAnchored: this.trimmed === 0 });
    return verified / this.cells.length;
  }

  witness() {
    // kev harness JSONL shape — the 7 required keys, verbatim strings.
    return this.cells.map((c) => ({
      conv_id: c.conv_id,
      cell_id: c.cell_id,
      tick: c.tick,
      state_json: c.state_json,
      answers_json: ANSWERS_JSON,
      prev_hash: c.prev_hash,
      cell_hash: c.cell_hash,
    }));
  }

  witnessJsonl() {
    return this.witness().map((c) => JSON.stringify(c)).join('\n') + '\n';
  }
}
