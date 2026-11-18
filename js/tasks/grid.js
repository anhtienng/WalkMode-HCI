// Task 1 — App launcher grid: "Open Camera". Positions are reshuffled every trial.

import { h, clear, now } from '../util.js';
import { shuffle } from '../rng.js';
import { APPS } from './data.js';

export function createGridTask() {
  let area, grid, target, lastTargetId = null, order = [];
  let lastScrollT = -Infinity;
  const onScroll = () => { lastScrollT = now(); };

  return {
    id: 'grid',
    name: 'App launcher',
    instructions: 'Tap the app named at the top of the screen.',

    mount(el) {
      area = el;
      clear(area);
      // Fits without scrolling on typical phones; scrolls only as a fallback on very small screens.
      area.classList.add('scrolls');
      area.addEventListener('scroll', onScroll, { passive: true });
      grid = h('div', { class: 'app-grid' });
      area.append(h('div', { class: 'grid-wrap' }, grid));
    },

    newTrial(rng) {
      order = shuffle(APPS, rng);
      do { target = APPS[Math.floor(rng() * APPS.length)]; } while (target.id === lastTargetId);
      lastTargetId = target.id;
      clear(grid);
      for (const app of order) {
        grid.append(h('button', { class: 'app-tile', type: 'button', 'data-target': `app-${app.id}`, 'aria-label': app.name },
          h('div', { class: 'app-icon', style: { background: app.color } }, app.mono),
          h('div', { class: 'app-label' }, app.name)));
      }
      area.scrollTop = 0;
      return {
        prompt: [h('span', {}, 'Open '), h('b', {}, target.name)],
        label: target.name,
        meta: { targetIndex: order.findIndex((a) => a.id === target.id) },
      };
    },

    intendedId: () => `app-${target.id}`,
    intendedEl: () => grid.querySelector(`[data-target="app-${target.id}"]`),

    ignoreTap: (tap) => tap.tDown - lastScrollT < 120,

    handleTap(hitId) {
      return { complete: hitId === `app-${target.id}` };
    },

    extra: () => ({ gridOverflow: area.scrollHeight > area.clientHeight + 1 }), // screen too small for the grid

    unmount() {
      area.removeEventListener('scroll', onScroll);
      area.classList.remove('scrolls');
      clear(area);
    },
  };
}
