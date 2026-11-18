// Questionnaires: raw NASA-TLX, demographics, and the final preference survey.
// Each form renders into `view` and resolves with its answers.

import { h, clear } from './util.js';

export const TLX_ITEMS = [
  { key: 'mental', title: 'Mental demand', q: 'How mentally demanding was the task?', lo: 'Very low', hi: 'Very high' },
  { key: 'physical', title: 'Physical demand', q: 'How physically demanding was the task?', lo: 'Very low', hi: 'Very high' },
  { key: 'temporal', title: 'Temporal demand', q: 'How hurried or rushed was the pace of the task?', lo: 'Very low', hi: 'Very high' },
  { key: 'performance', title: 'Performance', q: 'How successful were you in accomplishing what you were asked to do?', lo: 'Perfect', hi: 'Failure' },
  { key: 'effort', title: 'Effort', q: 'How hard did you have to work to accomplish your level of performance?', lo: 'Very low', hi: 'Very high' },
  { key: 'frustration', title: 'Frustration', q: 'How insecure, discouraged, irritated, stressed, and annoyed were you?', lo: 'Very low', hi: 'Very high' },
];

export const LIKERT_ITEMS = [
  { key: 'noticed', text: 'I noticed when the WalkMode layout changed.' },
  { key: 'disruptive', text: 'The layout change was disruptive.' },
  { key: 'easierWalking', text: 'The enlarged layout made it easier to tap while walking.' },
  { key: 'detectionAccurate', text: 'WalkMode correctly recognized when I was walking.' },
  { key: 'wouldUse', text: 'I would turn WalkMode on for my own phone.' },
];

function segmented(options, onChange, initial = null) {
  let value = initial;
  const btns = options.map(([v, label]) => h('button', {
    type: 'button',
    'aria-pressed': String(v === value),
    onclick: () => {
      value = v;
      btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === v)));
      onChange(v);
    },
  }, label));
  return h('div', { class: 'seg' }, btns);
}

function likert(onChange) {
  let value = null;
  const btns = [1, 2, 3, 4, 5, 6, 7].map((n) => h('button', {
    type: 'button', 'aria-pressed': 'false', 'aria-label': String(n),
    onclick: () => {
      value = n;
      btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === n)));
      onChange(n);
    },
  }, String(n)));
  return h('div', {},
    h('div', { class: 'likert' }, btns),
    h('div', { class: 'tlx-anchors' }, h('span', {}, 'Strongly disagree'), h('span', {}, 'Strongly agree')));
}

/** Raw NASA-TLX: six 0–100 scales in steps of 5. Every scale must be touched. */
export function tlxForm(view, { title = 'How was that block?', subtitle = '' } = {}) {
  return new Promise((resolve) => {
    clear(view);
    const values = {};
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, 'Continue');
    const missing = h('p', { class: 'small' }, 'Move every slider to answer.');
    const check = () => {
      const done = TLX_ITEMS.every((it) => Number.isFinite(values[it.key]));
      submit.disabled = !done;
      missing.hidden = done;
    };
    const items = TLX_ITEMS.map((it) => {
      // The native range input is kept for keyboard/a11y, but touch is handled on the wrapper:
      // iOS does not jump the thumb on a track tap, and the thumb is hidden until answered.
      const scale = h('div', { class: 'tlx-scale unset' });
      const set = (v) => { values[it.key] = v; input.value = String(v); scale.classList.remove('unset'); check(); };
      const input = h('input', {
        type: 'range', min: 0, max: 100, step: 5, value: 50, 'aria-label': it.title,
        oninput: (e) => set(Number(e.target.value)),
      });
      const fromX = (clientX) => {
        const r = input.getBoundingClientRect();
        const pct = (clientX - r.left) / r.width;
        set(Math.max(0, Math.min(100, Math.round(pct * 20) * 5)));
      };
      // touch-action: pan-y lets a vertical swipe scroll the page (the browser then sends pointercancel);
      // only a tap or a horizontal drag sets a value, so scrolling past a slider never answers it.
      let start = null;
      let dragging = false;
      scale.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; dragging = false; });
      scale.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (!dragging && dx > 6 && dx > dy) { dragging = true; scale.setPointerCapture?.(e.pointerId); }
        if (dragging) fromX(e.clientX);
        else if (dy > 10) start = null;
      });
      scale.addEventListener('pointerup', (e) => {
        if (start && !dragging) fromX(e.clientX);
        start = null;
        dragging = false;
      });
      scale.addEventListener('pointercancel', () => { start = null; dragging = false; });
      scale.append(input, h('div', { class: 'tlx-ticks' }));
      return h('div', { class: 'tlx-item' },
        h('h3', {}, it.title), h('p', {}, it.q), scale,
        h('div', { class: 'tlx-anchors' }, h('span', {}, it.lo), h('span', {}, it.hi)));
    });
    submit.addEventListener('click', () => {
      const raw = TLX_ITEMS.reduce((a, it) => a + values[it.key], 0) / TLX_ITEMS.length;
      resolve({ ...values, raw: Math.round(raw * 10) / 10 });
    });
    view.append(h('div', { class: 'page' },
      h('h1', {}, title),
      subtitle ? h('p', { class: 'lead' }, subtitle) : null,
      h('p', { class: 'small' }, 'NASA Task Load Index: rate the block you just completed.'),
      items, missing, submit));
    view.scrollTop = 0;
  });
}

