// pane.dom-smoke.mjs — drive QuiltPane against a real DOM (jsdom) the way the
// browser will: mount, toggle, watch cells stream, export the witness.
//
// Deliberately NOT part of `node --test tests/quilt.test.mjs`: that command is
// zero-dependency by design, and this file needs jsdom. Run it from anywhere
// that has jsdom installed, with the paths below pointing at this repo:
//
//   npm i --prefix /somewhere/else jsdom
//   node tools/pane.dom-smoke.mjs
import { JSDOM } from 'jsdom';
import { QuiltBridge } from '../app/quilt/bridge.js';
import { QuiltPane } from '../app/quilt/pane.js';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Blob = dom.window.Blob;
globalThis.URL = dom.window.URL;

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
  generatorCityBlock: { cell_size: 152, grid: [[{ x: 0, z: 0 }]] },
  generatorTraffic: { cell_size: 152, grid: [[{ x: 10, z: 10, cars: [1, 2] }]] },
  player: { body: { position: { x: 1, z: 2 } }, crashed: false, update() {} },
  init() {},
  animate() {},
};

const bridge = new QuiltBridge({ convId: 'pane-smoke' });
bridge.install(game);
const pane = new QuiltPane(bridge);
pane.mount();

const failures = [];
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(label);
};

check('style injected', !!document.querySelector('style') && document.querySelector('style').textContent.includes('#7dffb0'));
check('toggle button exists', document.getElementById('quilt-toggle')?.textContent === '◈');
check('pane starts closed', !document.getElementById('quilt-pane').classList.contains('quilt-open'));

game.init();
check('cells flowed from init', bridge.kernel.counters().VIEW === 1 && bridge.kernel.counters().EFFECT === 1);

// 90 frames -> 3 TICKs, then page turn
for (let i = 0; i < 90; i++) game.animate();
for (let i = 0; i < 600; i++) bridge.kernel.emit('TICK', { frame: i });
bridge.kernel.forget(500);

pane.toggle(true);
check('Q-toggle opens pane', document.getElementById('quilt-pane').classList.contains('quilt-open'));
check('toggle hidden while open', document.getElementById('quilt-toggle').classList.contains('quilt-hidden'));

pane.render();
const text = document.getElementById('quilt-pane').textContent;
check('coherence shown as 1.0000', text.includes('1.0000'), 'page turn must not look like corruption');
// 2 cells at init + 3 ticks + 600 emitted above = 605 dropped at the page turn
check('forgotten count shown', /forgotten\s*605/.test(text.replace(/\s+/g, ' ')), text.replace(/\s+/g, ' ').slice(0, 160));
check('chain head shown', /chain head\s*0x[0-9a-f]{16}…/.test(text.replace(/\s+/g, ' ')));
check('FORGET glyph in tail', text.includes('FORGET'), 'the page turn is the newest cell');
check('all six opcodes in counters', ['BIND', 'LINK', 'EFFECT', 'VIEW', 'TICK', 'FORGET'].every((op) => text.includes(op)));

// no blue/purple anywhere in the pane's own CSS
const css = document.querySelector('style').textContent;
const hues = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)].map((m) => m[0]);
const allowed = /#(7dffb0|a4ffc7|050807)|rgba\(125, ?255, ?176|rgba\(5, ?8, ?7/;
check('pane colors are phosphor/near-black only', hues.every((c) => allowed.test(c)), hues.join(' '));
check('no gradient in pane CSS', !/gradient/i.test(css));

// export: click and capture the anchor href (jsdom has no createObjectURL)
URL.createObjectURL = () => 'blob:https://example.test/witness';
URL.revokeObjectURL = () => {};
let captured = null;
const origCreate = document.createElement.bind(document);
document.createElement = (tag) => {
  const el = origCreate(tag);
  if (tag === 'a') {
    const origClick = el.click.bind(el);
    el.click = () => { captured = el.href; origClick(); };
  }
  return el;
};
document.getElementById('quilt-export').click();
check('witness export produced a blob URL', captured !== null && captured.startsWith('blob:'), String(captured).slice(0, 34));

const lines = bridge.kernel.witnessJsonl().trim().split('\n').map((l) => JSON.parse(l));
check('witness jsonl parses and chains', lines.every((l, i) => i === 0 || l.prev_hash === lines[i - 1].cell_hash));

pane.toggle(false);
check('toggle closes pane', !document.getElementById('quilt-pane').classList.contains('quilt-open'));
check('toggle visible again', !document.getElementById('quilt-toggle').classList.contains('quilt-hidden'));

bridge.detach();
check('detach leaves no wrap', bridge.wraps.length === 0);

console.log(failures.length ? `\n${failures.length} FAILURES` : '\npane smoke test: all checks pass');
process.exit(failures.length ? 1 : 0);
