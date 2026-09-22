// main.js — quilt bootstrap. The only thing upstream loads is this module,
// via the marked <script type="module"> in index.html. Everything else happens
// here: wait for the game's one global, wrap it from outside, mount the pane.
//
// The upstream bundle is an `async` classic script and this file is a deferred
// module, so either may win the race — hence the poll. window.game is assigned
// only after the Game constructor finishes (src/index.js:45), so seeing it
// means the real object is ready to wrap.

import { QuiltBridge } from './bridge.js';
import { QuiltPane } from './pane.js';

const POLL_MS = 50;
const POLL_TIMEOUT_MS = 30000;

function waitForGame(timeout = POLL_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (typeof window !== 'undefined' && window.game) {
        clearInterval(timer);
        resolve(window.game);
        return;
      }
      if (Date.now() - started > timeout) {
        clearInterval(timer);
        reject(new Error('quilt: window.game never appeared'));
      }
    }, POLL_MS);
  });
}

async function boot() {
  let game;
  try {
    game = await waitForGame();
  } catch (err) {
    console.warn(err.message);
    return;
  }

  const bridge = new QuiltBridge({ convId: 'synthcity' });
  bridge.install(game);

  const pane = new QuiltPane(bridge);
  pane.mount();

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'q' && event.key !== 'Q') return;
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    pane.toggle();
  }, false);

  // the substrate is on the record before anything else
  window.quilt = { bridge, pane };
}

boot();
