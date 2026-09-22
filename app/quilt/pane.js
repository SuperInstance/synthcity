// pane.js — the ◈ substrate pane. Press Q (or click ◈) while playing and the
// ledger shows itself: live cell tail, opcode counters, coherence, chain head,
// and a witness.jsonl export a referee can replay.
//
// Phosphor law: #7dffb0 on near-black. No gradients — blue-purple is what a
// neon city already is; the ledger stays a CRT, not a second neon sign.

const PHOSPHOR = '#7dffb0';
const TAIL_LENGTH = 14;

const OP_GLYPH = {
  BIND: '◆',
  LINK: '─',
  EFFECT: '✦',
  VIEW: '◉',
  TICK: '·',
  FORGET: '∅',
};

const CSS = `
#quilt-pane {
  position: fixed;
  top: 12px;
  right: 12px;
  width: 348px;
  max-height: calc(100vh - 24px);
  overflow: hidden;
  z-index: 9999;
  background: #050807;
  border: 1px solid rgba(125, 255, 176, 0.28);
  color: ${PHOSPHOR};
  font: 12px/1.45 "Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 10px 12px 12px;
  letter-spacing: 0.02em;
  display: none;
}
#quilt-pane.quilt-open { display: block; }
#quilt-pane .quilt-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  border-bottom: 1px solid rgba(125, 255, 176, 0.22);
  padding-bottom: 6px;
  margin-bottom: 8px;
}
#quilt-pane .quilt-title { color: ${PHOSPHOR}; }
#quilt-pane .quilt-hint { color: rgba(125, 255, 176, 0.55); font-size: 10px; }
#quilt-pane .quilt-row { display: flex; justify-content: space-between; gap: 8px; }
#quilt-pane .quilt-k { color: rgba(125, 255, 176, 0.6); }
#quilt-pane .quilt-v { color: ${PHOSPHOR}; text-align: right; word-break: break-all; }
#quilt-pane .quilt-counters { margin: 8px 0; }
#quilt-pane .quilt-tail {
  margin-top: 8px;
  border-top: 1px solid rgba(125, 255, 176, 0.22);
  padding-top: 6px;
  min-height: 20px;
}
#quilt-pane .quilt-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#quilt-pane .quilt-cell.quilt-newest { background: rgba(125, 255, 176, 0.12); }
#quilt-pane .quilt-op { display: inline-block; width: 58px; }
#quilt-pane .quilt-tail .quilt-op { color: ${PHOSPHOR}; }
#quilt-pane .quilt-dim { color: rgba(125, 255, 176, 0.45); }
#quilt-pane button.quilt-btn {
  font: inherit;
  font-size: 11px;
  color: #050807;
  background: ${PHOSPHOR};
  border: 0;
  padding: 3px 8px;
  cursor: pointer;
  margin-top: 8px;
}
#quilt-pane button.quilt-btn:hover { background: #a4ffc7; }
#quilt-toggle {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 9998;
  width: 30px;
  height: 30px;
  line-height: 28px;
  text-align: center;
  font: 14px/28px "Share Tech Mono", ui-monospace, monospace;
  color: ${PHOSPHOR};
  background: rgba(5, 8, 7, 0.82);
  border: 1px solid rgba(125, 255, 176, 0.32);
  cursor: pointer;
  display: block;
  user-select: none;
}
#quilt-toggle.quilt-hidden { display: none; }
`;

export class QuiltPane {
  constructor(bridge, { document = globalThis.document } = {}) {
    this.bridge = bridge;
    this.doc = document;
    this.open = false;
    this.unsub = null;
    this.el = null;
    this.toggleEl = null;
    this.tail = [];
  }

