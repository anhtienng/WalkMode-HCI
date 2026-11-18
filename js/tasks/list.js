// Task 2 — Contact list: "Call Priya Shah". 40 alphabetized contacts; the target usually requires scrolling.

import { h, clear, now } from '../util.js';
import { sample } from '../rng.js';
import { NAMES, AVATAR_COLORS, slug } from './data.js';

const LIST_SIZE = 40;

export function createListTask() {
  let area, listEl, target, lastTarget = null;
  let lastScrollT = -Infinity, lastScrollTop = 0, scrollPx = 0;
  let anchor = null;

  const onScroll = () => {
    const st = area.scrollTop;
    scrollPx += Math.abs(st - lastScrollTop);
    lastScrollTop = st;
    lastScrollT = now();
  };

  return {
    id: 'list',
    name: 'Contacts',
    instructions: 'Scroll the list and tap the contact named at the top.',
    scrolls: true,

    mount(el) {
      area = el;
      clear(area);
      area.classList.add('scrolls');
      area.style.overflowAnchor = 'none'; // we restore the scroll anchor ourselves on mode changes
      listEl = h('div', { class: 'contact-list' });
      area.append(listEl);
      area.addEventListener('scroll', onScroll, { passive: true });
    },

    newTrial(rng) {
      const names = sample(NAMES, LIST_SIZE, rng).sort((a, b) => a.localeCompare(b));
      let idx;
      do { idx = 5 + Math.floor(rng() * (LIST_SIZE - 5)); } while (names[idx] === lastTarget);
      target = names[idx];
      lastTarget = target;
      clear(listEl);
      let letter = '';
      names.forEach((name, i) => {
        if (name[0] !== letter) {
          letter = name[0];
          listEl.append(h('div', { class: 'contact-section' }, letter));
        }
        const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('');
        listEl.append(h('button', { class: 'contact-row', type: 'button', 'data-target': `c-${slug(name)}` },
          h('span', { class: 'avatar', style: { background: AVATAR_COLORS[i % AVATAR_COLORS.length] } }, initials),
          h('span', { class: 'contact-name' }, name)));
      });
      area.scrollTop = 0;
      lastScrollTop = 0;
      scrollPx = 0;
      return { prompt: [h('span', {}, 'Call '), h('b', {}, target)], label: target, meta: { targetIndex: idx } };
    },

    intendedId: () => `c-${slug(target)}`,
    intendedEl: () => listEl.querySelector(`[data-target="c-${slug(target)}"]`),

    // A touch that stops a momentum scroll is not a selection.
    ignoreTap: (tap) => tap.tDown - lastScrollT < 120,

    handleTap(hitId) {
      return { complete: hitId === `c-${slug(target)}` };
    },

    extra: () => ({ scrollPx: Math.round(scrollPx) }),

    // Keep the same row at the same place when the layout grows/shrinks.
    beforeModeChange() {
      const top = area.scrollTop;
      const rows = listEl.querySelectorAll('.contact-row');
      for (const r of rows) {
        if (r.offsetTop + r.offsetHeight > top) {
          anchor = { el: r, offset: r.offsetTop - top };
          return;
        }
      }
      anchor = null;
    },
    afterModeChange() {
      if (!anchor) return;
      const { el, offset } = anchor;
      anchor = null;
      area.scrollTop = Math.max(0, el.offsetTop - offset);
      lastScrollTop = area.scrollTop; // programmatic, not user scrolling
    },

    unmount() {
      area.removeEventListener('scroll', onScroll);
      area.classList.remove('scrolls');
      clear(area);
    },
  };
}