export function demographicsForm(container, initial = {}) {
  const d = { ageRange: null, gender: '', handedness: null, phoneOS: null, phoneHours: null, walkUseFreq: null, ...initial };
  container.append(
    h('div', { class: 'field' }, h('span', {}, 'Age range'),
      segmented([['18-24', '18–24'], ['25-34', '25–34'], ['35-44', '35–44'], ['45-54', '45–54'], ['55+', '55+']], (v) => { d.ageRange = v; }, d.ageRange)),
    h('label', { class: 'field' }, h('span', {}, 'Gender (optional, free text)'),
      h('input', { class: 'input', type: 'text', value: d.gender, oninput: (e) => { d.gender = e.target.value; } })),
    h('div', { class: 'field' }, h('span', {}, 'Handedness'),
      segmented([['right', 'Right'], ['left', 'Left'], ['both', 'Ambidextrous']], (v) => { d.handedness = v; }, d.handedness)),
    h('div', { class: 'field' }, h('span', {}, 'Own phone'),
      segmented([['ios', 'iPhone'], ['android', 'Android'], ['other', 'Other']], (v) => { d.phoneOS = v; }, d.phoneOS)),
    h('div', { class: 'field' }, h('span', {}, 'Phone use per day'),
      segmented([['<1', '<1 h'], ['1-3', '1–3 h'], ['3-5', '3–5 h'], ['>5', '>5 h']], (v) => { d.phoneHours = v; }, d.phoneHours)),
    h('div', { class: 'field' }, h('span', {}, 'How often do you use your phone while walking?'),
      segmented([['never', 'Never'], ['rarely', 'Rarely'], ['sometimes', 'Sometimes'], ['often', 'Often'], ['always', 'Very often']], (v) => { d.walkUseFreq = v; }, d.walkUseFreq)),
  );
  return d;
}

export function preferenceForm(view) {
  return new Promise((resolve) => {
    clear(view);
    const a = { standing: null, walking: null, overall: null, likert: {}, liked: '', disliked: '', comments: '' };
    const submit = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: true }, 'Finish');
    const check = () => {
      submit.disabled = !(a.standing && a.walking && a.overall && LIKERT_ITEMS.every((it) => a.likert[it.key]));
    };
    const pref = (key, q) => h('div', { class: 'field' }, h('span', {}, q),
      segmented([['standard', 'Standard'], ['walkmode', 'WalkMode'], ['none', 'No preference']], (v) => { a[key] = v; check(); }));
    submit.addEventListener('click', () => resolve(a));
    view.append(h('div', { class: 'page' },
      h('h1', {}, 'Last questions'),
      h('p', { class: 'lead' }, 'Standard keeps one layout all the time. WalkMode enlarges buttons and spacing automatically when you walk.'),
      h('div', { class: 'card' },
        pref('standing', 'While STANDING, which interface did you prefer?'),
        pref('walking', 'While WALKING, which interface did you prefer?'),
        pref('overall', 'Overall, which interface did you prefer?')),
      h('div', { class: 'card' },
        LIKERT_ITEMS.map((it) => h('div', { class: 'field' },
          h('p', { style: { margin: '0 0 4px', fontWeight: 600 } }, it.text),
          likert((n) => { a.likert[it.key] = n; check(); })))),
      h('div', { class: 'card' },
        h('label', { class: 'field' }, h('span', {}, 'What did you like about WalkMode?'),
          h('textarea', { class: 'input', oninput: (e) => { a.liked = e.target.value; } })),
        h('label', { class: 'field' }, h('span', {}, 'What did you dislike or find confusing?'),
          h('textarea', { class: 'input', oninput: (e) => { a.disliked = e.target.value; } })),
        h('label', { class: 'field' }, h('span', {}, 'Any other comments?'),
          h('textarea', { class: 'input', oninput: (e) => { a.comments = e.target.value; } }))),
      submit));
    view.scrollTop = 0;
  });
}

export { segmented };
