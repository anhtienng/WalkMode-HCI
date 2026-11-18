// Bootstrap + hash router.

import { motion } from './motion.js';
import { Adapter, installSizeStyles } from './adapt.js';
import { clear, isCoarsePointer, query } from './util.js';
import { renderHome } from './home.js';
import { renderStudy } from './study.js';
import { renderDemo } from './demo.js';
import { renderMonitor } from './monitor.js';
import { renderSessions } from './sessions.js';

installSizeStyles();
const adapter = new Adapter(motion);
const view = document.getElementById('view');
const ctx = { motion, adapter, view };

// ---- sensors ----
if (!motion.needsPermission()) motion.startDevice(); // Android / desktop: no prompt needed
if (query.get('sim') === '1') {
  motion.enableSim(true);
} else if (!isCoarsePointer()) {
  // Desktop without a motion sensor: fall back to simulation so the app is testable.
  motion.waitForDeviceSamples(1500).then((got) => { if (!got && motion.source === 'none') motion.enableSim(true); });
}

const dot = document.getElementById('sensor-dot');
const drawDot = () => {
  dot.dataset.source = motion.source;
  dot.dataset.state = motion.state;
  dot.title = `Sensor: ${motion.source} · ${motion.state}`;
};
motion.on('status', drawDot);
motion.on('state', drawDot);
drawDot();

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.key === 'w' || e.key === 'W') motion.toggleSimWalking();
});

// expose for debugging in the console
window.walkmode = ctx;

// ---- router ----
const routes = {
  '': (p) => renderHome(view, ctx, p),
  study: (p) => renderStudy(view, ctx, p),
  demo: (p) => renderDemo(view, ctx, p),
  monitor: (p) => renderMonitor(view, ctx, p),
  sessions: (p) => renderSessions(view, ctx, p),
};

let cleanup = null;
function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || '';
  const params = {};
  if (name === 'study' && parts[1] === 'resume' && parts[2]) params.resume = decodeURIComponent(parts[2]);
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  clear(view);
  view.scrollTop = 0;
  const fn = routes[name] || routes[''];
  cleanup = fn(params) || null;
  view.focus({ preventScroll: true });
}
addEventListener('hashchange', route);
route();