  mount() {
    const doc = this.doc;
    if (!doc || !doc.body) return this;
    if (this.el) return this;

    const style = doc.createElement('style');
    style.textContent = CSS;
    doc.head.appendChild(style);

    this.toggleEl = doc.createElement('div');
    this.toggleEl.id = 'quilt-toggle';
    this.toggleEl.textContent = '◈';
    this.toggleEl.title = 'quilt substrate (Q)';
    this.toggleEl.addEventListener('click', () => this.toggle());

    this.el = doc.createElement('div');
    this.el.id = 'quilt-pane';
    this.el.innerHTML = [
      '<div class="quilt-head">',
      '  <span class="quilt-title">◈ quilt substrate</span>',
      '  <span class="quilt-hint">Q to close</span>',
      '</div>',
      '<div class="quilt-row"><span class="quilt-k">chain head</span><span class="quilt-v" id="quilt-head">—</span></div>',
      '<div class="quilt-row"><span class="quilt-k">cells</span><span class="quilt-v" id="quilt-cells">0</span></div>',
      '<div class="quilt-row"><span class="quilt-k">coherence</span><span class="quilt-v" id="quilt-coh">1.0000</span></div>',
      '<div class="quilt-row"><span class="quilt-k">forgotten</span><span class="quilt-v" id="quilt-forgotten">0</span></div>',
      '<div class="quilt-counters" id="quilt-counters"></div>',
      '<div class="quilt-tail"><div class="quilt-dim">waiting for the city…</div></div>',
      '<button class="quilt-btn" id="quilt-export">⤓ witness.jsonl</button>',
    ].join('\n');

    doc.body.appendChild(this.toggleEl);
    doc.body.appendChild(this.el);

    this.el.querySelector('#quilt-export').addEventListener('click', () => this.exportWitness());

    this.unsub = this.bridge.onCell((cell) => this.#onCell(cell));
    this.render();
    return this;
  }

  toggle(force) {
    const next = typeof force === 'boolean' ? force : !this.open;
    this.open = next;
    if (this.el) {
      this.el.classList.toggle('quilt-open', next);
      this.toggleEl.classList.toggle('quilt-hidden', next);
    }
    if (next) this.render();
    return this.open;
  }

  #onCell(cell) {
    // keep the tail even while the pane is closed, so opening it is instant
    this.tail.push(cell);
    if (this.tail.length > TAIL_LENGTH) this.tail.shift();
    if (this.open) this.render();
  }

  render() {
    if (!this.el || !this.open) return;
    const s = this.bridge.stats();
    const doc = this.doc;
    doc.getElementById('quilt-head').textContent = s.head.slice(0, 18) + '…';
    doc.getElementById('quilt-cells').textContent =
      `${s.cells} live / ${s.total} emitted`;
    doc.getElementById('quilt-coh').textContent = s.coherence.toFixed(4);
    doc.getElementById('quilt-forgotten').textContent = String(s.trimmed);

    const order = ['BIND', 'LINK', 'EFFECT', 'VIEW', 'TICK', 'FORGET'];
    doc.getElementById('quilt-counters').innerHTML = order
      .map((op) => {
        const n = s.counters[op] || 0;
        return `<div class="quilt-row"><span class="quilt-k">${OP_GLYPH[op]} ${op}</span>` +
          `<span class="quilt-v">${n}</span></div>`;
      })
      .join('');

    const tailEl = this.el.querySelector('.quilt-tail');
    tailEl.innerHTML = this.tail.length
      ? this.tail
          .map((c, i) => {
            const cls = i === this.tail.length - 1 ? 'quilt-cell quilt-newest' : 'quilt-cell';
            const body = truncate(JSON.stringify(c.payload), 40);
            return `<div class="${cls}"><span class="quilt-op">${OP_GLYPH[c.op] || '?'} ${c.op}` +
              `</span><span class="quilt-dim">#${c.tick}</span> ${escapeHtml(body)}</div>`;
          })
          .join('')
      : '<div class="quilt-dim">waiting for the city…</div>';
  }

  exportWitness() {
    const jsonl = this.bridge.kernel.witnessJsonl();
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = this.doc.createElement('a');
    a.href = url;
    a.download = 'witness.jsonl';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
