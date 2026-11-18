// Task 3 — Settings navigation: "Notifications › Email alerts → ON".
// Root list of categories → category page with toggle switches → back button.

import { h, clear, now } from '../util.js';
import { shuffle } from '../rng.js';
import { SETTINGS, slug } from './data.js';

const CHEVRON = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BACK = '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';

export function createNavTask() {
  let area, wrap;
  let cats = [];          // shuffled categories for this trial
  let states = {};        // toggle states: key `${cat}/${item}` → bool
  let goal = null;        // { cat, item, want }
  let page = 'root';      // 'root' | cat id
  let lastGoalKey = null;
  let stats = null;
  let lastScrollT = -Infinity;
  const onScroll = () => { lastScrollT = now(); };

  const key = (cat, item) => `${cat}/${slug(item)}`;

  function render() {
    clear(wrap);
    if (page === 'root') {
      wrap.append(
        h('div', { class: 'settings-head' }, h('div', { class: 'settings-title' }, 'Settings')),
        h('div', { class: 'settings-body' }, cats.map((c) =>
          h('button', { class: 'set-row', type: 'button', 'data-target': `cat-${c.id}` },
            h('span', { class: 'set-icon', style: { background: c.color } }),
            h('span', {}, c.name),
            h('span', { class: 'chev', html: CHEVRON }))))
      );
    } else {
      const c = cats.find((x) => x.id === page);
      wrap.append(
        h('div', { class: 'settings-head' },
          h('button', { class: 'back-btn', type: 'button', 'data-target': 'back', 'aria-label': 'Back', html: BACK }),
          h('div', { class: 'settings-title' }, c.name)),
        h('div', { class: 'settings-body' }, c.order.map((item) =>
          h('div', { class: 'set-row toggle-row' },
            h('span', { class: 'set-label' }, item),
            h('button', {
              class: 'switch', type: 'button', role: 'switch',
              'aria-checked': String(!!states[key(c.id, item)]),
              'aria-label': item,
              'data-target': `tgl-${key(c.id, item)}`,
            }))))
      );
    }
    wrap.scrollTop = 0;
  }

  return {
    id: 'nav',
    name: 'Settings',
    instructions: 'Open the named settings page and switch the named setting ON or OFF.',

    mount(el) {
      area = el;
      clear(area);
      wrap = h('div', { class: 'settings' });
      wrap.addEventListener('scroll', onScroll, { passive: true });
      area.append(wrap);
    },

    newTrial(rng) {
      cats = shuffle(SETTINGS, rng).map((c) => ({ ...c, order: shuffle(c.items, rng) }));
      states = {};
      for (const c of SETTINGS) for (const it of c.items) states[key(c.id, it)] = rng() < 0.5;
      let cat, item;
      do {
        cat = SETTINGS[Math.floor(rng() * SETTINGS.length)];
        item = cat.items[Math.floor(rng() * cat.items.length)];
      } while (key(cat.id, item) === lastGoalKey);
      lastGoalKey = key(cat.id, item);
      const want = rng() < 0.5;
      states[key(cat.id, item)] = !want; // always requires a change
      goal = { cat: cat.id, catName: cat.name, item, want };
      page = 'root';
      stats = { steps: 0, wrongEntries: 0, backTaps: 0, wrongToggles: 0 };
      render();
      return {
        prompt: [h('span', {}, `${cat.name} › `), h('b', {}, item), h('span', {}, want ? ' → ON' : ' → OFF')],
        label: `${cat.name} › ${item} → ${want ? 'ON' : 'OFF'}`,
        meta: { goalCat: cat.id, goalItem: item, want },
      };
    },

    intendedId() {
      if (page === 'root') return `cat-${goal.cat}`;
      if (page !== goal.cat) return 'back';
      return `tgl-${key(goal.cat, goal.item)}`;
    },

    intendedEl() {
      return wrap.querySelector(`[data-target="${CSS.escape(this.intendedId())}"]`);
    },

    handleTap(hitId) {
      if (!hitId) return { complete: false };
      stats.steps++;
      if (hitId.startsWith('cat-')) {
        const id = hitId.slice(4);
        if (id !== goal.cat) stats.wrongEntries++;
        page = id;
        render();
        return { complete: false };
      }
      if (hitId === 'back') {
        stats.backTaps++;
        page = 'root';
        render();
        return { complete: false };
      }
      if (hitId.startsWith('tgl-')) {
        const k = hitId.slice(4);
        states[k] = !states[k];
        const btn = wrap.querySelector(`[data-target="${CSS.escape(hitId)}"]`);
        btn?.setAttribute('aria-checked', String(states[k]));
        const isGoal = k === key(goal.cat, goal.item);
        if (!isGoal) stats.wrongToggles++;
        return { complete: isGoal && states[k] === goal.want };
      }
      return { complete: false };
    },

    ignoreTap: (tap) => tap.tDown - lastScrollT < 120,

    extra: () => ({ ...stats }),

    unmount() { clear(area); },
  };
}
